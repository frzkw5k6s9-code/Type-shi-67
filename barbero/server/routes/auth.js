import { HttpError, unauthorized, conflict } from '../errors.js';
import { parse, str, email, personName, phone, password, oneOf } from '../validate.js';
import { checkPasswordPolicy, sha256Hex } from '../security.js';
import { createSession, destroySession, destroyUserSessions, publicUser } from '../session.js';
import { audit, notify } from '../db.js';

const tooMany = (retryAfter) => new HttpError(429, 'too_many_attempts', 'too_many_attempts', { retryAfter });

export function register(r) {
  r.add('GET', '/api/auth/me', { auth: 'public', allowMustChange: true }, ({ user, session }) =>
    user ? { user: publicUser(user), csrf: session.csrf } : { user: null }
  );

  // ---- sign-up (customers only: the role is NEVER taken from input) -------------------------
  r.add('POST', '/api/auth/register', { auth: 'public', csrf: false }, async (ctx) => {
    const { cfg, db, hasher, limiter, ip } = ctx;
    const gate = limiter.hit(`reg:${ip}`, cfg.limits.registerPerIp);
    if (!gate.ok) throw tooMany(gate.retryAfter);

    const b = parse(ctx.body, {
      name: personName(),
      email: email(),
      phone: phone(),
      password: password(),
    });
    const bad = checkPasswordPolicy(b.password, { email: b.email, name: b.name });
    if (bad) throw new HttpError(400, bad, bad, { field: 'password' });

    const pw_hash = await hasher.hash(b.password);
    let id;
    try {
      id = db
        .prepare("INSERT INTO users (email, name, phone, role, pw_hash, created_at, last_login_at) VALUES (?, ?, ?, 'customer', ?, ?, ?)")
        .run(b.email, b.name, b.phone, pw_hash, Date.now(), Date.now()).lastInsertRowid;
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) throw conflict('email_taken');
      throw e;
    }
    notify(db, Number(id), 'welcome');
    audit(db, Number(id), 'register', '', ip);

    const user = { id: Number(id), email: b.email, name: b.name, phone: b.phone, role: 'customer', mustChange: false };
    const csrf = createSession(ctx, user.id, 'customer');
    ctx.status = 201;
    return { user: publicUser(user), csrf };
  });

  // ---- sign-in ----------------------------------------------------------------------------
  r.add('POST', '/api/auth/login', { auth: 'public', csrf: false }, async (ctx) => {
    const { cfg, db, hasher, limiter, ip } = ctx;
    const b = parse(ctx.body, { email: email(), password: password(), portal: oneOf(['customer', 'admin']) });

    // Layered brute-force protection: per IP, per (account, IP) and per account across all IPs.
    const eh = sha256Hex(b.email);
    const keys = [
      [`lg:ip:${ip}`, cfg.limits.loginPerIp],
      [`lg:ei:${eh}:${ip}`, cfg.limits.loginPerEmailIp],
      [`lg:e:${eh}`, cfg.limits.loginPerEmail],
    ];
    for (const [k, [limit]] of keys) {
      const c = limiter.check(k, limit);
      if (!c.ok) throw tooMany(c.retryAfter);
    }

    const row = db.prepare('SELECT id, email, name, phone, role, pw_hash, must_change FROM users WHERE email = ?').get(b.email);
    // Same amount of hashing work whether or not the account exists (no timing oracle for e-mails).
    const res = row ? await hasher.verify(b.password, row.pw_hash) : await hasher.verifyDummy(b.password);
    const portalMatches = row && (b.portal === 'admin') === (row.role === 'admin');

    if (!res.ok || !portalMatches) {
      for (const [k, [, windowMs]] of keys) limiter.add(k, windowMs);
      if (row) audit(db, row.id, 'login_failed', b.portal, ip);
      // One generic message for: unknown e-mail, wrong password, wrong portal.
      throw unauthorized('invalid_credentials');
    }

    limiter.reset(keys[1][0]);
    limiter.reset(keys[2][0]);
    if (res.needsRehash) db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hasher.hash(b.password), row.id);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
    audit(db, row.id, 'login', b.portal, ip);

    // Fresh session id on every login (prevents session fixation); any pre-login session is dropped.
    if (ctx.session) destroySession(ctx);
    const user = { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role, mustChange: row.must_change === 1 };
    const csrf = createSession(ctx, user.id, user.role);
    return { user: publicUser(user), csrf };
  });

  r.add('POST', '/api/auth/logout', { auth: 'public', allowMustChange: true }, (ctx) => {
    if (ctx.session) {
      audit(ctx.db, ctx.user.id, 'logout', '', ctx.ip);
      destroySession(ctx);
    }
    return { ok: true };
  });

  r.add('POST', '/api/auth/password', { auth: 'user', allowMustChange: true }, async (ctx) => {
    const { db, hasher, limiter, ip, user, cfg } = ctx;
    const gate = limiter.hit(`pw:${user.id}`, [8, 15 * 60_000]);
    if (!gate.ok) throw tooMany(gate.retryAfter);
    const b = parse(ctx.body, { current: password(), next: password() });
    const row = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(user.id);
    if (!(await hasher.verify(b.current, row.pw_hash)).ok) throw unauthorized('invalid_credentials');
    const bad = checkPasswordPolicy(b.next, { email: user.email, name: user.name });
    if (bad) throw new HttpError(400, bad, bad, { field: 'next' });
    if (b.next === b.current) throw new HttpError(400, 'password_same', 'password_same', { field: 'next' });
    db.prepare('UPDATE users SET pw_hash = ?, must_change = 0 WHERE id = ?').run(await hasher.hash(b.next), user.id);
    destroyUserSessions(db, user.id); // log out every device, then start a fresh session for this one
    audit(db, user.id, 'password_changed', '', ip);
    const csrf = createSession(ctx, user.id, user.role);
    return { ok: true, csrf };
  });
}
