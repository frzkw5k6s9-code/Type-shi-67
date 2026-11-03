import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './errors.js';

/* ------------------------------------------------------------------ headers */

/**
 * Content-Security-Policy: everything must come from our own origin. There is NO
 * 'unsafe-inline' and NO 'unsafe-eval' - an injected <script>, inline handler or style
 * attribute simply will not run. `require-trusted-types-for 'script'` additionally makes
 * the browser reject every DOM-XSS sink (innerHTML, document.write, eval...) so even a
 * future coding slip cannot turn user text into executable markup.
 */
export function buildCsp(cfg) {
  const d = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
  ];
  if (cfg.cookieSecure) d.push('upgrade-insecure-requests');
  return d.join('; ');
}

export function applySecurityHeaders(res, cfg, csp) {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (cfg.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}

/* ------------------------------------------------------------------ request parsing */

/** Split req.url into a decoded, validated path and a URLSearchParams. Throws 400 on anything odd. */
export function parseTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048 || rawUrl[0] !== '/' || rawUrl[1] === '/') {
    throw new HttpError(400, 'bad_request');
  }
  const q = rawUrl.indexOf('?');
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
  const query = new URLSearchParams(q === -1 ? '' : rawUrl.slice(q + 1));
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    throw new HttpError(400, 'bad_request');
  }
  if (path.includes('\0') || path.includes('\\') || path.split('/').some((s) => s === '..')) {
    throw new HttpError(400, 'bad_request');
  }
  return { path, query };
}

export function parseCookies(header = '') {
  const out = Object.create(null);
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { continue; }
    if (!(k in out)) out[k] = v;
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure }) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict`;
  if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`;
  if (secure) c += '; Secure';
  return c;
}

export function clientIp(req, cfg) {
  let ip = req.socket.remoteAddress || 'unknown';
  if (cfg.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) ip = xff.split(',').at(-1).trim() || ip; // the hop added by OUR proxy
  }
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}

/** DNS-rebinding defence: only answer for hostnames we are configured to serve. */
export function hostAllowed(req, cfg) {
  const host = req.headers.host;
  if (!host || host.length > 255) return false;
  const hostname = host.replace(/:\d+$/, '');
  return cfg.allowedHosts.has(host) || cfg.allowedHosts.has(hostname);
}

/**
 * Cross-site request forgery guard for state-changing requests: a browser always sends
 * Origin (and Sec-Fetch-Site) on cross-site POST/PUT/DELETE, so a mismatch is rejected.
 * (Session cookies are also SameSite=Strict, and authenticated routes additionally need
 * the per-session X-CSRF-Token header.)
 */
export function originOk(req, cfg) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin === 'null') return false;
    if (cfg.publicOrigin) return origin === cfg.publicOrigin;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }
  const sfs = req.headers['sec-fetch-site'];
  if (sfs !== undefined && sfs !== 'same-origin' && sfs !== 'none') return false;
  return true;
}

export async function readJson(req, limit = 16 * 1024) {
  if (!/^application\/json\s*(;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'unsupported_media_type');
  }
  const declared = Number(req.headers['content-length']);
  if (declared > limit) throw new HttpError(413, 'too_large');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  let v;
  try { v = JSON.parse(text); } catch { throw new HttpError(400, 'bad_json'); }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_json');
  return v;
}

/* ------------------------------------------------------------------ responses */

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/* ------------------------------------------------------------------ router */

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, opts, handler) {
      const keys = [];
      const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
      routes.push({ method, re, keys, opts, handler });
    },
    find(method, path) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = Object.create(null);
        r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
        return { route: r, params, pathMatched };
      }
      return { route: null, params: null, pathMatched };
    },
  };
}

/* ------------------------------------------------------------------ static files */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve a file that lives under `baseDir`. Anything that resolves outside it (or is hidden) is a 404. */
export async function serveFile(req, res, baseDir, relPath, cacheControl) {
  const abs = resolve(baseDir, relPath);
  const ext = extname(abs).toLowerCase();
  const hidden = relPath.split('/').some((s) => s.startsWith('.'));
  if (!abs.startsWith(baseDir + sep) || !(ext in MIME) || hidden) throw new HttpError(404, 'not_found');
  let st;
  try { st = await stat(abs); } catch { throw new HttpError(404, 'not_found'); }
  if (!st.isFile()) throw new HttpError(404, 'not_found');
  res.writeHead(200, {
    'Content-Type': MIME[ext],
    'Content-Length': st.size,
    'Cache-Control': cacheControl,
    'Last-Modified': st.mtime.toUTCString(),
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(abs), res);
}

const PHOTO_EXT = /\.(jpe?g|png|webp|avif)$/i;
let photoCache = { at: 0, value: null };

/** Lists owner-supplied photos in public/assets/photos (the gallery/hero fill themselves from this folder). */
export async function listPhotos(publicDir) {
  if (Date.now() - photoCache.at < 15_000 && photoCache.value) return photoCache.value;
  let files = [];
  try { files = await readdir(resolve(publicDir, 'assets/photos')); } catch { /* folder missing */ }
  const ok = files.filter((f) => PHOTO_EXT.test(f) && /^[\w.-]{1,80}$/.test(f) && !f.startsWith('.')).sort();
  const hero = ok.find((f) => /^hero\./i.test(f)) || null;
  const value = { hero, gallery: ok.filter((f) => f !== hero) };
  photoCache = { at: Date.now(), value };
  return value;
}
