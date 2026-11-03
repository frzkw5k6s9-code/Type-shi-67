import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Production hashing cost. OWASP (2023) minimum for PBKDF2-HMAC-SHA256 is 600,000. */
export const PBKDF2_ITERATIONS = 600_000;

export const CHAIRS = 10; // the shop has 10 chairs
export const SLOT_MINUTES = 60; // every bookable time frame is exactly 1 hour
export const MAX_ACTIVE_BOOKINGS = 3; // per customer, to stop slot hoarding
export const BOOKING_HORIZON_DAYS = 60; // how far ahead anything can be published/booked
export const CANCEL_CUTOFF_HOURS = 2; // customers can cancel up to 2h before the slot

/**
 * Environment-driven configuration. Security-relevant knobs can only be made
 * *stricter* from the environment; weak settings (cheap hashing) are only
 * reachable through the programmatic `testing` override used by the test-suite.
 */
export function loadConfig(overrides = {}) {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';

  let shop = {};
  try {
    shop = JSON.parse(readFileSync(resolve(ROOT, 'shop.json'), 'utf8'));
  } catch {
    /* defaults below */
  }

  const publicOrigin = env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).origin : null;
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (publicOrigin) allowedHosts.add(new URL(publicOrigin).host);
  for (const h of (env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)) allowedHosts.add(h);

  const cfg = {
    root: ROOT,
    publicDir: resolve(ROOT, 'public'),
    dataDir: resolve(env.DATA_DIR || resolve(ROOT, 'data')),
    host: env.HOST || '127.0.0.1',
    port: env.PORT === undefined ? 3000 : Number(env.PORT),
    isProd,
    // Secure cookies by default in production; `COOKIE_SECURE=false` is for plain-HTTP local previews only.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
    trustProxy: env.TRUST_PROXY === 'true', // only enable behind ONE reverse proxy you control
    publicOrigin,
    allowedHosts,
    pbkdf2Iterations: PBKDF2_ITERATIONS,
    pepperEnv: env.PASSWORD_PEPPER || null,
    adminEmail: env.ADMIN_EMAIL || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    adminName: env.ADMIN_NAME || 'Barbero Admin',
    shop: {
      name: 'Barbero',
      nameAr: 'باربيرو',
      tagline: 'Brazilian barbershop',
      city: 'Jeddah',
      area: '',
      areaAr: '',
      phone: '',
      instagram: '',
      mapsQuery: 'Barbero Jeddah',
      ...shop,
    },
    limits: {
      loginPerIp: [30, 10 * 60_000],
      loginPerEmailIp: [5, 15 * 60_000],
      loginPerEmail: [25, 15 * 60_000],
      registerPerIp: [8, 60 * 60_000],
      apiPerIp: [600, 60_000],
      bookPerUser: [20, 10 * 60_000],
      adminNotifyPerUser: [20, 60 * 60_000],
    },
  };

  if (isProd && !cfg.publicOrigin) {
    throw new Error('PUBLIC_ORIGIN (e.g. https://barbero.example.com) is required when NODE_ENV=production.');
  }

  const { testing, ...rest } = overrides;
  Object.assign(cfg, rest);
  if (testing) {
    // test-suite only: cheap hashing + relaxed host checks so tests run in seconds
    cfg.pbkdf2Iterations = overrides.pbkdf2Iterations ?? 2_000;
    cfg.testing = true;
  }
  if (!cfg.testing && cfg.pbkdf2Iterations < 100_000) {
    throw new Error('Refusing to start with fewer than 100,000 PBKDF2 iterations.');
  }
  return cfg;
}
