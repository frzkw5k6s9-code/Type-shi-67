import { CHAIRS, SLOT_MINUTES, BOOKING_HORIZON_DAYS, CANCEL_CUTOFF_HOURS } from '../config.js';
import { listPhotos } from '../http.js';
import { parseQuery, date, int } from '../validate.js';
import { nowShop, addDays } from '../util.js';
import { HttpError } from '../errors.js';

export function register(r) {
  // Everything here is read-only and contains no personal data.
  r.add('GET', '/api/public/info', { auth: 'public' }, async ({ cfg, db }) => {
    const services = db
      .prepare('SELECT id, name_en, name_ar, desc_en, desc_ar, icon, price_sar FROM services WHERE active = 1 ORDER BY sort, id')
      .all()
      .map((s) => ({ id: s.id, nameEn: s.name_en, nameAr: s.name_ar, descEn: s.desc_en, descAr: s.desc_ar, icon: s.icon, priceSar: s.price_sar }));
    const hours = db
      .prepare('SELECT weekday, enabled, open_hour, close_hour FROM template ORDER BY weekday')
      .all()
      .map((t) => ({ weekday: t.weekday, enabled: t.enabled === 1, openHour: t.open_hour, closeHour: t.close_hour }));
    const { name, nameAr, tagline, city, area, areaAr, phone, instagram, mapsQuery } = cfg.shop;
    return {
      shop: { name, nameAr, tagline, city, area, areaAr, phone, instagram, mapsQuery },
      chairs: CHAIRS,
      slotMinutes: SLOT_MINUTES,
      horizonDays: BOOKING_HORIZON_DAYS,
      cancelCutoffHours: CANCEL_CUTOFF_HOURS,
      services,
      hours,
      photos: await listPhotos(cfg.publicDir),
    };
  });

  // Free / total counts per day (future slots only) - drives the day picker and landing page.
  r.add('GET', '/api/public/availability', { auth: 'public' }, ({ db, query }) => {
    const now = nowShop();
    const q = parseQuery(query, { from: date({ optional: true, default: now.date }), days: int({ optional: true, default: 14, min: 1, max: 31 }) });
    const from = q.from < now.date ? now.date : q.from;
    const to = addDays(from, q.days - 1);
    const rows = db
      .prepare(
        `SELECT date, COUNT(*) AS total, SUM(status = 'free') AS free
           FROM slots
          WHERE date >= ? AND date <= ? AND (date > ? OR hour > ?)
          GROUP BY date ORDER BY date`
      )
      .all(from, to, now.date, now.hour);
    const byDate = new Map(rows.map((x) => [x.date, x]));
    const days = [];
    for (let i = 0; i < q.days; i++) {
      const d = addDays(from, i);
      const row = byDate.get(d);
      days.push({ date: d, open: !!row, total: row?.total ?? 0, free: row?.free ?? 0 });
    }
    return { today: now.date, days };
  });

  // The next hour that still has at least one free chair, and the state of all ten chairs.
  r.add('GET', '/api/public/next', { auth: 'public' }, ({ db }) => {
    const now = nowShop();
    const next = db
      .prepare(
        `SELECT date, hour FROM slots
          WHERE date >= ? AND (date > ? OR hour > ?)
          GROUP BY date, hour HAVING SUM(status = 'free') > 0
          ORDER BY date, hour LIMIT 1`
      )
      .get(now.date, now.date, now.hour);
    if (!next) return { next: null };
    const chairs = db
      .prepare('SELECT chair, status FROM slots WHERE date = ? AND hour = ? ORDER BY chair')
      .all(next.date, next.hour)
      .map((c) => ({ chair: c.chair, status: c.status }));
    return { next: { date: next.date, hour: next.hour, chairs, free: chairs.filter((c) => c.status === 'free').length } };
  });
}
