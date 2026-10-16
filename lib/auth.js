// Login, TOTP, sessions and sign-out, as an Express router plus the checkAuth
// middleware. Kept out of server.js so tests can mount it on a throwaway app
// with an in-memory database and a fake clock.
const crypto = require('crypto');
const express = require('express');
const sessions = require('./sessions');

const OPEN_PATHS = ['/login', '/login/verify', '/login/2fa', '/api/siri/add-task'];

function totpAt(secret, counter) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const out = [];
  for (const c of secret.toUpperCase().replace(/=+$/, '')) {
    val = (val << 5) | alpha.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((val >> (bits - 8)) & 0xff); bits -= 8; }
  }
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  const h = crypto.createHmac('sha1', Buffer.from(out)).update(buf).digest();
  const o = h[19] & 0xf;
  return ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
}

function verifyTotp(secret, code, now) {
  if (!/^\d{6}$/.test(String(code || '').trim())) return false;
  const input = parseInt(code, 10);
  const counter = Math.floor(now / 30000);
  return [0, -1, 1].some(drift => totpAt(secret, counter + drift) === input);
}

// Constant-time string compare (hash first so differing lengths don't leak).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createAuth({ db, env = process.env, sendAlert = async () => {}, now = () => Date.now() }) {
  const router = express.Router();
  const cookieOpts = maxAge => ({ httpOnly: true, secure: true, sameSite: 'lax', maxAge });
  const clearOpts = { httpOnly: true, secure: true, sameSite: 'lax' };

  // In-memory, per IP: 10 attempts per 15 minutes. Resets on restart.
  const attempts = {};
  function rateLimit(req, res, next) {
    const ip = req.ip;
    const t = now();
    attempts[ip] = (attempts[ip] || []).filter(a => t - a < 15 * 60 * 1000);
    if (attempts[ip].length >= 10) return res.status(429).send('Too many attempts. Try again in 15 minutes.');
    attempts[ip].push(t);
    next();
  }

  function alertLogin(req, how) {
    const when = new Date(now()).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'long' });
    const body = [
      'A new Daily HQ login just happened.',
      '',
      'When:    ' + when,
      'How:     ' + how,
      'IP:      ' + req.ip,
      'Browser: ' + (req.get('user-agent') || 'unknown'),
      '',
      "If this wasn't you, open Daily HQ and use \"Sign out everywhere\", then change HQ_PASSWORD (and HQ_TOTP_SECRET if the login went through 2FA)."
    ].join('\n');
    // Don't hold up the redirect on SMTP; sendAlert logs its own failures.
    Promise.resolve(sendAlert('Daily HQ login — ' + how, body)).catch(e => console.error('Login alert failed:', e.message));
  }

  async function startSession(res) {
    const token = await sessions.issue(db, 'session', now());
    res.cookie('hq_token', token, cookieOpts(sessions.TTL.session));
  }

  router.post('/login', rateLimit, express.urlencoded({ extended: false }), async (req, res) => {
    const { username, password } = req.body || {};
    const validUser = env.HQ_USERNAME || 'ryan';
    const validPass = env.HQ_PASSWORD;
    if (!validPass || !safeEqual(username || '', validUser) || !safeEqual(password || '', validPass)) {
      return res.redirect('/login?error=1');
    }
    const trustedToken = req.cookies['hq_trusted'];
    const trusted = await sessions.find(db, 'trusted', trustedToken, now());
    if (trusted) {
      await sessions.renew(db, 'trusted', trustedToken, trusted, now());
      res.cookie('hq_trusted', trustedToken, cookieOpts(sessions.TTL.trusted));
      await startSession(res);
      alertLogin(req, 'password, trusted device (2FA skipped)');
      return res.redirect('/');
    }
    const pending = await sessions.issue(db, 'pending', now());
    res.cookie('hq_temp', pending, cookieOpts(sessions.TTL.pending));
    res.redirect('/login/2fa');
  });

  router.post('/login/verify', rateLimit, express.urlencoded({ extended: false }), async (req, res) => {
    const pending = req.cookies['hq_temp'];
    if (!(await sessions.find(db, 'pending', pending, now()))) return res.redirect('/login');
    const secret = env.HQ_TOTP_SECRET;
    if (!secret || !verifyTotp(secret, (req.body || {}).code, now())) return res.redirect('/login/2fa?error=1');
    await sessions.revoke(db, pending);
    res.clearCookie('hq_temp', clearOpts);
    await startSession(res);
    const trustedToken = await sessions.issue(db, 'trusted', now());
    res.cookie('hq_trusted', trustedToken, cookieOpts(sessions.TTL.trusted));
    alertLogin(req, 'password + 2FA code');
    res.redirect('/');
  });

  // Signs out this browser only. The trusted-device token goes too, so the
  // next login here asks for a 2FA code.
  router.post('/logout', async (req, res) => {
    await sessions.revoke(db, req.cookies['hq_token']);
    await sessions.revoke(db, req.cookies['hq_trusted']);
    res.clearCookie('hq_token', clearOpts);
    res.clearCookie('hq_trusted', clearOpts);
    res.redirect('/login');
  });

  // Every session and trusted device, on every browser, including this one.
  // Runs behind checkAuth, so only a signed-in browser can trigger it.
  router.post('/logout/all', async (req, res) => {
    await sessions.revokeAll(db);
    res.clearCookie('hq_token', clearOpts);
    res.clearCookie('hq_trusted', clearOpts);
    Promise.resolve(sendAlert('Daily HQ — signed out everywhere',
      'Every Daily HQ session and trusted device was just revoked from ' + req.ip + ' (' + (req.get('user-agent') || 'unknown browser') + ').'
    )).catch(e => console.error('Alert failed:', e.message));
    res.redirect('/login');
  });

  async function checkAuth(req, res, next) {
    if (OPEN_PATHS.includes(req.path)) return next();
    const deny = () => req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Unauthorised' })
      : res.redirect('/login');
    try {
      const token = req.cookies['hq_token'];
      const t = now();
      const session = await sessions.find(db, 'session', token, t);
      if (!session) return deny();
      // Sliding renewal: keep the session — and this browser's trusted-device
      // token alongside it — alive for as long as it's actually being used.
      if (await sessions.renew(db, 'session', token, session, t)) {
        res.cookie('hq_token', token, cookieOpts(sessions.TTL.session));
        const trustedToken = req.cookies['hq_trusted'];
        const trusted = await sessions.find(db, 'trusted', trustedToken, t);
        if (trusted && await sessions.renew(db, 'trusted', trustedToken, trusted, t)) {
          res.cookie('hq_trusted', trustedToken, cookieOpts(sessions.TTL.trusted));
        }
      }
      next();
    } catch (e) {
      console.log('Auth error:', e.message);
      deny();
    }
  }

  return { router, checkAuth };
}

module.exports = { createAuth, verifyTotp, totpAt };
