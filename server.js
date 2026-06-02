const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const os = require('os');
const { Pool } = require('pg');
const drive = require('./drive');
const cal = require('./calendar');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4124;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(os.homedir(), '.shoot_planner_uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Database ──────────────────────────────────────────────────────────────────
const useDB = !!process.env.DATABASE_URL;
const pool = useDB ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const DATA_FILE = path.join(os.homedir(), '.shoot_planner_v2.json');

async function initDB() {
  if (!useDB) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMP DEFAULT NOW());`);
  console.log('PostgreSQL ready');
}

async function load() {
  if (useDB) {
    const res = await pool.query("SELECT value FROM data_store WHERE key = 'main'");
    return res.rows.length > 0 ? res.rows[0].value : { organisations: [], contacts: [], projects: [] };
  }
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
  return { organisations: [], contacts: [], projects: [] };
}

async function save(data) {
  if (useDB) {
    await pool.query(`INSERT INTO data_store (key, value, updated_at) VALUES ('main', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`, [JSON.stringify(data)]);
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return crypto.randomBytes(8).toString('hex'); }
function magicLink() { return crypto.randomBytes(24).toString('hex'); }

// ── Auth ──────────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'shoots2024').trim();
const SESSION_SECRET = process.env.SESSION_SECRET || ('sp_' + ADMIN_PASSWORD + '_2024');

function makeToken() {
  return crypto.createHmac('sha256', SESSION_SECRET).update('access').digest('hex');
}

function checkToken(token) {
  if (!token) return false;
  return token === makeToken();
}

// No-cache for all API responses
app.use('/api', function(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Auth middleware - protect all API routes except public ones
app.use('/api', function(req, res, next) {
  const p = req.path;
  if (p === '/login' || p === '/logout' || p.startsWith('/portal') || p === '/import' || p === '/drive/status' || p === '/ingredients') return next();
  if (!checkToken(req.headers['x-session-token'])) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.post('/api/login', (req, res) => {
  const supplied = (req.body.password || '').trim();
  if (supplied === ADMIN_PASSWORD) {
    res.json({ ok: true, token: makeToken() });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/logout', (req, res) => res.json({ ok: true }));

// ── Portal helpers ────────────────────────────────────────────────────────────
function regeneratePortals(proj, data) {
  if (!proj.portals) proj.portals = {};
  if (!proj.portals.client) proj.portals.client = magicLink();
  const ids = new Set();
  proj.shootDays.forEach(day => {
    if (day.foodStylistId) ids.add(day.foodStylistId);
    if (day.propStylistId) ids.add(day.propStylistId);
    if (day.photoAssistantId) ids.add(day.photoAssistantId);
    (day.shots||[]).forEach(s => { if (s.designAgencyId) ids.add(s.designAgencyId); });
  });
  ids.forEach(id => { if (!proj.portals['contact_'+id]) proj.portals['contact_'+id] = magicLink(); });
}

function findPortal(token, data) {
  for (const proj of data.projects) {
    if (!proj.portals) continue;
    for (const [key, t] of Object.entries(proj.portals)) {
      if (t === token) return { proj, key, contactId: key === 'client' ? null : key.replace('contact_',''), isClient: key === 'client' };
    }
  }
  return null;
}

// ── Orgs ──────────────────────────────────────────────────────────────────────
app.get('/api/orgs', async (req, res) => { try { res.json((await load()).organisations); } catch(e) { res.status(500).json({error:e.message}); }});
app.post('/api/orgs', async (req, res) => { try { const data = await load(); const org = {id:uid(),name:req.body.name||'',type:req.body.type||'Client',departments:req.body.departments||[],website:req.body.website||'',notes:req.body.notes||'',createdAt:new Date().toISOString()}; data.organisations.push(org); await save(data); res.json(org); } catch(e){res.status(500).json({error:e.message});}});
app.put('/api/orgs/:id', async (req, res) => { try { const data = await load(); const idx = data.organisations.findIndex(o=>o.id===req.params.id); if(idx===-1)return res.status(404).json({error:'Not found'}); data.organisations[idx]={...data.organisations[idx],...req.body,id:req.params.id}; await save(data); res.json(data.organisations[idx]); } catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/orgs/:id', async (req, res) => { try { const data = await load(); data.organisations=data.organisations.filter(o=>o.id!==req.params.id); await save(data); res.json({ok:true}); } catch(e){res.status(500).json({error:e.message});}});

// ── Contacts ──────────────────────────────────────────────────────────────────
app.get('/api/contacts', async (req, res) => { try { res.json((await load()).contacts); } catch(e){res.status(500).json({error:e.message});}});
app.post('/api/contacts', async (req, res) => { try { const data = await load(); const c = {id:uid(),firstName:req.body.firstName||'',lastName:req.body.lastName||'',email:req.body.email||'',phone:req.body.phone||'',orgId:req.body.orgId||null,type:req.body.type||'Client Contact',notes:req.body.notes||'',createdAt:new Date().toISOString()}; data.contacts.push(c); await save(data); res.json(c); } catch(e){res.status(500).json({error:e.message});}});
app.put('/api/contacts/:id', async (req, res) => { try { const data = await load(); const idx = data.contacts.findIndex(c=>c.id===req.params.id); if(idx===-1)return res.status(404).json({error:'Not found'}); data.contacts[idx]={...data.contacts[idx],...req.body,id:req.params.id}; await save(data); res.json(data.contacts[idx]); } catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/contacts/:id', async (req, res) => { try { const data = await load(); data.contacts=data.contacts.filter(c=>c.id!==req.params.id); await save(data); res.json({ok:true}); } catch(e){res.status(500).json({error:e.message});}});

// ── Projects ──────────────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => { try { res.json((await load()).projects); } catch(e){res.status(500).json({error:e.message});}});
app.post('/api/projects', async (req, res) => { try { const data = await load(); const p = {id:uid(),name:req.body.name||'Untitled',orgId:req.body.orgId||null,department:req.body.department||'',commissionedById:req.body.commissionedById||null,status:req.body.status||'Tentative',location:req.body.location||'',startDate:req.body.startDate||'',endDate:req.body.endDate||'',notes:req.body.notes||'',driveUrl:req.body.driveUrl||'',portals:{client:magicLink()},shootDays:[],createdAt:new Date().toISOString()}; data.projects.push(p); await save(data); res.json(p); } catch(e){res.status(500).json({error:e.message});}});
app.get('/api/projects/:id', async (req, res) => { try { const data = await load(); const p=data.projects.find(p=>p.id===req.params.id); if(!p)return res.status(404).json({error:'Not found'}); res.json(p); } catch(e){res.status(500).json({error:e.message});}});
app.put('/api/projects/:id', async (req, res) => { try { const data = await load(); const idx=data.projects.findIndex(p=>p.id===req.params.id); if(idx===-1)return res.status(404).json({error:'Not found'}); data.projects[idx]={...data.projects[idx],...req.body,id:req.params.id,portals:data.projects[idx].portals,shootDays:data.projects[idx].shootDays}; await save(data); res.json(data.projects[idx]); } catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/projects/:id', async (req, res) => { try { const data = await load(); data.projects=data.projects.filter(p=>p.id!==req.params.id); await save(data); res.json({ok:true}); } catch(e){res.status(500).json({error:e.message});}});

// ── Generate days ─────────────────────────────────────────────────────────────
app.post('/api/projects/:id/generate-days', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); const start=new Date(req.body.startDate),end=new Date(req.body.endDate); const newDays=[]; for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){const ds=d.toISOString().split('T')[0];if(!proj.shootDays.find(x=>x.date===ds)){const day={id:uid(),date:ds,foodStylistId:null,propStylistId:null,photoAssistantId:null,shots:[]};proj.shootDays.push(day);newDays.push(day);}} proj.shootDays.sort((a,b)=>a.date.localeCompare(b.date)); await save(data); res.json(newDays); } catch(e){res.status(500).json({error:e.message});}});

// ── Days ──────────────────────────────────────────────────────────────────────
app.post('/api/projects/:id/days', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); const day={id:uid(),date:req.body.date||'',foodStylistId:req.body.foodStylistId||null,propStylistId:req.body.propStylistId||null,photoAssistantId:req.body.photoAssistantId||null,shots:[]}; proj.shootDays.push(day); proj.shootDays.sort((a,b)=>a.date.localeCompare(b.date)); regeneratePortals(proj,data); await save(data); res.json(day); } catch(e){res.status(500).json({error:e.message});}});
app.put('/api/projects/:id/days/:dayId', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); const idx=proj.shootDays.findIndex(d=>d.id===req.params.dayId); if(idx===-1)return res.status(404).json({error:'Not found'}); const shots=proj.shootDays[idx].shots; proj.shootDays[idx]={...proj.shootDays[idx],...req.body,id:req.params.dayId,shots}; regeneratePortals(proj,data); await save(data); res.json(proj.shootDays[idx]); } catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/projects/:id/days/:dayId', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); proj.shootDays=proj.shootDays.filter(d=>d.id!==req.params.dayId); await save(data); res.json({ok:true}); } catch(e){res.status(500).json({error:e.message});}});

// ── Shots ─────────────────────────────────────────────────────────────────────
app.post('/api/projects/:id/days/:dayId/shots', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); const day=proj.shootDays.find(d=>d.id===req.params.dayId); if(!day)return res.status(404).json({error:'Not found'}); const shot={id:uid(),shotId:req.body.shotId||'',name:req.body.name||'Untitled',schedule:req.body.schedule||'',scheduleStart:req.body.scheduleStart||'',scheduleEnd:req.body.scheduleEnd||'',designAgencyId:req.body.designAgencyId||null,designAgency:req.body.designAgency||'',status:'To Shoot',servingNotes:'',visualBrief:[],shoppingList:[],propsList:[],approvalImages:[],finalImages:[]}; day.shots.push(shot); regeneratePortals(proj,data); await save(data); res.json(shot); } catch(e){res.status(500).json({error:e.message});}});
app.put('/api/projects/:id/days/:dayId/shots/:shotId', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); const day=proj.shootDays.find(d=>d.id===req.params.dayId); if(!day)return res.status(404).json({error:'Not found'}); const idx=day.shots.findIndex(s=>s.id===req.params.shotId); if(idx===-1)return res.status(404).json({error:'Not found'}); day.shots[idx]={...day.shots[idx],...req.body,id:req.params.shotId}; regeneratePortals(proj,data); await save(data); res.json(day.shots[idx]); } catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/projects/:id/days/:dayId/shots/:shotId', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); const day=proj.shootDays.find(d=>d.id===req.params.dayId); if(!day)return res.status(404).json({error:'Not found'}); day.shots=day.shots.filter(s=>s.id!==req.params.shotId); await save(data); res.json({ok:true}); } catch(e){res.status(500).json({error:e.message});}});

// ── Portals ───────────────────────────────────────────────────────────────────
app.get('/portal/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal.html')));

app.get('/api/projects/:id/portals', async (req, res) => { try { const data=await load(); const proj=data.projects.find(p=>p.id===req.params.id); if(!proj)return res.status(404).json({error:'Not found'}); const portals=[{label:'Client',type:'client',token:proj.portals.client}]; Object.entries(proj.portals).forEach(([key,token])=>{if(key==='client')return;const cid=key.replace('contact_','');const c=data.contacts.find(x=>x.id===cid);if(c)portals.push({label:c.firstName+' '+c.lastName,type:c.type,token,contactId:cid});}); res.json(portals); } catch(e){res.status(500).json({error:e.message});}});

app.get('/api/portal/:token', async (req, res) => { try {
  const data=await load(); const result=findPortal(req.params.token,data); if(!result)return res.status(404).json({error:'Invalid link'});
  const {proj,contactId,isClient}=result; const org=data.organisations.find(o=>o.id===proj.orgId); const contact=contactId?data.contacts.find(c=>c.id===contactId):null;
  const typeMap={'Food Stylist':'foodStylist','Prop Stylist':'propStylist','Photography Assistant':'assistant','Agency Contact':'agency','Client Contact':'client'};
  const portalType=contact?(typeMap[contact.type]||'client'):'client';
  const days=(proj.shootDays||[]).map(day=>{
    const fs=data.contacts.find(c=>c.id===day.foodStylistId); const ps=data.contacts.find(c=>c.id===day.propStylistId); const pa=data.contacts.find(c=>c.id===day.photoAssistantId);
    let shots=day.shots||[]; if(portalType==='agency'&&contactId)shots=shots.filter(s=>s.designAgencyId===contactId);
    let isMyDay=isClient||false;
    if(!isClient){if(portalType==='foodStylist')isMyDay=day.foodStylistId===contactId;else if(portalType==='propStylist')isMyDay=day.propStylistId===contactId;else if(portalType==='assistant')isMyDay=day.photoAssistantId===contactId;else if(portalType==='agency')isMyDay=shots.length>0;}
    return {...day,shots,foodStylistName:fs?fs.firstName+' '+fs.lastName:'',propStylistName:ps?ps.firstName+' '+ps.lastName:'',photoAssistantName:pa?pa.firstName+' '+pa.lastName:'',isMyDay};
  }).filter(d=>d.isMyDay);
  res.json({type:portalType,contactName:contact?contact.firstName+' '+contact.lastName:'',project:{id:proj.id,name:proj.name,client:org?org.name:'',department:proj.department,status:proj.status,startDate:proj.startDate,endDate:proj.endDate,location:proj.location,driveUrl:proj.driveUrl||''},days});
} catch(e){res.status(500).json({error:e.message});}});

app.post('/api/portal/:token/shots/:shotId/images/:imgIdx/annotate', async (req, res) => { try { const data=await load(); const result=findPortal(req.params.token,data); if(!result)return res.status(404).json({error:'Invalid link'}); const {proj}=result; for(const day of proj.shootDays){const shot=day.shots.find(s=>s.id===req.params.shotId);if(shot){const img=shot.approvalImages[parseInt(req.params.imgIdx)];if(img&&typeof img==='object'){if(req.body.annotation!==undefined)img.annotation=req.body.annotation;if(req.body.comment!==undefined)img.comment=req.body.comment;if(req.body.comments!==undefined)img.comments=req.body.comments;if(req.body.approved!==undefined)img.approved=req.body.approved;img.reviewedAt=new Date().toISOString();}await save(data);return res.json({ok:true});}} res.status(404).json({error:'Shot not found'}); } catch(e){res.status(500).json({error:e.message});}});

// ── Google Drive ──────────────────────────────────────────────────────────────
app.get('/auth/google', (req, res) => { res.redirect(drive.getAuthUrl()); });

app.get('/auth/google/callback', async (req, res) => {
  try {
    const tokens = await drive.exchangeCode(req.query.code);
    if (useDB) {
      try {
        const data = await load();
        data._driveTokens = tokens; // Save full token including scope
        await save(data);
        console.log('Tokens saved to DB, scope:', tokens.scope);
      } catch(e) { console.error('Failed to save tokens:', e.message); }
    }
    res.send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>✅ Google Connected!</h2><p>Drive & Calendar ready. You can close this window.</p><script>setTimeout(()=>{window.close();if(window.opener)window.opener.location.reload();},1500);</script></body></html>');
  } catch(e) { res.status(500).send('Auth failed: ' + e.message); }
});

app.get('/api/drive/status', (req, res) => res.json({ connected: drive.isAuthenticated() }));

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if(!req.file) return res.status(400).json({error:'No file'});
  if(drive.isAuthenticated()){
    try {
      const buf = fs.readFileSync(req.file.path);
      const url = await drive.uploadFile(buf, req.file.originalname, req.file.mimetype, req.body.projectName||'Uncategorised', req.body.folderType||'Approvals');
      fs.unlinkSync(req.file.path);
      return res.json({ url, drive: true });
    } catch(e) { console.error('Drive upload failed:', e.message); }
  }
  res.json({ url: '/uploads/' + req.file.filename, drive: false });
});

// ── Ingredients ───────────────────────────────────────────────────────────────
const INGREDIENT_DB_FILE = process.env.INGREDIENT_DB_FILE || path.join(os.homedir(), '.shoot_planner_ingredients.json');
function loadIngredients(){try{if(fs.existsSync(INGREDIENT_DB_FILE))return JSON.parse(fs.readFileSync(INGREDIENT_DB_FILE,'utf8'));}catch(e){}return[];}
app.get('/api/ingredients',(req,res)=>res.json(loadIngredients()));
app.post('/api/ingredients',(req,res)=>{const items=loadIngredients();const{name,section}=req.body;if(!name)return res.status(400).json({error:'Name required'});const key=name.trim().toLowerCase();const ex=items.find(i=>i.name.toLowerCase()===key);if(ex){ex.section=section;ex.uses=(ex.uses||0)+1;}else{items.push({name:name.trim(),section:section||'',uses:1});}fs.writeFileSync(INGREDIENT_DB_FILE,JSON.stringify(items,null,2));res.json({ok:true});});

// ── Import ────────────────────────────────────────────────────────────────────
app.post('/api/import', async (req, res) => { try { await save(req.body); res.json({ok:true,projects:req.body.projects.length,orgs:req.body.organisations.length,contacts:req.body.contacts.length}); } catch(e){res.status(500).json({error:e.message});}});

// ── Calendar Sync ────────────────────────────────────────────────────────────
app.post('/api/calendar/sync', async (req, res) => {
  try {
    if (!drive.isAuthenticated()) return res.status(400).json({ error: 'Google not connected - click Connect Drive first' });
    const data = await load();
    // Pass Drive's oauth2Client directly to calendar sync
    const results = await cal.syncProjects(data.projects, data.organisations, drive.getOAuth2Client());
    const created = results.filter(r => r.action === 'created').length;
    const updated = results.filter(r => r.action === 'updated').length;
    const errors = results.filter(r => r.action === 'error').length;
    res.json({ ok: true, created, updated, errors, results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Backup ────────────────────────────────────────────────────────────────────
async function backupToGoogleDrive() {
  try {
    if (!drive.isAuthenticated()) return;
    const data = await load();
    const buf = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    const filename = 'shoot-planner-backup-' + new Date().toISOString().split('T')[0] + '.json';
    await drive.uploadFile(buf, filename, 'application/json', 'Backups', 'Database');
    console.log('Backup saved:', filename);
    return filename;
  } catch(e) { console.error('Backup failed:', e.message); }
}

setInterval(backupToGoogleDrive, 24 * 60 * 60 * 1000);

app.post('/api/backup', async (req, res) => {
  const filename = await backupToGoogleDrive();
  if (filename) res.json({ ok: true, filename });
  else res.status(500).json({ error: 'Backup failed - is Google Drive connected?' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function loadDriveTokens() {
  if (!useDB) return;
  try {
    const data = await load();
    if (data._driveTokens) {
      const tokens = data._driveTokens;
      // Check if token has calendar scope
      const scope = tokens.scope || '';
      const hasCalendar = scope.includes('calendar');
      drive.saveTokens(tokens);
      console.log('Drive tokens restored, calendar scope:', hasCalendar);
    }
  } catch(e) { console.error('Token restore error:', e.message); }
}

initDB().then(async () => {
  await loadDriveTokens();
  app.listen(PORT, () => console.log('\n📷 Shoot Planner running at http://localhost:' + PORT + '\n'));
}).catch(err => {
  console.error('DB init failed:', err.message);
  app.listen(PORT, () => console.log('\n📷 Shoot Planner running at http://localhost:' + PORT + '\n'));
});
