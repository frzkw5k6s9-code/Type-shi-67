import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootServer, Client, raw, adminWithSlots, ADMIN, PASSWORD } from './helpers.js';
import { makeHasher } from '../server/security.js';

let S; // { app, base, db, close }
before(async () => { S = await bootServer(); });
after(async () => { await S.close(); });

const SQLI = [
  "' OR '1'='1", "' OR 1=1 --", "admin@barbero.test'--", '"; DROP TABLE users; --',
  "x'); DELETE FROM bookings; --", "' UNION SELECT pw_hash FROM users --", '1; PRAGMA writable_schema=1',
];
const XSS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', 'javascript:alert(1)', '{{constructor.constructor("alert(1)")()}}'];

const usersCount = () => S.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

/* ───────────────────────────── password storage ───────────────────────────── */

test('passwords: per-user random salt + PBKDF2-HMAC-SHA256, never plaintext', async () => {
  const h = makeHasher({ iterations: 2000, pepper: Buffer.from('pepper') });
  const a = await h.hash('Blue-Falcon-Ride-77');
  const b = await h.hash('Blue-Falcon-Ride-77');
  assert.match(a, /^pbkdf2-sha256\$2000\$[\w-]{22}\$[\w-]{43}$/); // 128-bit salt, 256-bit hash
  assert.notEqual(a, b, 'same password must hash differently (unique salts)');
  assert.equal((await h.verify('Blue-Falcon-Ride-77', a)).ok, true);
  assert.equal((await h.verify('blue-falcon-ride-77', a)).ok, false);
  assert.equal((await h.verify('x', 'garbage')).ok, false);
  const other = makeHasher({ iterations: 2000, pepper: Buffer.from('different') });
  assert.equal((await other.verify('Blue-Falcon-Ride-77', a)).ok, false, 'a wrong pepper must not verify');

  const c = new Client(S.base);
  assert.equal((await c.register(1)).status, 201);
  const row = S.db.prepare('SELECT pw_hash FROM users WHERE email = ?').get('cust1@example.com');
  assert.ok(row.pw_hash.startsWith('pbkdf2-sha256$'));
  assert.ok(!row.pw_hash.includes(PASSWORD));
  const rows = S.db.prepare('SELECT pw_hash FROM users').all();
  assert.equal(new Set(rows.map((r) => r.pw_hash.split('$')[2])).size, rows.length, 'every user has a distinct salt');
});

test('passwords: production work factor is >= 600,000 iterations', async () => {
  const { PBKDF2_ITERATIONS, loadConfig } = await import('../server/config.js');
  assert.ok(PBKDF2_ITERATIONS >= 600_000);
  assert.equal(loadConfig().pbkdf2Iterations, PBKDF2_ITERATIONS);
  assert.throws(() => loadConfig({ pbkdf2Iterations: 1000 }), /fewer than 100,000/);
});

test('passwords: weak / common / identity-based passwords are rejected', async () => {
  const c = new Client(S.base);
  for (const [pw, code] of [['short1', 'password_too_short'], ['password123', 'password_common'], ['1234567890123', 'password_weak'], ['aaaaaaaaaaaa', 'password_weak'], ['omar.alharbi-2024', 'password_contains_identity']]) {
    const r = await c.post('/api/auth/register', { name: 'Omar Alharbi', email: 'omar.alharbi@example.com', phone: '+966551234567', password: pw });
    assert.equal(r.status, 400, pw);
    assert.equal(r.json.error.code, code, pw);
  }
});

/* ───────────────────────────── SQL injection ───────────────────────────── */

test('SQLi: injection payloads in login never authenticate and never touch the schema', async () => {
  const before = usersCount();
  for (const p of SQLI) {
    const c = new Client(S.base);
    for (const body of [{ email: p, password: p, portal: 'customer' }, { email: ADMIN.email, password: p, portal: 'admin' }, { email: `${p}@x.com`, password: PASSWORD, portal: 'customer' }]) {
      const r = await c.post('/api/auth/login', body);
      assert.ok([400, 401].includes(r.status), `${p} -> ${r.status}`);
      assert.equal(c.cookie, '', 'no session may be issued');
    }
  }
  assert.equal(usersCount(), before);
  assert.ok(S.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('users','bookings','slots','sessions')").all().length === 4);
});

test('SQLi: payloads in registration fields are rejected by allow-list validation', async () => {
  const before = usersCount();
  for (const p of SQLI) {
    const c = new Client(S.base);
    for (const body of [
      { name: p, email: 'a1@example.com', phone: '+966551234567', password: PASSWORD },
      { name: 'Omar Alharbi', email: `${p}`, phone: '+966551234567', password: PASSWORD },
      { name: 'Omar Alharbi', email: 'a2@example.com', phone: p, password: PASSWORD },
    ]) assert.equal((await c.post('/api/auth/register', body)).status, 400, p);
  }
  assert.equal(usersCount(), before);
});

test('SQLi: injection in query strings / path params / free text is inert', async () => {
  const { admin, tomorrow } = await adminWithSlots(S.base, 3);
  const cust = new Client(S.base);
  await cust.register(2);

  for (const p of SQLI) {
    assert.equal((await cust.get(`/api/slots?date=${encodeURIComponent(p)}`)).status, 400);
    assert.equal((await admin.get(`/api/admin/slots?date=${encodeURIComponent(p)}`)).status, 400);
    assert.equal((await cust.post(`/api/bookings/${encodeURIComponent(p)}/cancel`, {})).status, 400);
  }
  // free-text "notes" is stored verbatim as DATA (and does not execute)
  const payload = "Robert'); DROP TABLE bookings;--";
  const svc = (await admin.get('/api/admin/services')).json.services[0].id;
  const b = await cust.post('/api/bookings', { date: tomorrow, hour: 12, chair: 5, serviceId: svc, notes: payload });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  const mine = await cust.get('/api/bookings/mine');
  assert.equal(mine.json.bookings.find((x) => x.id === b.json.booking.id).notes, payload);
  assert.ok(S.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'bookings'").get());

  // customer search: classic payloads + LIKE wildcards must not match "everything"
  const total = (await admin.get('/api/admin/customers?q=')).json.customers.length;
  assert.ok(total >= 2);
  for (const q of ["' OR '1'='1", "%' OR 1=1 --", '%', '_', '\\']) {
    const r = await admin.get(`/api/admin/customers?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.customers.length, 0, `q=${q} must match nothing`);
  }
});

test('SQLi guard: no query anywhere in /server is built by interpolation or concatenation', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(root);
  const offenders = [];
  let inspected = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    inspected += [...src.matchAll(/\bdb\.(?:prepare|exec)\(/g)].length;
    // every db.prepare( / db.exec( argument must be a plain string/template literal with NO ${...}, and no '+' concatenation
    for (const m of src.matchAll(/\bdb\.(?:prepare|exec)\(\s*([`'"])([\s\S]*?)\1\s*([+),])/g)) {
      if (m[1] === '`' && m[2].includes('${')) offenders.push(`${f}: interpolated template`);
      if (m[3] === '+') offenders.push(`${f}: concatenation`);
    }
    for (const m of src.matchAll(/\bdb\.(?:prepare|exec)\(\s*([A-Za-z_$][\w$.]*)\s*[,)]/g)) {
      if (!['SCHEMA'].includes(m[1])) offenders.push(`${f}: non-literal SQL argument "${m[1]}"`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(inspected > 50, `guard looked at only ${inspected} queries - is the regex still matching?`);
});

/* ───────────────────────────── XSS ───────────────────────────── */

test('XSS: script-bearing names are rejected at the door', async () => {
  for (const x of XSS) {
    const c = new Client(S.base);
    const r = await c.post('/api/auth/register', { name: x, email: 'xss@example.com', phone: '+966551234567', password: PASSWORD });
    assert.equal(r.status, 400, x);
  }
});

test('XSS: free text is stored raw but only ever served as JSON (nosniff) behind a strict CSP', async () => {
  const { admin, tomorrow } = await adminWithSlots(S.base, 3);
  const cust = new Client(S.base);
  await cust.register(3);
  const svc = (await admin.get('/api/admin/services')).json.services[0].id;
  const evil = '<img src=x onerror=alert(document.cookie)><script>alert(1)</script>';
  const b = await cust.post('/api/bookings', { date: tomorrow, hour: 13, chair: 2, serviceId: svc, notes: evil });
  assert.equal(b.status, 201);
  const grid = await admin.get(`/api/admin/slots?date=${tomorrow}`);
  assert.match(grid.headers.get('content-type'), /^application\/json/);
  assert.equal(grid.headers.get('x-content-type-options'), 'nosniff');
  const cell = grid.json.hours.find((h) => h.hour === 13).chairs.find((c) => c.chair === 2);
  assert.equal(cell.booking.notes, evil, 'returned as inert data; the UI renders it with textContent only');

  // admin broadcast text is also plain data
  const n = await admin.post('/api/admin/notify', { title: '<b>Sale</b>', body: '<script>alert(1)</script>' });
  assert.equal(n.status, 200);
  const list = await cust.get('/api/notifications');
  assert.equal(list.json.notifications.find((x) => x.code === 'message').title, '<b>Sale</b>');
});

test('XSS: every response carries the strict CSP + hardening headers (no unsafe-inline / unsafe-eval)', async () => {
  for (const path of ['/', '/login', '/api/public/info', '/css/base.css']) {
    const r = await raw(S.base, path);
    const csp = r.headers['content-security-policy'] || '';
    assert.match(csp, /default-src 'none'/, path);
    assert.match(csp, /script-src 'self'(;|$)/, path);
    assert.match(csp, /require-trusted-types-for 'script'/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.match(csp, /object-src 'none'/, path);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), `${path}: ${csp}`);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'same-origin');
    assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
    assert.ok(!r.headers['x-powered-by']);
  }
});

test('XSS: shipped HTML/JS contains no inline script, inline handler, style attribute or innerHTML', () => {
  const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(html|js)$/.test(p) && files.push(p); } })(pub);
  assert.ok(files.length > 0);
  const bad = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    if (f.endsWith('.html')) {
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(s)) bad.push(`${f}: inline <script>`);
      if (/\son[a-z]+\s*=/i.test(s)) bad.push(`${f}: inline event handler`);
      if (/\sstyle\s*=/i.test(s)) bad.push(`${f}: style attribute`);
      if (/<style/i.test(s)) bad.push(`${f}: <style>`);
    } else {
      const code = s.replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setAttribute\(\s*['"]on/.test(code)) bad.push(`${f}: DOM-XSS sink`);
    }
  }
  assert.deepEqual(bad, []);
});

/* ───────────────────────────── CSRF / request hygiene ───────────────────────────── */

test('CSRF: cross-origin and token-less state changes are rejected', async () => {
  const c = new Client(S.base);
  assert.equal((await c.register(4)).status, 201);
  assert.equal((await c.post('/api/bookings/1/cancel', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.post('/api/auth/login', { email: 'a@b.co', password: 'x', portal: 'customer' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.post('/api/auth/login', { email: 'a@b.co', password: 'x', portal: 'customer' }, { Origin: 'null' })).status, 403);
  assert.equal((await c.post('/api/auth/login', { email: 'a@b.co', password: 'x', portal: 'customer' }, { Origin: null, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const r1 = await c.post('/api/auth/password', { current: PASSWORD, next: 'Another-Strong-Pass-5' }, { 'X-CSRF-Token': null });
  assert.equal(r1.status, 403); assert.equal(r1.json.error.code, 'csrf');
  const r2 = await c.post('/api/auth/password', { current: PASSWORD, next: 'Another-Strong-Pass-5' }, { 'X-CSRF-Token': 'forged' });
  assert.equal(r2.status, 403);
});

test('hygiene: JSON-only bodies, size cap, unknown fields, wrong methods, bad Host', async () => {
  const c = new Client(S.base);
  assert.equal((await c.post('/api/auth/login', 'email=a&password=b', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await c.post('/api/auth/login', 'email=a', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await c.post('/api/auth/login', '{not json')).status, 400);
  assert.equal((await c.post('/api/auth/login', '[1,2]')).status, 400);
  assert.equal((await c.post('/api/auth/login', { email: 'a@b.co', password: 'x'.repeat(20_000), portal: 'customer' })).status, 413);
  assert.equal((await c.post('/api/auth/login', { email: 'a@b.co', password: 'x', portal: 'customer', isAdmin: true })).status, 400);
  assert.equal((await c.req('DELETE', '/api/public/info')).status, 405);
  assert.equal((await c.get('/api/nope')).status, 404);
  const r = await raw(S.base, '/api/public/info', { headers: { Host: 'evil.example' } });
  assert.equal(r.status, 421);
});

test('hygiene: errors never leak internals', async () => {
  const c = new Client(S.base);
  const r = await c.post('/api/auth/login', '{"email":', {});
  assert.ok(!/at .*\.js|Error:|SyntaxError|sqlite/i.test(r.text));
});

/* ───────────────────────────── AuthN / AuthZ ───────────────────────────── */

test('authz: anonymous -> 401, customer -> 403 on admin API, role cannot be self-assigned', async () => {
  const anon = new Client(S.base);
  for (const p of ['/api/slots?date=2030-01-01', '/api/bookings/mine', '/api/notifications', '/api/admin/summary', '/api/admin/audit']) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
  const cust = new Client(S.base);
  await cust.register(5);
  for (const [m, p, b] of [['GET', '/api/admin/summary'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/customers'], ['POST', '/api/admin/notify', { title: 'x', body: 'y' }], ['POST', '/api/admin/publish', { from: '2030-01-01', to: '2030-01-02', notify: true }], ['PUT', '/api/admin/template', { days: [] }], ['POST', '/api/admin/slots/set', { date: '2030-01-01', hours: [1], chairs: [1], status: 'blocked' }]]) {
    assert.equal((await cust.req(m, p, b)).status, 403, `${m} ${p}`);
  }
  const r = await new Client(S.base).post('/api/auth/register', { name: 'Evil Admin', email: 'evil@example.com', phone: '+966551234567', password: PASSWORD, role: 'admin' });
  assert.equal(r.status, 400);
  assert.equal(S.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n, 1);
});

test('authz: the two portals are separate (customer creds cannot open admin and vice-versa)', async () => {
  const c = new Client(S.base);
  await c.register(6);
  const cu = new Client(S.base);
  assert.equal((await cu.login('cust6@example.com', PASSWORD, 'admin')).status, 401);
  const ad = new Client(S.base);
  assert.equal((await ad.login(ADMIN.email, ADMIN.password, 'customer')).status, 401);
  assert.equal((await ad.login(ADMIN.email, ADMIN.password, 'admin')).status, 200);
});

test('authz: admin pages/scripts are only served to admins', async () => {
  const anon = await raw(S.base, '/admin');
  assert.equal(anon.status, 302); assert.match(anon.headers.location, /^\/login/);
  assert.equal((await raw(S.base, '/js/admin/schedule.js')).status, 404);
  assert.equal((await raw(S.base, '/js/admin.js')).status, 404);
  assert.equal((await raw(S.base, '/account')).status, 302);

  const cust = new Client(S.base); await cust.register(7);
  assert.equal((await cust.get('/admin')).status, 302);
  assert.equal((await cust.get('/js/admin.js')).status, 404);
  assert.equal((await cust.get('/account')).status, 200);

  const admin = new Client(S.base); await admin.login(ADMIN.email, ADMIN.password, 'admin');
  assert.equal((await admin.get('/admin')).status, 200);
  assert.equal((await admin.get('/js/admin.js')).status, 200);
  assert.equal((await admin.get('/account')).status, 302);
});

test('sessions: HttpOnly + SameSite=Strict, stored hashed, rotated on login, dead after logout/password change', async () => {
  const c = new Client(S.base);
  await c.register(8);
  assert.match(c.lastSetCookie, /HttpOnly/);
  assert.match(c.lastSetCookie, /SameSite=Strict/);
  assert.match(c.lastSetCookie, /Path=\//);
  const token = decodeURIComponent(c.cookie.split('=')[1]);
  assert.equal(S.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0, 'raw token must not be in the DB');
  assert.equal(token.length, 43);

  const old = c.cookie;
  assert.equal((await c.login('cust8@example.com', PASSWORD)).status, 200);
  assert.notEqual(c.cookie, old, 'new session id on login');

  const stolen = new Client(S.base); stolen.cookie = c.cookie; stolen.csrf = c.csrf;
  assert.equal((await stolen.get('/api/bookings/mine')).status, 200);
  assert.equal((await c.post('/api/auth/logout', {})).status, 200);
  stolen.cookie = old;
  assert.equal((await stolen.get('/api/bookings/mine')).status, 401, 'a logged-out/old token is useless');

  // password change kills every other session
  const d = new Client(S.base); await d.login('cust8@example.com', PASSWORD);
  const e = new Client(S.base); await e.login('cust8@example.com', PASSWORD);
  assert.equal((await d.post('/api/auth/password', { current: PASSWORD, next: 'Fresh-Mango-Tree-42' })).status, 200);
  assert.equal((await e.get('/api/bookings/mine')).status, 401);
  assert.equal((await d.get('/api/bookings/mine')).status, 200);
  assert.equal((await new Client(S.base).login('cust8@example.com', PASSWORD)).status, 401);
  assert.equal((await new Client(S.base).login('cust8@example.com', 'Fresh-Mango-Tree-42')).status, 200);
});

test('brute force: lock-out after 5 failures (per account+IP), identical for unknown accounts', async () => {
  const c = new Client(S.base);
  await new Client(S.base).register(9);
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await c.login('cust9@example.com', `wrong-password-${i}`)).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429]);
  assert.equal((await c.login('cust9@example.com', PASSWORD)).status, 429, 'even the right password is refused while locked');
  const retry = await c.login('cust9@example.com', PASSWORD);
  assert.ok(Number(retry.headers.get('retry-after')) > 0);
  assert.equal((await new Client(S.base).login('cust9@example.com', PASSWORD)).status, 200, 'other IPs are not collateral damage');

  const ghost = new Client(S.base);
  const g = [];
  for (let i = 0; i < 6; i++) g.push((await ghost.login('nobody@example.com', `nope-${i}`)).status);
  assert.deepEqual(g, [401, 401, 401, 401, 401, 429], 'unknown e-mails behave exactly like real ones');
  const a = await new Client(S.base).login('cust9@example.com', 'bad');
  const b = await new Client(S.base).login('nobody2@example.com', 'bad');
  assert.deepEqual(a.json, b.json, 'identical generic error body');
});

/* ───────────────────────────── static files ───────────────────────────── */

test('static: path traversal, dotfiles, source and database files are not reachable', async () => {
  for (const p of [
    '/../server/config.js', '/..%2fserver%2fconfig.js', '/%2e%2e/server/config.js', '/js/../../server/db.js', '/js/..%2f..%2fpackage.json',
    '/assets/..%5c..%5cpackage.json', '/server/config.js', '/package.json', '/shop.json', '/data/barbero.db', '/test/helpers.js',
    '/.git/config', '/js/.hidden', '/assets/%00.png', '//evil.com/', '/fonts/', '/css/', '/assets/photos/.gitkeep',
  ]) {
    const r = await raw(S.base, p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!/DatabaseSync|PBKDF2|SQLite format/.test(r.text), p);
  }
  assert.equal((await raw(S.base, '/')).status, 200);
});

test('static: the database, its journals and the pepper live outside the web root with owner-only permissions', () => {
  const dir = S.app.cfg.dataDir;
  assert.ok(!dir.startsWith(S.app.cfg.publicDir));
  assert.equal(statSync(dir).mode & 0o077, 0, 'data directory must be 0700');
  const files = readdirSync(dir);
  for (const f of ['pepper.key', 'barbero.db']) assert.ok(files.includes(f), f);
  for (const f of files) assert.equal(statSync(join(dir, f)).mode & 0o077, 0, `${f} must not be group/world accessible`);
  assert.ok(files.some((f) => f.endsWith('-wal')), 'WAL journal exists and was checked too');
});
