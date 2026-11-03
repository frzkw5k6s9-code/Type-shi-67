import { randomToken, sha256Hex } from './security.js';
import { serializeCookie } from './http.js';

/**
 * Server-side sessions. The browser only holds a random 256-bit token in an HttpOnly,
 * SameSite=Strict (and, in production, Secure + __Host- prefixed) cookie. The database
 * stores only SHA-256(token), so a leaked database cannot be replayed as live sessions.
 */
const HOUR = 3_600_000;
export const SESSION_LIMITS = {
  customer: { idle: 24 * HOUR, absolute: 7 * 24 * HOUR },
  admin: { idle: 30 * 60_000, absolute: 8 * HOUR }, // admins time out fast
};

export const cookieName = (cfg) => (cfg.cookieSecure ? '__Host-bsid' : 'bsid');

export function loadSession(ctx) {
  const { cfg, db } = ctx;
  const token = ctx.cookies[cookieName(cfg)];
  if (!token || token.length > 100) return;
  const hash = sha256Hex(token);
  const row = db
    .prepare(
      `SELECT s.csrf, s.created_at, s.last_seen,
              u.id, u.email, u.name, u.phone, u.role, u.must_change
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .get(hash);
  if (!row) return;
  const lim = SESSION_LIMITS[row.role];
  const now = Date.now();
  if (now - row.last_seen > lim.idle || now - row.created_at > lim.absolute) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return;
  }
  if (now - row.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, hash);
  ctx.session = { hash, csrf: row.csrf };
  ctx.user = { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role, mustChange: row.must_change === 1 };
}

/** Issue a brand-new session (always a fresh token => no session fixation). */
export function createSession(ctx, userId, role) {
  const { cfg, db } = ctx;
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(
    sha256Hex(token), userId, csrf, now, now
  );
  ctx.setCookie(serializeCookie(cookieName(cfg), token, { maxAge: SESSION_LIMITS[role].absolute / 1000, secure: cfg.cookieSecure }));
  return csrf;
}

export function destroySession(ctx) {
  if (ctx.session) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(ctx.session.hash);
  ctx.setCookie(serializeCookie(cookieName(ctx.cfg), '', { maxAge: 0, secure: ctx.cfg.cookieSecure }));
}

export function destroyUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db) {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?').run(now - SESSION_LIMITS.customer.idle, now - SESSION_LIMITS.customer.absolute);
}

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, mustChange: !!u.mustChange });
