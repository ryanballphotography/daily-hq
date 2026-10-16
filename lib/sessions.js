// Server-side login tokens: sessions, the 5-minute "password OK, waiting for
// the TOTP code" step, and trusted devices that skip TOTP.
//
// Every kind lives in one table so "sign out everywhere" is a single DELETE.
// Only a SHA-256 of each token is stored — the cookie value itself never
// touches the database, so a leaked DB dump can't be replayed as a login.
// Times are epoch milliseconds (BIGINT) passed in from JS rather than NOW(),
// which keeps timezone handling out of it and lets tests drive the clock.
const crypto = require('crypto');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const TTL = {
  session: 7 * DAY,
  trusted: 7 * DAY,  // matches the session, so an expiry never forces TOTP on its own
  pending: 5 * MINUTE
};

// Sliding expiry: each authenticated request pushes expiry out to now + TTL,
// but only writes once the last renewal is this old, so ordinary browsing
// doesn't UPDATE the row on every static file. Worst case, expiry lands up to
// an hour short of a full 7 days of inactivity.
const RENEW_AFTER = 60 * MINUTE;

const TOKEN_RE = /^[0-9a-f]{64}$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function ensureSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS hq_auth_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    kind VARCHAR(16) NOT NULL,
    expires_ms BIGINT NOT NULL,
    renewed_ms BIGINT NOT NULL,
    created_ms BIGINT NOT NULL
  )`);
}

async function issue(db, kind, now) {
  if (!TTL[kind]) throw new Error('Unknown token kind: ' + kind);
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    'INSERT INTO hq_auth_tokens (token_hash, kind, expires_ms, renewed_ms, created_ms) VALUES ($1, $2, $3, $4, $5)',
    [hashToken(token), kind, now + TTL[kind], now, now]
  );
  return token;
}

// Returns { expiresMs, renewedMs } for a live token of this kind, else null.
// The kind check matters: a pending (pre-TOTP) token must never pass as a
// session, nor a trusted-device token as either.
async function find(db, kind, token, now) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const result = await db.query(
    'SELECT expires_ms, renewed_ms FROM hq_auth_tokens WHERE token_hash = $1 AND kind = $2 AND expires_ms > $3',
    [hashToken(token), kind, now]
  );
  if (!result.rows.length) return null;
  return { expiresMs: Number(result.rows[0].expires_ms), renewedMs: Number(result.rows[0].renewed_ms) };
}

// Pushes expiry out to now + TTL if the last renewal is over RENEW_AFTER old.
// Returns true when it renewed, so the caller knows to re-send the cookie
// with a fresh maxAge.
async function renew(db, kind, token, row, now) {
  if (now - row.renewedMs < RENEW_AFTER) return false;
  await db.query(
    'UPDATE hq_auth_tokens SET expires_ms = $1, renewed_ms = $2 WHERE token_hash = $3 AND kind = $4',
    [now + TTL[kind], now, hashToken(token), kind]
  );
  return true;
}

async function revoke(db, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return;
  await db.query('DELETE FROM hq_auth_tokens WHERE token_hash = $1', [hashToken(token)]);
}

async function revokeAll(db) {
  await db.query('DELETE FROM hq_auth_tokens');
}

async function purgeExpired(db, now) {
  await db.query('DELETE FROM hq_auth_tokens WHERE expires_ms <= $1', [now]);
}

module.exports = { TTL, RENEW_AFTER, ensureSchema, issue, find, renew, revoke, revokeAll, purgeExpired };
