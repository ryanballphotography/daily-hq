const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

// Load .env from home directory
const envPath = os.homedir() + '/.invoice_drafter.env';
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const app = express();
const TOKEN_FILE = os.homedir() + '/.invoice_drafter_tokens.json';

let googleTokens = null;
try {
  if (fs.existsSync(TOKEN_FILE)) {
    googleTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    console.log('Loaded saved Google tokens');
  }
} catch(e) { googleTokens = null; }

function saveGoogleTokens(tokens) {
  googleTokens = tokens;
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens), 'utf8'); } catch(e) {}
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_KEY        = process.env.ANTHROPIC_KEY;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT      = 'http://localhost:4123/auth/google/callback';
const FA_CLIENT_ID         = process.env.FA_CLIENT_ID;
const FA_CLIENT_SECRET     = process.env.FA_CLIENT_SECRET;
const FA_REFRESH_TOKEN     = process.env.FA_REFRESH_TOKEN;
const PORT = 4123;

let oauthState = null;

app.post('/api/fa/refresh', async (req, res) => {
  try {
    const r = await fetch('https://api.freeagent.com/v2/token_endpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: FA_REFRESH_TOKEN,
        client_id: FA_CLIENT_ID,
        client_secret: FA_CLIENT_SECRET
      })
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/freeagent', async (req, res) => {
  const { endpoint, accessToken } = req.body;
  try {
    const r = await fetch(`https://api.freeagent.com/v2/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    const data = await r.json();
    res.json({ status: r.status, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/claude', async (req, res) => {
  const { prompt } = req.body;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const text = await r.text();
    try { res.json(JSON.parse(text)); }
    catch(e) { res.status(500).json({ error: 'Parse error', raw: text.slice(0, 300) }); }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/auth/google', (req, res) => {
  oauthState = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state: oauthState
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (state !== oauthState) return res.status(400).send('Invalid state');
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT,
        grant_type: 'authorization_code'
      })
    });
    const data = await r.json();
    if (data.access_token) {
      saveGoogleTokens(data);
      res.send('<script>window.close(); window.opener && window.opener.postMessage("google_authed", "*");</script><p>Connected! You can close this window.</p>');
    } else {
      res.status(400).json({ error: 'No access token returned', data });
    }
  } catch (e) {
    res.status(500).send('OAuth error: ' + e.message);
  }
});

app.get('/api/google/status', async (req, res) => {
  if (!googleTokens) return res.json({ connected: false });
  try {
    if (googleTokens.refresh_token) {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: googleTokens.refresh_token,
          grant_type: 'refresh_token'
        })
      });
      const refreshed = await r.json();
      if (refreshed.access_token) saveGoogleTokens({ ...googleTokens, ...refreshed });
    }
    const ur = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': 'Bearer ' + googleTokens.access_token }
    });
    const user = await ur.json();
    res.json({ connected: true, email: user.email });
  } catch(e) {
    res.json({ connected: false });
  }
});

app.post('/api/gmail/draft', async (req, res) => {
  const { to, subject, body } = req.body;
  if (!googleTokens) return res.status(401).json({ error: 'Not connected to Google' });
  try {
    if (googleTokens.refresh_token) {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: googleTokens.refresh_token,
          grant_type: 'refresh_token'
        })
      });
      const refreshed = await r.json();
      if (refreshed.access_token) saveGoogleTokens({ ...googleTokens, ...refreshed });
    }

    const htmlSignature = `<br><br>Kind Regards,<br>Ryan Ball<br><br><img src="https://f7120cd827be88cb5912-ba4442754be80b8cca711d2e2c7f72bc.ssl.cf1.rackcdn.com/NEWLOGOMASTER-1A1A1ABlack1000px.png" width="200" style="display:block;margin:0;">+44 (0)7812 671 163<br><a href="mailto:ryan@ryanballphotography.com" style="color:#000000;text-decoration:none;">ryan@ryanballphotography.com</a><br><a href="https://ryanballphotography.com" style="color:#000000;text-decoration:none;">ryanballphotography.com</a>`;
    const htmlBody = body.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

    const email = [
      'To: ' + to,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body>' + htmlBody + htmlSignature + '</body></html>'
    ].join('\r\n');

    const encoded = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const dr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + googleTokens.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: { raw: encoded } })
    });

    const draft = await dr.json();
    if (draft.id) {
      res.json({ success: true, draftId: draft.id });
    } else {
      console.error('Draft creation failed:', JSON.stringify(draft));
      res.status(500).json({ error: 'Failed to create draft', detail: draft });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/gmail/signature', async (req, res) => {
  if (!googleTokens) return res.status(401).json({ error: 'Not connected' });
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
      headers: { 'Authorization': 'Bearer ' + googleTokens.access_token }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('\n✅ Invoice Drafter running at http://localhost:' + PORT + '\n');
});
