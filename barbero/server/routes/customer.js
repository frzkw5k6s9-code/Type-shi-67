import { CHAIRS, MAX_ACTIVE_BOOKINGS, BOOKING_HORIZON_DAYS, CANCEL_CUTOFF_HOURS } from '../config.js';
import { HttpError, notFound, conflict } from '../errors.js';
import { parse, parseQuery, date, int, str, idParam } from '../validate.js';
import { tx, notify } from '../db.js';
import { nowShop, addDays, daysBetween, slotIsPast, slotStartMs } from '../util.js';

function assertBookableDate(d) {
  const now = nowShop();
  if (d < now.date || daysBetween(now.date, d) > BOOKING_HORIZON_DAYS) throw new HttpError(400, 'date_out_of_range', 'date_out_of_range', { field: 'date' });
  return now;
}

export function register(r) {
  // ---- the day grid: hours x 10 chairs --------------------------------------------------------
  r.add('GET', '/api/slots', { auth: 'user' }, ({ db, query, user }) => {
    const q = parseQuery(query, { date: date() });
    const now = assertBookableDate(q.date);
    const rows = db
      .prepare(
        `SELECT s.hour, s.chair, s.status, b.user_id AS owner
           FROM slots s LEFT JOIN bookings b ON b.id = s.booking_id AND b.status IN ('confirmed','completed')
          WHERE s.date = ? ORDER BY s.hour, s.chair`
      )
      .all(q.date);
    const hours = new Map();
    for (const row of rows) {
      if (!hours.has(row.hour)) hours.set(row.hour, { hour: row.hour, past: slotIsPast(q.date, row.hour), chairs: [] });
      // We never reveal WHO holds a chair - only that it is taken (or that it is yours).
      const status = row.status === 'booked' ? (row.owner === user.id ? 'mine' : 'booked') : row.status;
      hours.get(row.hour).chairs.push({ chair: row.chair, status });
    }
    const list = [...hours.values()].map((h) => ({ ...h, free: h.past ? 0 : h.chairs.filter((c) => c.status === 'free').length }));
    return { date: q.date, today: now.date, open: list.length > 0, chairs: CHAIRS, hours: list };
  });

  // ---- create a booking ---------------------------------------------------------------------------
  r.add('POST', '/api/bookings', { auth: 'user' }, (ctx) => {
    const { db, user, limiter, cfg } = ctx;
    const gate = limiter.hit(`book:${user.id}`, cfg.limits.bookPerUser);
    if (!gate.ok) throw new HttpError(429, 'too_many_attempts', 'too_many_attempts', { retryAfter: gate.retryAfter });

    const b = parse(ctx.body, {
      date: date(),
      hour: int({ min: 0, max: 23 }),
      chair: int({ min: 1, max: CHAIRS, optional: true }), // omitted = "any free chair"
      serviceId: int({ min: 1 }),
      notes: str({ min: 0, max: 200, optional: true, default: '' }),
    });
    const now = assertBookableDate(b.date);
    if (slotIsPast(b.date, b.hour)) throw conflict('slot_in_past');

    const booking = tx(db, () => {
      const service = db.prepare('SELECT id FROM services WHERE id = ? AND active = 1').get(b.serviceId);
      if (!service) throw new HttpError(400, 'invalid_input', 'invalid_input', { field: 'serviceId' });

      const active = db
        .prepare("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed' AND (date > ? OR (date = ? AND hour > ?))")
        .get(user.id, now.date, now.date, now.hour).n;
      if (active >= MAX_ACTIVE_BOOKINGS) throw conflict('too_many_active');

      const dup = db.prepare("SELECT 1 AS x FROM bookings WHERE user_id = ? AND date = ? AND hour = ? AND status = 'confirmed'").get(user.id, b.date, b.hour);
      if (dup) throw conflict('already_booked_hour');

      const slot = b.chair
        ? db.prepare("SELECT id, chair, status FROM slots WHERE date = ? AND hour = ? AND chair = ?").get(b.date, b.hour, b.chair)
        : db.prepare("SELECT id, chair, status FROM slots WHERE date = ? AND hour = ? AND status = 'free' ORDER BY chair LIMIT 1").get(b.date, b.hour);
      if (!slot) throw new HttpError(409, b.chair ? 'slot_unavailable' : 'hour_full');
      if (slot.status !== 'free') throw conflict('slot_taken');

      const id = db
        .prepare("INSERT INTO bookings (user_id, slot_id, date, hour, chair, service_id, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)")
        .run(user.id, slot.id, b.date, b.hour, slot.chair, b.serviceId, b.notes, Date.now()).lastInsertRowid;
      // Compare-and-set: only succeeds if the slot is STILL free (race-proof, on top of the UNIQUE indexes).
      const upd = db.prepare("UPDATE slots SET status = 'booked', booking_id = ? WHERE id = ? AND status = 'free'").run(id, slot.id);
      if (upd.changes !== 1) throw conflict('slot_taken');
      notify(db, user.id, 'booking_confirmed', { date: b.date, hour: b.hour, chair: slot.chair });
      return { id: Number(id), date: b.date, hour: b.hour, chair: slot.chair };
    });
    ctx.status = 201;
    return { booking };
  });

  // ---- my bookings --------------------------------------------------------------------------------
  r.add('GET', '/api/bookings/mine', { auth: 'user' }, ({ db, user }) => {
    const rows = db
      .prepare(
        `SELECT b.id, b.date, b.hour, b.chair, b.status, b.notes, sv.name_en, sv.name_ar
           FROM bookings b LEFT JOIN services sv ON sv.id = b.service_id
          WHERE b.user_id = ? ORDER BY b.date DESC, b.hour DESC LIMIT 100`
      )
      .all(user.id);
    const now = Date.now();
    return {
      cancelCutoffHours: CANCEL_CUTOFF_HOURS,
      bookings: rows.map((x) => {
        const start = slotStartMs(x.date, x.hour);
        return {
          id: x.id, date: x.date, hour: x.hour, chair: x.chair, status: x.status, notes: x.notes,
          serviceEn: x.name_en, serviceAr: x.name_ar,
          past: start <= now,
          canCancel: x.status === 'confirmed' && start - now >= CANCEL_CUTOFF_HOURS * 3_600_000,
        };
      }),
    };
  });

  r.add('POST', '/api/bookings/:id/cancel', { auth: 'user' }, ({ db, user, params, body }) => {
    parse(body, {});
    const id = idParam(params.id);
    tx(db, () => {
      // "AND user_id = ?" => a customer can only ever touch their own bookings (no IDOR).
      const b = db.prepare('SELECT id, slot_id, date, hour, status FROM bookings WHERE id = ? AND user_id = ?').get(id, user.id);
      if (!b) throw notFound();
      if (b.status !== 'confirmed') throw conflict('not_cancellable');
      if (slotStartMs(b.date, b.hour) - Date.now() < CANCEL_CUTOFF_HOURS * 3_600_000) throw conflict('too_late');
      db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_by = 'customer' WHERE id = ?").run(id);
      db.prepare("UPDATE slots SET status = 'free', booking_id = NULL WHERE id = ?").run(b.slot_id);
    });
    return { ok: true };
  });

  // ---- notifications ------------------------------------------------------------------------------
  r.add('GET', '/api/notifications', { auth: 'user' }, ({ db, user }) => {
    const rows = db
      .prepare('SELECT id, code, params, title, body, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50')
      .all(user.id);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
    return {
      unread,
      notifications: rows.map((n) => ({
        id: n.id, code: n.code, params: JSON.parse(n.params || '{}'), title: n.title, body: n.body, createdAt: n.created_at, read: n.read_at !== null,
      })),
    };
  });

  r.add('POST', '/api/notifications/read', { auth: 'user' }, ({ db, user, body }) => {
    parse(body, {}); // only "mark everything read" is supported; no fields accepted
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), user.id);
    return { ok: true };
  });
}
