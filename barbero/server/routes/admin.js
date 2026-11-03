import { CHAIRS, BOOKING_HORIZON_DAYS } from '../config.js';
import { HttpError, notFound, conflict } from '../errors.js';
import { parse, parseQuery, date, int, intList, str, bool, oneOf, idParam, personName } from '../validate.js';
import { tx, notify, audit } from '../db.js';
import { nowShop, addDays, daysBetween, weekdayOf } from '../util.js';

const ICONS = ['scissors', 'clipper', 'beard', 'combo', 'razor', 'kid'];

function assertRange(from, to) {
  const now = nowShop();
  if (to < from || daysBetween(from, to) > BOOKING_HORIZON_DAYS) throw new HttpError(400, 'date_out_of_range', 'date_out_of_range');
  if (to < now.date) throw new HttpError(400, 'date_out_of_range', 'date_out_of_range');
  return now;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function dayBookings(db, d) {
  return db
    .prepare(
      `SELECT b.id, b.hour, b.chair, b.status, b.notes, u.id AS user_id, u.name, u.phone, sv.name_en, sv.name_ar
         FROM bookings b JOIN users u ON u.id = b.user_id LEFT JOIN services sv ON sv.id = b.service_id
        WHERE b.date = ? AND b.status != 'cancelled' ORDER BY b.hour, b.chair`
    )
    .all(d)
    .map((x) => ({ id: x.id, hour: x.hour, chair: x.chair, status: x.status, notes: x.notes, customer: { id: x.user_id, name: x.name, phone: x.phone }, serviceEn: x.name_en, serviceAr: x.name_ar }));
}

export function register(r) {
  const A = { auth: 'admin' };

  // ---- overview ---------------------------------------------------------------------------------------
  r.add('GET', '/api/admin/summary', A, ({ db }) => {
    const now = nowShop();
    const t = db
      .prepare("SELECT COUNT(*) AS total, SUM(status = 'free') AS free, SUM(status = 'booked') AS booked, SUM(status = 'blocked') AS blocked FROM slots WHERE date = ?")
      .get(now.date);
    const week = db
      .prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND date >= ? AND date <= ?")
      .get(now.date, addDays(now.date, 6)).n;
    const customers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n;
    const published = db.prepare('SELECT MAX(date) AS d FROM slots').get().d;
    return {
      today: now.date,
      hour: now.hour,
      slots: { total: t.total, free: t.free ?? 0, booked: t.booked ?? 0, blocked: t.blocked ?? 0 },
      weekBookings: week,
      customers,
      publishedUntil: published,
      todayBookings: dayBookings(db, now.date),
    };
  });

  // ---- schedule grid (hours x 10 chairs for one day) -------------------------------------------------------
  r.add('GET', '/api/admin/slots', A, ({ db, query }) => {
    const q = parseQuery(query, { date: date() });
    const rows = db
      .prepare(
        `SELECT s.hour, s.chair, s.status, b.id AS booking_id, b.status AS b_status, b.notes,
                u.id AS user_id, u.name, u.phone, sv.name_en, sv.name_ar
           FROM slots s
           LEFT JOIN bookings b ON b.id = s.booking_id
           LEFT JOIN users u ON u.id = b.user_id
           LEFT JOIN services sv ON sv.id = b.service_id
          WHERE s.date = ? ORDER BY s.hour, s.chair`
      )
      .all(q.date);
    const hours = new Map();
    for (const x of rows) {
      if (!hours.has(x.hour)) hours.set(x.hour, { hour: x.hour, chairs: [] });
      hours.get(x.hour).chairs.push({
        chair: x.chair,
        status: x.status,
        booking: x.booking_id
          ? { id: x.booking_id, status: x.b_status, notes: x.notes, customer: { id: x.user_id, name: x.name, phone: x.phone }, serviceEn: x.name_en, serviceAr: x.name_ar }
          : null,
      });
    }
    return { date: q.date, chairs: CHAIRS, hours: [...hours.values()] };
  });

  // Bulk free/block of hours x chairs (also creates slots, so extra hours can be opened ad hoc).
  r.add('POST', '/api/admin/slots/set', A, ({ db, body, user, ip }) => {
    const b = parse(body, {
      date: date(),
      hours: intList({ min: 0, max: 23, len: 24 }),
      chairs: intList({ min: 1, max: CHAIRS, len: CHAIRS }),
      status: oneOf(['free', 'blocked']),
    });
    if (b.date < nowShop().date) throw new HttpError(400, 'date_out_of_range', 'date_out_of_range');
    let changed = 0;
    let skipped = 0;
    tx(db, () => {
      const up = db.prepare(
        `INSERT INTO slots (date, hour, chair, status) VALUES (?, ?, ?, ?)
         ON CONFLICT (date, hour, chair) DO UPDATE SET status = excluded.status WHERE slots.status != 'booked'`
      );
      for (const h of b.hours) for (const c of b.chairs) (up.run(b.date, h, c, b.status).changes ? (changed += 1) : (skipped += 1));
    });
    audit(db, user.id, 'slots_set', `${b.date} h=${b.hours.join(',')} c=${b.chairs.join(',')} -> ${b.status}`, ip);
    return { changed, skipped };
  });

  // ---- weekly booking template ---------------------------------------------------------------------------------
  r.add('GET', '/api/admin/template', A, ({ db }) => ({
    days: db.prepare('SELECT weekday, enabled, open_hour, close_hour FROM template ORDER BY weekday').all().map((t) => ({ weekday: t.weekday, enabled: t.enabled === 1, openHour: t.open_hour, closeHour: t.close_hour })),
  }));

  r.add('PUT', '/api/admin/template', A, ({ db, body, user, ip }) => {
    const { days } = parse(body, { days: (v) => v });
    if (!Array.isArray(days) || days.length !== 7) throw new HttpError(400, 'invalid_input', 'invalid_input', { field: 'days' });
    const rows = days.map((d) => {
      const x = parse(d, { weekday: int({ min: 0, max: 6 }), enabled: bool(), openHour: int({ min: 0, max: 23 }), closeHour: int({ min: 1, max: 24 }) });
      if (x.closeHour <= x.openHour) throw new HttpError(400, 'invalid_hours', 'invalid_hours', { field: 'closeHour' });
      return x;
    });
    if (new Set(rows.map((x) => x.weekday)).size !== 7) throw new HttpError(400, 'invalid_input', 'invalid_input', { field: 'days' });
    tx(db, () => {
      const up = db.prepare('INSERT INTO template (weekday, enabled, open_hour, close_hour) VALUES (?, ?, ?, ?) ON CONFLICT (weekday) DO UPDATE SET enabled = excluded.enabled, open_hour = excluded.open_hour, close_hour = excluded.close_hour');
      for (const x of rows) up.run(x.weekday, x.enabled ? 1 : 0, x.openHour, x.closeHour);
    });
    audit(db, user.id, 'template_saved', '', ip);
    return { ok: true };
  });

  // ---- publish booking times (apply the template to a date range) --------------------------------------------------
  r.add('POST', '/api/admin/publish', A, ({ db, body, user, ip }) => {
    const b = parse(body, { from: date(), to: date(), notify: bool({ optional: true, default: false }) });
    const now = assertRange(b.from, b.to);
    const tpl = new Map(db.prepare('SELECT weekday, enabled, open_hour, close_hour FROM template').all().map((t) => [t.weekday, t]));
    let created = 0;
    const touched = new Set();
    let recipients = 0;
    tx(db, () => {
      const ins = db.prepare("INSERT OR IGNORE INTO slots (date, hour, chair, status) VALUES (?, ?, ?, 'free')");
      for (let d = b.from < now.date ? now.date : b.from; d <= b.to; d = addDays(d, 1)) {
        const t = tpl.get(weekdayOf(d));
        if (!t || !t.enabled) continue;
        for (let h = t.open_hour; h < t.close_hour; h++) {
          if (d === now.date && h <= now.hour) continue; // never publish hours that already started
          for (let c = 1; c <= CHAIRS; c++) {
            if (ins.run(d, h, c).changes) { created += 1; touched.add(d); }
          }
        }
      }
      if (b.notify && created > 0) {
        recipients = db
          .prepare("INSERT INTO notifications (user_id, code, params, created_at) SELECT id, 'times_open', ?, ? FROM users WHERE role = 'customer'")
          .run(JSON.stringify({ from: b.from, to: b.to }), Date.now()).changes;
      }
    });
    audit(db, user.id, 'publish', `${b.from}..${b.to} created=${created} notified=${recipients}`, ip);
    return { created, days: touched.size, notified: recipients };
  });

  // Remove every UNBOOKED slot in a range (retract published times). Booked slots are never touched.
  r.add('POST', '/api/admin/unpublish', A, ({ db, body, user, ip }) => {
    const b = parse(body, { from: date(), to: date() });
    assertRange(b.from, b.to);
    const removed = db.prepare("DELETE FROM slots WHERE date >= ? AND date <= ? AND status != 'booked'").run(b.from, b.to).changes;
    audit(db, user.id, 'unpublish', `${b.from}..${b.to} removed=${removed}`, ip);
    return { removed };
  });

  // ---- notify customers -------------------------------------------------------------------------------------------
  r.add('POST', '/api/admin/notify', A, ({ db, body, user, ip, limiter, cfg }) => {
    const gate = limiter.hit(`anotify:${user.id}`, cfg.limits.adminNotifyPerUser);
    if (!gate.ok) throw new HttpError(429, 'too_many_attempts', 'too_many_attempts', { retryAfter: gate.retryAfter });
    const b = parse(body, {
      title: str({ min: 1, max: 80 }),
      body: str({ min: 1, max: 500, multiline: true }),
      userId: int({ min: 1, optional: true }),
    });
    let sent;
    if (b.userId) {
      if (!db.prepare("SELECT 1 AS x FROM users WHERE id = ? AND role = 'customer'").get(b.userId)) throw notFound('customer_not_found');
      sent = db.prepare("INSERT INTO notifications (user_id, code, title, body, created_at) VALUES (?, 'message', ?, ?, ?)").run(b.userId, b.title, b.body, Date.now()).changes;
    } else {
      sent = db.prepare("INSERT INTO notifications (user_id, code, title, body, created_at) SELECT id, 'message', ?, ?, ? FROM users WHERE role = 'customer'").run(b.title, b.body, Date.now()).changes;
    }
    audit(db, user.id, 'notify', `${b.userId ? `user ${b.userId}` : 'all'} (${sent}): ${b.title}`, ip);
    return { sent };
  });

  // ---- bookings --------------------------------------------------------------------------------------------------------
  r.add('GET', '/api/admin/bookings', A, ({ db, query }) => {
    const q = parseQuery(query, { date: date() });
    return { date: q.date, bookings: dayBookings(db, q.date) };
  });

  r.add('POST', '/api/admin/bookings/:id/cancel', A, ({ db, params, body, user, ip }) => {
    const id = idParam(params.id);
    const b = parse(body, { reason: str({ min: 0, max: 200, optional: true, default: '' }) });
    tx(db, () => {
      const row = db.prepare('SELECT id, user_id, slot_id, date, hour, status FROM bookings WHERE id = ?').get(id);
      if (!row) throw notFound();
      if (row.status !== 'confirmed') throw conflict('not_cancellable');
      db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_by = 'admin' WHERE id = ?").run(id);
      db.prepare("UPDATE slots SET status = 'free', booking_id = NULL WHERE id = ?").run(row.slot_id);
      notify(db, row.user_id, 'booking_cancelled_admin', { date: row.date, hour: row.hour, reason: b.reason || '' });
    });
    audit(db, user.id, 'booking_cancelled', `#${id}`, ip);
    return { ok: true };
  });

  r.add('POST', '/api/admin/bookings/:id/status', A, ({ db, params, body, user, ip }) => {
    const id = idParam(params.id);
    const b = parse(body, { status: oneOf(['completed', 'no_show']) });
    const res = db.prepare("UPDATE bookings SET status = ? WHERE id = ? AND status = 'confirmed'").run(b.status, id);
    if (!res.changes) throw conflict('not_cancellable');
    audit(db, user.id, 'booking_status', `#${id} -> ${b.status}`, ip);
    return { ok: true };
  });

  // ---- customers (read-only directory) ---------------------------------------------------------------------------------------
  r.add('GET', '/api/admin/customers', A, ({ db, query }) => {
    const q = parseQuery(query, { q: str({ min: 0, max: 60, optional: true, default: '' }) });
    const like = `%${escapeLike(q.q || '')}%`; // wildcard-escaped AND bound as a parameter
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.created_at,
                (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status IN ('confirmed','completed')) AS bookings
           FROM users u
          WHERE u.role = 'customer' AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')
          ORDER BY u.created_at DESC LIMIT 50`
      )
      .all(like, like, like);
    return { customers: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, createdAt: u.created_at, bookings: u.bookings })) };
  });

  // ---- services & prices ----------------------------------------------------------------------------------------------------------
  const serviceSchema = () => ({
    nameEn: str({ min: 1, max: 60 }),
    nameAr: str({ min: 1, max: 60 }),
    descEn: str({ min: 0, max: 200, optional: true, default: '' }),
    descAr: str({ min: 0, max: 200, optional: true, default: '' }),
    icon: oneOf(ICONS),
    priceSar: int({ min: 0, max: 10000, optional: true }),
    active: bool(),
  });
  const mapService = (s) => ({ id: s.id, nameEn: s.name_en, nameAr: s.name_ar, descEn: s.desc_en, descAr: s.desc_ar, icon: s.icon, priceSar: s.price_sar, active: s.active === 1 });

  r.add('GET', '/api/admin/services', A, ({ db }) => ({
    services: db.prepare('SELECT id, name_en, name_ar, desc_en, desc_ar, icon, price_sar, active FROM services ORDER BY sort, id').all().map(mapService),
  }));

  r.add('POST', '/api/admin/services', A, (ctx) => {
    const { db, user, ip } = ctx;
    const b = parse(ctx.body, serviceSchema());
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM services').get().n;
    const id = db
      .prepare('INSERT INTO services (name_en, name_ar, desc_en, desc_ar, icon, price_sar, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(b.nameEn, b.nameAr, b.descEn, b.descAr, b.icon, b.priceSar, b.active ? 1 : 0, sort).lastInsertRowid;
    audit(db, user.id, 'service_created', `#${id}`, ip);
    ctx.status = 201;
    return { id: Number(id) };
  });

  r.add('PUT', '/api/admin/services/:id', A, ({ db, params, body, user, ip }) => {
    const id = idParam(params.id);
    const b = parse(body, serviceSchema());
    const res = db
      .prepare('UPDATE services SET name_en = ?, name_ar = ?, desc_en = ?, desc_ar = ?, icon = ?, price_sar = ?, active = ? WHERE id = ?')
      .run(b.nameEn, b.nameAr, b.descEn, b.descAr, b.icon, b.priceSar, b.active ? 1 : 0, id);
    if (!res.changes) throw notFound();
    audit(db, user.id, 'service_updated', `#${id}`, ip);
    return { ok: true };
  });

  // ---- audit trail -----------------------------------------------------------------------------------------------------------------------
  r.add('GET', '/api/admin/audit', A, ({ db }) => ({
    entries: db
      .prepare('SELECT a.id, a.action, a.detail, a.ip, a.created_at, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 100')
      .all()
      .map((e) => ({ id: e.id, action: e.action, detail: e.detail, ip: e.ip, createdAt: e.created_at, actor: e.actor })),
  }));
}
