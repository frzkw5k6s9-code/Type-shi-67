import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { nowShop, addDays } from '../server/util.js';

export const ADMIN = { email: 'owner@barbero.test', password: 'Correct-Horse-Battery-9' };
export const PASSWORD = 'Blue-Falcon-Ride-77';

export async function bootServer(extra = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'barbero-test-'));
  const app = await createApp({
    testing: true, dataDir, port: 0, host: '127.0.0.1', trustProxy: true,
    adminEmail: ADMIN.email, adminPassword: ADMIN.password, ...extra,
  });
  const addr = await app.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    app, base, db: app.db,
    async close() { await app.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

let ipCounter = 10;
/** A tiny cookie-jar HTTP client that behaves like a browser tab (sends Origin + CSRF token). */
export class Client {
  constructor(base) {
    this.base = base;
    this.ip = `10.1.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`; // distinct per client => independent rate limits
    this.cookie = '';
    this.csrf = null;
  }

  async req(method, path, body, headers = {}) {
    const h = { 'X-Forwarded-For': this.ip, Origin: this.base, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h['Content-Type'] ??= 'application/json';
    if (this.csrf && method !== 'GET' && !('X-CSRF-Token' in headers)) h['X-CSRF-Token'] = this.csrf;
    for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
    const res = await fetch(this.base + path, {
      method, headers: h, redirect: 'manual',
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookie = /Max-Age=0/i.test(c) ? '' : `${pair.slice(0, i)}=${pair.slice(i + 1)}`;
      this.lastSetCookie = c;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: res.headers, json, text };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b = {}, h) { return this.req('POST', p, b, h); }
  put(p, b, h) { return this.req('PUT', p, b, h); }

  async login(email, password, portal = 'customer') {
    const r = await this.post('/api/auth/login', { email, password, portal });
    if (r.status === 200) this.csrf = r.json.csrf;
    return r;
  }
  async register(i, name = 'Omar Alharbi') {
    const r = await this.post('/api/auth/register', { name, email: `cust${i}@example.com`, phone: `+96655000${String(1000 + i)}`, password: PASSWORD });
    if (r.status === 201) this.csrf = r.json.csrf;
    return r;
  }
}

/** Raw HTTP so the path/Host are sent exactly as given (fetch would normalise them). */
export function raw(base, path, { method = 'GET', headers = {} } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Admin logs in, opens every weekday 10:00-22:00 and publishes `days` days starting today. */
export async function adminWithSlots(base, days = 4) {
  const admin = new Client(base);
  const r = await admin.login(ADMIN.email, ADMIN.password, 'admin');
  if (r.status !== 200) throw new Error('admin login failed ' + JSON.stringify(r.json));
  const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, enabled: true, openHour: 10, closeHour: 22 }));
  await admin.put('/api/admin/template', { days: week });
  const today = nowShop().date;
  const pub = await admin.post('/api/admin/publish', { from: today, to: addDays(today, days - 1), notify: false });
  if (pub.status !== 200) throw new Error('publish failed ' + JSON.stringify(pub.json));
  return { admin, today, tomorrow: addDays(today, 1) };
}
