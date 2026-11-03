import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQL-injection policy for this code base:
 *   1. every query is a STATIC string using `?` placeholders - user input only ever
 *      travels as a bound parameter, never inside the SQL text;
 *   2. identifiers (table/column names) are never taken from input;
 *   3. input is additionally validated against allow-lists before it gets here.
 * test/security.test.js contains a guard that fails the build if SQL is ever built with
 * template-literal interpolation or string concatenation.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT    NOT NULL,
  phone         TEXT,
  role          TEXT    NOT NULL CHECK (role IN ('customer','admin')),
  pw_hash       TEXT    NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 0 CHECK (must_change IN (0,1)),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,           -- SHA-256 of the cookie token; the raw token is never stored
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS services (
  id        INTEGER PRIMARY KEY,
  name_en   TEXT    NOT NULL,
  name_ar   TEXT    NOT NULL,
  desc_en   TEXT    NOT NULL DEFAULT '',
  desc_ar   TEXT    NOT NULL DEFAULT '',
  icon      TEXT    NOT NULL DEFAULT 'scissors',
  price_sar INTEGER CHECK (price_sar IS NULL OR (price_sar >= 0 AND price_sar <= 10000)),
  active    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort      INTEGER NOT NULL DEFAULT 0
);

-- Weekly booking template: which weekdays are open and between which (whole) hours.
CREATE TABLE IF NOT EXISTS template (
  weekday    INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  enabled    INTEGER NOT NULL CHECK (enabled IN (0,1)),
  open_hour  INTEGER NOT NULL CHECK (open_hour BETWEEN 0 AND 23),
  close_hour INTEGER NOT NULL CHECK (close_hour BETWEEN 1 AND 24),
  CHECK (close_hour > open_hour)
);

-- One row per (date, hour, chair). 10 chairs x N hours x days. Exactly one hour each.
CREATE TABLE IF NOT EXISTS slots (
  id         INTEGER PRIMARY KEY,
  date       TEXT    NOT NULL,
  hour       INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  chair      INTEGER NOT NULL CHECK (chair BETWEEN 1 AND 10),
  status     TEXT    NOT NULL CHECK (status IN ('free','booked','blocked')),
  booking_id INTEGER,
  UNIQUE (date, hour, chair)
);
CREATE INDEX IF NOT EXISTS idx_slots_date ON slots(date);

CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id      INTEGER NOT NULL REFERENCES slots(id),
  date         TEXT    NOT NULL,
  hour         INTEGER NOT NULL,
  chair        INTEGER NOT NULL,
  service_id   INTEGER REFERENCES services(id),
  notes        TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  cancelled_by TEXT    CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer','admin')),
  created_at   INTEGER NOT NULL
);
-- A person cannot hold two chairs in the same hour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_user_hour ON bookings(user_id, date, hour) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);

-- System notifications store a code + params (rendered in the viewer's language by the UI);
-- admin broadcasts (code = 'message') store the admin's own title/body text.
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,
  params     TEXT    NOT NULL DEFAULT '{}',
  title      TEXT,
  body       TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor_id   INTEGER,
  action     TEXT    NOT NULL,
  detail     TEXT    NOT NULL DEFAULT '',
  ip         TEXT,
  created_at INTEGER NOT NULL
);
`;

export function openDb(cfg) {
  // Everything this process creates (database, -wal/-shm journals, pepper) is owner-only.
  process.umask(0o077);
  mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  try { chmodSync(cfg.dataDir, 0o700); } catch { /* not ours to change */ }
  const file = cfg.dbFile || resolve(cfg.dataDir, 'barbero.db');
  const fresh = !existsSync(file);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec(SCHEMA);
  if (fresh) {
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
  }
  return db;
}

/** Run `fn` inside an IMMEDIATE transaction (take the write lock up-front; rolls back on any throw). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export function audit(db, actorId, action, detail = '', ip = null) {
  db.prepare('INSERT INTO audit_log (actor_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)').run(
    actorId ?? null,
    action,
    String(detail).slice(0, 500),
    ip,
    Date.now()
  );
}

/** Queue a notification for one user. `params` is JSON-serialised (it is data, not markup). */
export function notify(db, userId, code, params = {}) {
  db.prepare('INSERT INTO notifications (user_id, code, params, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    code,
    JSON.stringify(params),
    Date.now()
  );
}

const DEFAULT_SERVICES = [
  ['Signature Cut', 'القصّة المميزة', 'A precision cut built around your head shape, hair type and style.', 'قصّة دقيقة تناسب شكل رأسك ونوع شعرك وأسلوبك.', 'scissors'],
  ['Fade & Shape-up', 'فيد وتحديد الحواف', 'Seamless skin, low or high fades with razor-sharp edges.', 'تدرّج ناعم عالٍ أو منخفض مع حواف حادّة بالموس.', 'clipper'],
  ['Beard Sculpt', 'تهذيب اللحية', 'Line-up, shape and trim finished with beard oil.', 'تحديد وتشكيل وتهذيب مع زيت اللحية.', 'beard'],
  ['Cut + Beard', 'قصّة + لحية', 'The full works: signature cut and a sculpted beard in one chair.', 'الباقة الكاملة: قصّة مميزة مع تهذيب اللحية في كرسي واحد.', 'combo'],
  ['Hot Towel Shave', 'حلاقة بالمنشفة الساخنة', 'Classic straight-razor shave with steaming towels.', 'حلاقة كلاسيكية بالموس مع مناشف ساخنة.', 'razor'],
  ['Kids Cut', 'قصّة الأطفال', 'Patient, friendly cuts for the little ones.', 'قصّات لطيفة وبصبر للصغار.', 'kid'],
];

/** Default weekly template (admin can change everything in the portal). 0 = Sunday. */
const DEFAULT_TEMPLATE = [
  [0, 0, 12, 22], // Sunday   - closed (per third-party listing; verify!)
  [1, 1, 12, 23],
  [2, 1, 12, 23],
  [3, 1, 12, 23],
  [4, 1, 12, 24],
  [5, 1, 14, 24], // Friday   - after the midday prayer
  [6, 1, 12, 24],
];

export function seedDefaults(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM services').get().n === 0) {
    const ins = db.prepare('INSERT INTO services (name_en, name_ar, desc_en, desc_ar, icon, sort) VALUES (?, ?, ?, ?, ?, ?)');
    DEFAULT_SERVICES.forEach((s, i) => ins.run(...s, i));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM template').get().n === 0) {
    const ins = db.prepare('INSERT INTO template (weekday, enabled, open_hour, close_hour) VALUES (?, ?, ?, ?)');
    DEFAULT_TEMPLATE.forEach((r) => ins.run(...r));
  }
}
