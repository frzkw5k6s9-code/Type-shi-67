import http from 'node:http';
import { loadConfig } from './config.js';
import { openDb, seedDefaults, audit } from './db.js';
import { loadPepper, makeHasher, checkPasswordPolicy, randomToken, safeEqual } from './security.js';
import { RateLimiter } from './ratelimit.js';
import {
  applySecurityHeaders, buildCsp, parseTarget, parseCookies, clientIp, hostAllowed, originOk, readJson,
  sendJson, sendRedirect, createRouter, serveFile,
} from './http.js';
import { loadSession, purgeExpiredSessions } from './session.js';
import { HttpError } from './errors.js';
import * as publicRoutes from './routes/public.js';
import * as authRoutes from './routes/auth.js';
import * as customerRoutes from './routes/customer.js';
import * as adminRoutes from './routes/admin.js';

const PAGES = { '/': 'index.html', '/login': 'login.html', '/account': 'account.html', '/admin': 'admin.html' };
const STATIC_PREFIXES = ['/css/', '/js/', '/assets/', '/fonts/'];
const ROOT_FILES = new Set(['/robots.txt']);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function createApp(overrides = {}) {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg);
  seedDefaults(db);
  const hasher = makeHasher({ iterations: cfg.pbkdf2Iterations, pepper: loadPepper(cfg) });
  const limiter = new RateLimiter();
  const csp = buildCsp(cfg);

  const router = createRouter();
  for (const m of [publicRoutes, authRoutes, customerRoutes, adminRoutes]) m.register(router);

  await ensureAdmin({ cfg, db, hasher });

  const sendError = (res, e, req) => {
    if (res.headersSent) return res.destroy();
    let status = 500;
    let payload = { error: { code: 'server_error' } };
    const headers = {};
    if (e instanceof HttpError) {
      status = e.status;
      payload = { error: { code: e.code, ...(e.extra?.field ? { field: e.extra.field } : {}) } };
      if (e.extra?.retryAfter) { headers['Retry-After'] = String(e.extra.retryAfter); payload.error.retryAfter = e.extra.retryAfter; }
    } else {
      // Never leak internals to the client; log only the message (no request bodies, no secrets).
      console.error(`[error] ${req?.method} ${String(req?.url).slice(0, 120)} -> ${e?.message}`);
    }
    if (status === 413 || status === 415) headers.Connection = 'close';
    sendJson(res, status, payload, headers);
  };

  async function handle(req, res) {
    applySecurityHeaders(res, cfg, csp);
    try {
      const { path, query } = parseTarget(req.url);
      if (!hostAllowed(req, cfg)) throw new HttpError(421, 'bad_host');
      const ip = clientIp(req, cfg);
      const gate = limiter.hit(`ip:${ip}`, cfg.limits.apiPerIp);
      if (!gate.ok) throw new HttpError(429, 'too_many_requests', 'too_many_requests', { retryAfter: gate.retryAfter });

      const ctx = {
        req, res, cfg, db, hasher, limiter, ip, path, query,
        params: {}, body: {}, user: null, session: null, status: 200, cookiesOut: [],
        cookies: parseCookies(req.headers.cookie),
        setCookie(c) { this.cookiesOut.push(c); },
      };

      if (!path.startsWith('/api/')) return await handleStatic(ctx);

      res.setHeader('Cache-Control', 'no-store');
      const { route, params, pathMatched } = router.find(req.method, path);
      if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found');
      ctx.params = params;
      loadSession(ctx);

      const unsafe = UNSAFE.has(req.method);
      if (unsafe && !originOk(req, cfg)) throw new HttpError(403, 'bad_origin');

      // Authentication & authorisation are enforced HERE, on the server, for every route.
      if (route.opts.auth !== 'public') {
        if (!ctx.user) throw new HttpError(401, 'unauthorized');
        if (route.opts.auth === 'admin' && ctx.user.role !== 'admin') throw new HttpError(403, 'forbidden');
        if (ctx.user.mustChange && !route.opts.allowMustChange) throw new HttpError(403, 'password_change_required');
      }
      if (unsafe) {
        if (route.opts.csrf !== false && ctx.session && !safeEqual(req.headers['x-csrf-token'] ?? '', ctx.session.csrf)) {
          throw new HttpError(403, 'csrf');
        }
        ctx.body = await readJson(req);
      }

      const result = await route.handler(ctx);
      if (ctx.cookiesOut.length) res.setHeader('Set-Cookie', ctx.cookiesOut);
      sendJson(res, ctx.status, result ?? { ok: true });
    } catch (e) {
      sendError(res, e, req);
    }
  }

  async function handleStatic(ctx) {
    const { req, res, path } = ctx;
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');

    // Role-gated UI: the admin pages and scripts are not even sent to non-admins.
    const needsSession = path === '/account' || path === '/admin' || path.startsWith('/js/admin');
    if (needsSession) loadSession(ctx);

    if (path in PAGES) {
      if (path === '/admin' && ctx.user?.role !== 'admin') return sendRedirect(res, '/login?portal=admin');
      if (path === '/account') {
        if (!ctx.user) return sendRedirect(res, '/login');
        if (ctx.user.role === 'admin') return sendRedirect(res, '/admin');
      }
      return serveFile(req, res, cfg.publicDir, PAGES[path], 'no-cache');
    }
    const allowed = ROOT_FILES.has(path) || STATIC_PREFIXES.some((p) => path.startsWith(p));
    if (!allowed) throw new HttpError(404, 'not_found');
    if (path.startsWith('/js/admin') && ctx.user?.role !== 'admin') throw new HttpError(404, 'not_found');
    const cache = path.startsWith('/fonts/') || path.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache';
    return serveFile(req, res, cfg.publicDir, path.slice(1), cache);
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, handle);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;

  const janitor = setInterval(() => { try { purgeExpiredSessions(db); } catch { /* ignore */ } }, 10 * 60_000);
  janitor.unref();

  return {
    cfg, db, server, hasher, limiter,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(cfg.port, cfg.host, () => resolve(server.address()));
      });
    },
    async close() {
      clearInterval(janitor);
      limiter.close();
      await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
      db.close();
    },
  };
}

/** Make sure at least one admin exists. Never ships with a default/guessable admin password. */
async function ensureAdmin({ cfg, db, hasher }) {
  if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n > 0) return;
  let emailAddr = cfg.adminEmail;
  let pw = cfg.adminPassword;
  let mustChange = 0;
  let generated = false;
  if (!emailAddr || !pw) {
    emailAddr = 'admin@barbero.local';
    pw = randomToken(15);
    mustChange = 1; // the generated password must be replaced at first sign-in
    generated = true;
  } else {
    const bad = checkPasswordPolicy(pw, { email: emailAddr, name: cfg.adminName });
    if (bad) throw new Error(`ADMIN_PASSWORD rejected by the password policy (${bad}).`);
  }
  const id = db
    .prepare("INSERT INTO users (email, name, phone, role, pw_hash, must_change, created_at) VALUES (?, ?, NULL, 'admin', ?, ?, ?)")
    .run(emailAddr.toLowerCase(), cfg.adminName, await hasher.hash(pw), mustChange, Date.now()).lastInsertRowid;
  audit(db, Number(id), 'admin_created', generated ? 'generated password' : 'from environment');
  if (generated && !cfg.testing) {
    const line = '='.repeat(64);
    console.log(`\n${line}\n  FIRST RUN - an admin account was created.\n  e-mail:    ${emailAddr}\n  password:  ${pw}\n  (shown once; you will be asked to change it at first sign-in)\n${line}\n`);
  }
}
