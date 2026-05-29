require('dotenv').config();
const fetch = require('node-fetch');
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json());
app.use(cookieParser());

const crypto = require('crypto');

// ── Auth helpers ──────────────────────────────────
function totp(secret) {
  // RFC 6238 TOTP — 30s window, 6 digits
  const epoch = Math.floor(Date.now() / 30000);
  function hotp(key, counter) {
    const buf = Buffer.alloc(8);
    for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter >>= 8; }
    const hmac = crypto.createHmac('sha1', Buffer.from(key, 'base32').toString ? base32decode(key) : key);
    hmac.update(buf);
    const h = hmac.digest();
    const o = h[19] & 0xf;
    return ((h[o] & 0x7f) << 24 | h[o+1] << 16 | h[o+2] << 8 | h[o+3]) % 1000000;
  }
  function base32decode(s) {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    s = s.toUpperCase().replace(/=+$/, '');
    let bits = 0, val = 0, out = [];
    for (const c of s) {
      val = (val << 5) | alpha.indexOf(c);
      bits += 5;
      if (bits >= 8) { out.push((val >> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(out);
  }
  // Accept current window and +-1 for clock drift
  const code = parseInt(secret);
  if (!isNaN(code)) return code; // for testing
  for (const drift of [0, -1, 1]) {
    if (hotp(secret, epoch + drift).toString().padStart(6,'0') === secret.toString().padStart(6,'0')) return true;
  }
  return hotp(secret, epoch).toString().padStart(6,'0');
}

function verifyTotp(secret, code) {
  const epoch = Math.floor(Date.now() / 30000);
  function base32decode(s) {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    s = s.toUpperCase().replace(/=+$/, '');
    let bits = 0, val = 0, out = [];
    for (const c of s) {
      val = (val << 5) | alpha.indexOf(c);
      bits += 5;
      if (bits >= 8) { out.push((val >> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(out);
  }
  function hotp(key, counter) {
    const buf = Buffer.alloc(8);
    for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter >>= 8; }
    const hmac = crypto.createHmac('sha1', base32decode(key));
    hmac.update(buf);
    const h = hmac.digest();
    const o = h[19] & 0xf;
    return ((h[o] & 0x7f) << 24 | h[o+1] << 16 | h[o+2] << 8 | h[o+3]) % 1000000;
  }
  const input = parseInt(code);
  for (const drift of [0, -1, 1]) {
    if (hotp(secret, epoch + drift) === input) return true;
  }
  return false;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Auth middleware ───────────────────────────────
async function checkAuth(req, res, next) {
  const open = ['/login', '/login/verify', '/login/2fa'];
  if (open.includes(req.path)) return next();
  if (req.path.startsWith('/api/')) return next();

  const token = req.cookies['hq_token'];
  if (!token) return res.redirect('/login');
  try {
    const result = await pool.query(
      "SELECT * FROM hq_sessions WHERE token = $1 AND expires_at > NOW()",
      [token]
    );
    if (!result.rows.length) return res.redirect('/login');
    next();
  } catch(e) {
    console.log('Auth error:', e.message);
    res.redirect('/login');
  }
}

app.use(checkAuth);
app.use(express.static(path.join(__dirname, 'public')));

// ── Login routes ──────────────────────────────────
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily HQ — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 0.5px solid #2a2a2a; border-radius: 12px; padding: 2rem; width: 100%; max-width: 360px; }
    .logo { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #666; margin-bottom: 2rem; }
    label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #666; display: block; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; background: #111; border: 0.5px solid #2a2a2a; border-radius: 8px; color: #e0e0e0; font-size: 14px; outline: none; margin-bottom: 1rem; }
    input:focus { border-color: #444; }
    button { width: 100%; padding: 11px; background: #fff; color: #000; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
    button:hover { opacity: 0.9; }
    .error { font-size: 13px; color: #e05555; margin-bottom: 1rem; background: #2a1010; padding: 8px 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Daily HQ</div>
    <div class="sub">Ryan Ball Photography</div>
    ${req.query.error ? '<div class="error">Incorrect username or password</div>' : ''}
    <form method="POST" action="/login">
      <div><label>Username</label><input type="text" name="username" autofocus autocomplete="username" /></div>
      <div><label>Password</label><input type="password" name="password" autocomplete="current-password" /></div>
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.HQ_USERNAME || 'ryan';
  const validPass = process.env.HQ_PASSWORD;
  if (!validPass || username !== validUser || password !== validPass) {
    return res.redirect('/login?error=1');
  }
  // Password correct — issue temp token for 2FA step
  const tempToken = generateToken();
  await pool.query(
    "INSERT INTO hq_sessions (token, expires_at, verified) VALUES ($1, NOW() + INTERVAL '5 minutes', false)",
    [tempToken]
  );
  res.cookie('hq_temp', tempToken, { httpOnly: true, secure: true, maxAge: 300000 });
  res.redirect('/login/2fa');
});

app.get('/login/2fa', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily HQ — 2FA</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 0.5px solid #2a2a2a; border-radius: 12px; padding: 2rem; width: 100%; max-width: 360px; }
    .logo { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #888; margin-bottom: 2rem; line-height: 1.5; }
    label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #666; display: block; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; background: #111; border: 0.5px solid #2a2a2a; border-radius: 8px; color: #e0e0e0; font-size: 20px; letter-spacing: .2em; outline: none; margin-bottom: 1rem; text-align: center; }
    input:focus { border-color: #444; }
    button { width: 100%; padding: 11px; background: #fff; color: #000; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
    button:hover { opacity: 0.9; }
    .error { font-size: 13px; color: #e05555; margin-bottom: 1rem; background: #2a1010; padding: 8px 12px; border-radius: 6px; }
    .back { text-align: center; margin-top: 1rem; font-size: 12px; color: #666; }
    .back a { color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Two-factor auth</div>
    <div class="sub">Enter the 6-digit code from your authenticator app.</div>
    ${req.query.error ? '<div class="error">Invalid code — try again</div>' : ''}
    <form method="POST" action="/login/verify">
      <div><label>Authentication code</label><input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autofocus placeholder="000000" /></div>
      <button type="submit">Verify</button>
    </form>
    <div class="back"><a href="/login">Back to login</a></div>
  </div>
</body>
</html>`);
});

app.post('/login/verify', express.urlencoded({ extended: false }), async (req, res) => {
  const tempToken = req.cookies['hq_temp'];
  if (!tempToken) return res.redirect('/login');

  const { code } = req.body;
  const secret = process.env.HQ_TOTP_SECRET;
  if (!secret || !verifyTotp(secret, code)) {
    return res.redirect('/login/2fa?error=1');
  }

  // 2FA passed — create real 24h session
  const sessionToken = generateToken();
  await pool.query(
    "INSERT INTO hq_sessions (token, expires_at, verified) VALUES ($1, NOW() + INTERVAL '24 hours', true)",
    [sessionToken]
  );
  // Clean up temp token
  await pool.query("DELETE FROM hq_sessions WHERE token = $1", [tempToken]);

  res.clearCookie('hq_temp');
  res.cookie('hq_token', sessionToken, { httpOnly: true, secure: true, maxAge: 86400000 });
  res.redirect('/');
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      due_date DATE,
      priority VARCHAR(4),
      category VARCHAR(20) DEFAULT 'work',
      tag VARCHAR(50),
      recurring VARCHAR(20),
      done BOOLEAN DEFAULT false,
      completed_at TIMESTAMP,
      snoozed_until DATE,
      source VARCHAR(50) DEFAULT 'manual',
      time_block VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Add time_block column if it doesn't exist (for existing DBs)
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_block VARCHAR(20) DEFAULT NULL`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
  await pool.query(`CREATE TABLE IF NOT EXISTS shoot_tasks (
    id SERIAL PRIMARY KEY,
    shoot_id VARCHAR(100) NOT NULL,
    shoot_name TEXT,
    title TEXT NOT NULL,
    done BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    due_date DATE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_contacts (
    id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(20) DEFAULT 'target',
    name TEXT NOT NULL,
    role VARCHAR(50),
    agency TEXT,
    org_type VARCHAR(50),
    crm_id VARCHAR(100),
    notes TEXT,
    stage VARCHAR(20) DEFAULT 'new',
    last_touchpoint DATE,
    last_touch_type VARCHAR(20),
    influence VARCHAR(20) DEFAULT 'key',
    from_crm BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_content (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    note TEXT,
    planned_date DATE,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS last_touch_type VARCHAR(20)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hq_sessions (
    id SERIAL PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  // Clean expired sessions
  await pool.query("DELETE FROM hq_sessions WHERE expires_at < NOW()");
  console.log('DB ready');
}

app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM tasks 
      WHERE done = false 
      AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_DATE)
      ORDER BY 
        CASE priority WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 WHEN 'p3' THEN 3 ELSE 4 END,
        due_date ASC NULLS LAST,
        created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { title, notes, due_date, priority, category, tag, recurring } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, notes, due_date, priority, category, tag, recurring)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, notes, due_date || null, priority || 'p3', category || 'work', tag || null, recurring || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  try {
    const result = await pool.query(
      `UPDATE tasks SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id/complete', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE tasks SET done = true, completed_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    const task = result.rows[0];
    if (task.recurring && task.due_date) {
      const next = new Date(task.due_date);
      if (task.recurring === 'daily') next.setDate(next.getDate() + 1);
      if (task.recurring === 'weekly') next.setDate(next.getDate() + 7);
      if (task.recurring === 'monthly') next.setMonth(next.getMonth() + 1);
      await pool.query(
        `INSERT INTO tasks (title, notes, due_date, priority, category, tag, recurring, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [task.title, task.notes, next.toISOString().split('T')[0], task.priority, task.category, task.tag, task.recurring, task.source]
      );
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/completed", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tasks WHERE done = true ORDER BY completed_at DESC LIMIT 50");
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pa/briefing", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (data.quotes) data.quotes = data.quotes.filter(q => q.name && q.name.trim() && q.name !== "New Quote" && q.clientName && q.clientName.trim());
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pa/chat", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (data.quotes) data.quotes = data.quotes.filter(q => q.name && q.name.trim() && q.name !== "New Quote" && q.clientName && q.clientName.trim());
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get("/api/calendar", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/calendar-events", {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.get("/api/shoot-planner", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/daily-hq-summary", {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    if (data.quotes) data.quotes = data.quotes.filter(q => q.name && q.name.trim() && q.name !== "New Quote" && q.clientName && q.clientName.trim());
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});


app.get("/api/gmail-summary", async (req, res) => {
  try {
    const taskRes = await pool.query("SELECT title FROM tasks WHERE done = false");
    const taskTitles = taskRes.rows.map(r => r.title).join('||');
    const reset = req.query.reset ? "&reset=1" : "";
    const url = "https://shoot-planner.ryanballphotography.com/api/gmail-summary?tasks=" + encodeURIComponent(taskTitles) + reset;
    const response = await fetch(url, {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});



app.post("/api/gmail-skip", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/gmail-skip", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.DAILY_HQ_SECRET },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});


app.patch("/api/tasks/:id/timeblock", async (req, res) => {
  const { time_block } = req.body;
  try {
    const result = await pool.query(
      'UPDATE tasks SET time_block = $1 WHERE id = $2 RETURNING *',
      [time_block || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({error: err.message}); }
});


app.post("/api/tasks/reorder", async (req, res) => {
  const { taskId, targetTaskId, date, block } = req.body;
  try {
    // Get all tasks in this block
    const result = await pool.query(
      'SELECT id, sort_order FROM tasks WHERE due_date::date = $1 AND time_block = $2 AND done = false ORDER BY sort_order ASC, id ASC',
      [date, block]
    );
    let ids = result.rows.map(r => r.id);
    // Move taskId to position of targetTaskId
    ids = ids.filter(id => id !== taskId);
    const targetIdx = ids.indexOf(targetTaskId);
    if (targetIdx === -1) {
      ids.push(taskId);
    } else {
      ids.splice(targetIdx, 0, taskId);
    }
    // Update sort_order for all
    for (let i = 0; i < ids.length; i++) {
      await pool.query('UPDATE tasks SET sort_order = $1 WHERE id = $2', [i, ids[i]]);
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});


const DEFAULT_SHOOT_TASKS = [
  'Pencil Studio',
  'Pencil Stylists',
  'Pencil Assistant',
  'Confirm shoot dates with client',
  'Receive brief / PPM notes',
  'Write shot list',
  'Props sourced',
  'Products received',
  'Confirm Studio, Stylists and Assistants',
  'Deliver Brief to Stylists',
  'Images backed up',
  'Retouch Images',
  'Client approval on selects',
  'Deliver Images',
  'Purchase Order received',
  'Invoice Client'
];

app.get("/api/shoot-tasks/:shootId", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM shoot_tasks WHERE shoot_id = $1 ORDER BY sort_order ASC, id ASC',
      [req.params.shootId]
    );
    res.json(result.rows);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.post("/api/shoot-tasks/:shootId/generate", async (req, res) => {
  const { shootName } = req.body;
  try {
    // Check if tasks already exist
    const existing = await pool.query('SELECT id FROM shoot_tasks WHERE shoot_id = $1', [req.params.shootId]);
    if (existing.rows.length > 0) return res.json({ skipped: true, message: 'Tasks already exist' });
    // Insert default tasks
    for (let i = 0; i < DEFAULT_SHOOT_TASKS.length; i++) {
      await pool.query(
        'INSERT INTO shoot_tasks (shoot_id, shoot_name, title, sort_order) VALUES ($1, $2, $3, $4)',
        [req.params.shootId, shootName, DEFAULT_SHOOT_TASKS[i], i]
      );
    }
    const result = await pool.query('SELECT * FROM shoot_tasks WHERE shoot_id = $1 ORDER BY sort_order ASC', [req.params.shootId]);
    res.json(result.rows);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.patch("/api/shoot-tasks/:id/complete", async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE shoot_tasks SET done = NOT done, completed_at = CASE WHEN done THEN NULL ELSE NOW() END WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.patch("/api/shoot-tasks/:id", async (req, res) => {
  const { due_date } = req.body;
  try {
    const result = await pool.query(
      'UPDATE shoot_tasks SET due_date = $1 WHERE id = $2 RETURNING *',
      [due_date || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.get("/api/shoot-tasks-today", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM shoot_tasks WHERE done = false AND due_date = CURRENT_DATE ORDER BY sort_order ASC"
    );
    res.json(result.rows);
  } catch(err) { res.status(500).json({error: err.message}); }
});

// ── CRM contacts from shoot planner shared DB ─────────────────────────────────
app.get("/api/crm-contacts", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/crm-summary", {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Marketing contacts ────────────────────────────────────────────────────────
app.get("/api/marketing-contacts", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM marketing_contacts ORDER BY created_at ASC");
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/marketing-contacts", async (req, res) => {
  const { id, type, name, role, agency, org_type, crm_id, notes, stage, last_touchpoint, influence, from_crm } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO marketing_contacts (id, type, name, role, agency, org_type, crm_id, notes, stage, last_touchpoint, last_touch_type, influence, from_crm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         type=EXCLUDED.type, name=EXCLUDED.name, role=EXCLUDED.role,
         agency=EXCLUDED.agency, org_type=EXCLUDED.org_type, notes=EXCLUDED.notes,
         stage=EXCLUDED.stage, last_touchpoint=EXCLUDED.last_touchpoint,
         influence=EXCLUDED.influence, from_crm=EXCLUDED.from_crm
       RETURNING *`,
      [id, type||'target', name, role||null, agency||null, org_type||null, crm_id||null, notes||null, stage||'new', last_touchpoint||null, req.body.last_touch_type||null, influence||'key', from_crm||false]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/marketing-contacts/:id", async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  try {
    const result = await pool.query(
      `UPDATE marketing_contacts SET ${setClause}, updated_at=NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/marketing-contacts/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM marketing_contacts WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Marketing content (feed posts + mailers) ─────────────────────────────────
app.get("/api/marketing-content", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM marketing_content ORDER BY created_at DESC");
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/marketing-content", async (req, res) => {
  const { type, note, planned_date } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO marketing_content (type, note, planned_date)
       VALUES ($1,$2,$3) RETURNING *`,
      [type, note || null, planned_date || null]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/marketing-content/:id", async (req, res) => {
  const { note, planned_date, sent_at } = req.body;
  try {
    const result = await pool.query(
      `UPDATE marketing_content SET note=$1, planned_date=$2, sent_at=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [note || null, planned_date || null, sent_at || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Daily HQ running on ${PORT}`)));
// temp debug
