// End-to-end tests for login, 2FA, sliding sessions and sign-out. Each test
// mounts lib/auth.js on a real Express app over real HTTP, backed by pg-mem
// (an in-memory Postgres) and a fake clock, with a tiny cookie jar per
// "browser".
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const { newDb } = require('pg-mem');
const sessions = require('./sessions');
const { createAuth, verifyTotp, totpAt } = require('./auth');

const SECRET = 'JBSWY3DPEHPK3PXP';
const ENV = { HQ_USERNAME: 'ryan', HQ_PASSWORD: 'correct horse', HQ_TOTP_SECRET: SECRET };
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function setup(t) {
  const { Pool } = newDb().adapters.createPg();
  const db = new Pool();
  await sessions.ensureSchema(db);
  const clock = { now: Date.UTC(2026, 9, 16, 9, 0, 0) };
  const alerts = [];
  const auth = createAuth({ db, env: ENV, now: () => clock.now, sendAlert: async (subject, body) => alerts.push({ subject, body }) });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(auth.checkAuth);
  app.use(auth.router);
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.send('home'));
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const code = () => String(totpAt(SECRET, Math.floor(clock.now / 30000))).padStart(6, '0');
  return { db, clock, alerts, base, code };
}

// A browser: keeps cookies between requests and records the last response's
// Set-Cookie attributes so tests can check flags and Max-Age.
function browser(base) {
  const jar = {};
  let lastSet = {};
  async function req(method, path, form) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), 'user-agent': 'TestBrowser/1.0' };
    let body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    lastSet = {};
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map(s => s.trim());
      const [name, ...rest] = pair.split('=');
      const value = decodeURIComponent(rest.join('='));
      lastSet[name] = { value, attrs: attrs.map(a => a.toLowerCase()) };
      const expired = attrs.some(a => /^expires=thu, 01 jan 1970/i.test(a)) || attrs.some(a => /^max-age=0$/i.test(a));
      if (expired || value === '') delete jar[name]; else jar[name] = value;
    }
    return { status: res.status, location: res.headers.get('location') };
  }
  return { jar, req, lastSet: () => lastSet };
}

// Full password + TOTP login. Returns the browser, signed in.
async function login(env, b = browser(env.base)) {
  let r = await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.location, '/login/2fa');
  r = await b.req('POST', '/login/verify', { code: env.code() });
  assert.strictEqual(r.location, '/');
  return b;
}

const pingStatus = async b => (await b.req('GET', '/api/ping')).status;

test('password + 2FA login issues session and trusted cookies with the right flags and 7-day lifetime', async t => {
  const env = await setup(t);
  const b = browser(env.base);
  let r = await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.location, '/login/2fa');
  assert.ok(b.jar.hq_temp, 'pending cookie set');
  assert.ok(!b.jar.hq_token, 'no session before 2FA');
  assert.strictEqual(await pingStatus(b), 401, 'pending token alone does not authenticate');

  r = await b.req('POST', '/login/verify', { code: env.code() });
  assert.strictEqual(r.location, '/');
  const set = b.lastSet();
  for (const name of ['hq_token', 'hq_trusted']) {
    assert.ok(set[name], name + ' set');
    assert.match(set[name].value, /^[0-9a-f]{64}$/);
    for (const flag of ['httponly', 'secure', 'samesite=lax', 'max-age=604800']) {
      assert.ok(set[name].attrs.includes(flag), name + ' has ' + flag + ' (got ' + set[name].attrs.join(', ') + ')');
    }
  }
  assert.ok(!b.jar.hq_temp, 'pending cookie cleared');
  assert.strictEqual(await pingStatus(b), 200);
});

test('login alert email goes out on every successful login, with IP and browser', async t => {
  const env = await setup(t);
  const b = await login(env);
  assert.strictEqual(env.alerts.length, 1);
  assert.match(env.alerts[0].subject, /2FA/);
  assert.match(env.alerts[0].body, /IP:\s+\S*127\.0\.0\.1/);
  assert.match(env.alerts[0].body, /TestBrowser\/1\.0/);
  // Second login on the same (trusted) browser after dropping the session.
  delete b.jar.hq_token;
  await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(env.alerts.length, 2);
  assert.match(env.alerts[1].subject, /trusted device/);
});

test('wrong password or wrong code never creates a session or sends an alert', async t => {
  const env = await setup(t);
  const b = browser(env.base);
  let r = await b.req('POST', '/login', { username: 'ryan', password: 'nope' });
  assert.strictEqual(r.location, '/login?error=1');
  assert.deepStrictEqual(Object.keys(b.jar), []);
  r = await b.req('POST', '/login', { username: 'someone', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.location, '/login?error=1');

  await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  const wrong = String((Number(env.code()) + 1) % 1000000).padStart(6, '0');
  r = await b.req('POST', '/login/verify', { code: wrong });
  assert.strictEqual(r.location, '/login/2fa?error=1');
  assert.ok(!b.jar.hq_token);
  assert.strictEqual(env.alerts.length, 0);
});

test('no cookie: API gets 401, pages redirect to /login', async t => {
  const env = await setup(t);
  const b = browser(env.base);
  assert.strictEqual(await pingStatus(b), 401);
  const r = await b.req('GET', '/');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.location, '/login');
});

test('tampered, junk, or wrong-kind tokens are rejected', async t => {
  const env = await setup(t);
  const b = await login(env);
  const good = b.jar.hq_token;
  const flip = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
  for (const bad of [flip, good.toUpperCase(), good + '00', 'x'.repeat(64), '', "' OR 1=1 --", b.jar.hq_trusted]) {
    const other = browser(env.base);
    other.jar.hq_token = encodeURIComponent(bad);
    assert.strictEqual(await pingStatus(other), 401, 'rejected: ' + bad);
  }
  // A pending (pre-TOTP) token can't be used as a session.
  const half = browser(env.base);
  await half.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  half.jar.hq_token = half.jar.hq_temp;
  assert.strictEqual(await pingStatus(half), 401);
  // A session token can't stand in for a trusted device to skip 2FA.
  const sneaky = browser(env.base);
  sneaky.jar.hq_trusted = good;
  const r = await sneaky.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.location, '/login/2fa');
});

test('database stores only token hashes, never the cookie values', async t => {
  const env = await setup(t);
  const b = await login(env);
  const rows = (await env.db.query('SELECT token_hash FROM hq_auth_tokens')).rows.map(r => r.token_hash);
  assert.ok(rows.length >= 2);
  assert.ok(!rows.includes(b.jar.hq_token));
  assert.ok(!rows.includes(b.jar.hq_trusted));
});

test('session expires after 7 days with no activity', async t => {
  const env = await setup(t);
  const a = await login(env);
  const b = await login(env);
  env.clock.now += 7 * DAY - MIN;
  assert.strictEqual(await pingStatus(a), 200, 'still valid a minute short of 7 days');
  env.clock.now += 2 * MIN;
  assert.strictEqual(await pingStatus(b), 401, 'expired a minute past 7 days');
});

test('sliding: daily-ish use keeps the session alive well past 7 days', async t => {
  const env = await setup(t);
  const b = await login(env);
  for (let day = 0; day < 30; day += 5) {
    env.clock.now += 5 * DAY;
    assert.strictEqual(await pingStatus(b), 200, 'still signed in on day ' + (day + 5));
    const set = b.lastSet().hq_token;
    assert.ok(set && set.attrs.includes('max-age=604800'), 'cookie re-sent with a fresh 7-day maxAge');
  }
  // Then a full 7 days of silence ends it.
  env.clock.now += 7 * DAY + MIN;
  assert.strictEqual(await pingStatus(b), 401);
});

test('renewal is throttled to once an hour (no write or cookie on every request)', async t => {
  const env = await setup(t);
  const b = await login(env);
  env.clock.now += 30 * MIN;
  assert.strictEqual(await pingStatus(b), 200);
  assert.ok(!b.lastSet().hq_token, 'no renewal within the first hour');
  env.clock.now += 31 * MIN;
  assert.strictEqual(await pingStatus(b), 200);
  assert.ok(b.lastSet().hq_token, 'renewed after an hour');
});

test('trusted device skips 2FA, and is kept alive alongside the session', async t => {
  const env = await setup(t);
  const b = await login(env);
  // Use the app every 5 days for 20 days — well past the trusted token's
  // original 7 days — then lose the session cookie (e.g. cleared).
  for (let i = 0; i < 4; i++) { env.clock.now += 5 * DAY; assert.strictEqual(await pingStatus(b), 200); }
  delete b.jar.hq_token;
  const r = await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.location, '/', 'password alone is enough on a trusted device');
  assert.strictEqual(await pingStatus(b), 200);
});

test('trusted device lapses after 7 idle days, back to needing the code', async t => {
  const env = await setup(t);
  const b = await login(env);
  env.clock.now += 7 * DAY + MIN;
  const r = await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.location, '/login/2fa');
});

test('pending 2FA step expires after 5 minutes and cannot be replayed', async t => {
  const env = await setup(t);
  const b = browser(env.base);
  await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  const pending = b.jar.hq_temp;
  env.clock.now += 5 * MIN + 1000;
  let r = await b.req('POST', '/login/verify', { code: env.code() });
  assert.strictEqual(r.location, '/login', 'expired pending step');

  const c = browser(env.base);
  await c.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  const used = c.jar.hq_temp;
  await c.req('POST', '/login/verify', { code: env.code() });
  const replay = browser(env.base);
  replay.jar.hq_temp = used;
  r = await replay.req('POST', '/login/verify', { code: env.code() });
  assert.strictEqual(r.location, '/login', 'used pending token is gone');
  assert.ok(!replay.jar.hq_token);
  assert.ok(pending !== used);
});

test('sign out (this browser) revokes its session and trusted device only', async t => {
  const env = await setup(t);
  const a = await login(env);
  const b = await login(env);
  const aToken = a.jar.hq_token, aTrusted = a.jar.hq_trusted;
  const r = await a.req('POST', '/logout');
  assert.strictEqual(r.location, '/login');
  assert.ok(!a.jar.hq_token && !a.jar.hq_trusted, 'cookies cleared');
  const ghost = browser(env.base);
  ghost.jar.hq_token = aToken;
  assert.strictEqual(await pingStatus(ghost), 401, 'old session token revoked server-side');
  ghost.jar.hq_trusted = aTrusted;
  assert.strictEqual((await ghost.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD })).location, '/login/2fa', 'old trusted token revoked');
  assert.strictEqual(await pingStatus(b), 200, 'other browser unaffected');
});

test('sign out everywhere revokes every session and trusted device, including its own', async t => {
  const env = await setup(t);
  const a = await login(env);
  const b = await login(env);
  const bTrusted = b.jar.hq_trusted;
  const r = await a.req('POST', '/logout/all');
  assert.strictEqual(r.location, '/login');
  assert.strictEqual(await pingStatus(a), 401);
  assert.strictEqual(await pingStatus(b), 401, 'the "lost laptop" is signed out');
  const relogin = browser(env.base);
  relogin.jar.hq_trusted = bTrusted;
  assert.strictEqual((await relogin.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD })).location, '/login/2fa', 'lost laptop needs 2FA again');
  assert.ok(env.alerts.some(x => /signed out everywhere/.test(x.subject)));
  // And a fresh login afterwards works normally.
  const c = await login(env);
  assert.strictEqual(await pingStatus(c), 200);
});

test('sign out everywhere cannot be triggered without a valid session', async t => {
  const env = await setup(t);
  const victim = await login(env);
  const stranger = browser(env.base);
  const r = await stranger.req('POST', '/logout/all');
  assert.strictEqual(r.location, '/login');
  assert.strictEqual(await pingStatus(victim), 200, 'nothing revoked');
});

test('login attempts are rate limited to 10 per 15 minutes', async t => {
  const env = await setup(t);
  const b = browser(env.base);
  for (let i = 0; i < 10; i++) await b.req('POST', '/login', { username: 'ryan', password: 'wrong' });
  let r = await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.status, 429, 'even the right password is refused while limited');
  env.clock.now += 15 * MIN + 1000;
  r = await b.req('POST', '/login', { username: 'ryan', password: ENV.HQ_PASSWORD });
  assert.strictEqual(r.location, '/login/2fa');
});

test('expired tokens are purged', async t => {
  const env = await setup(t);
  await login(env);
  env.clock.now += 8 * DAY;
  await sessions.purgeExpired(env.db, env.clock.now);
  assert.strictEqual((await env.db.query('SELECT * FROM hq_auth_tokens')).rows.length, 0);
});

test('TOTP accepts the current and adjacent 30s windows only, and rejects junk', () => {
  const now = Date.UTC(2026, 9, 16, 9, 0, 0);
  const c = Math.floor(now / 30000);
  const fmt = n => String(n).padStart(6, '0');
  assert.ok(verifyTotp(SECRET, fmt(totpAt(SECRET, c)), now));
  assert.ok(verifyTotp(SECRET, fmt(totpAt(SECRET, c - 1)), now));
  assert.ok(verifyTotp(SECRET, fmt(totpAt(SECRET, c + 1)), now));
  assert.ok(!verifyTotp(SECRET, fmt(totpAt(SECRET, c - 3)), now));
  for (const junk of ['', '12345', '1234567', 'abcdef', undefined, null]) assert.ok(!verifyTotp(SECRET, junk, now));
});

test('TOTP matches the RFC 6238 SHA-1 test vector', () => {
  // RFC 6238 appendix B: key "12345678901234567890", T=59s -> 94287082 (8 digits); 6-digit = 287082.
  const key = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.strictEqual(totpAt(key, Math.floor(59 / 30)), 287082);
  assert.strictEqual(totpAt(key, Math.floor(1111111109 / 30)), 81804);
});
