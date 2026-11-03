/**
 * Date/time helpers. The shop runs on Saudi time (Asia/Riyadh, UTC+3, no DST),
 * and every slot is stored as a shop-local calendar date + whole hour.
 */
export const TZ_OFFSET_MS = 3 * 3_600_000;

/** Current shop-local date ("YYYY-MM-DD"), hour (0-23) and weekday (0 = Sunday). */
export function nowShop(ms = Date.now()) {
  const d = new Date(ms + TZ_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);
}

export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Epoch ms of the start of a (shop-local) slot. */
export function slotStartMs(date, hour) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour) - TZ_OFFSET_MS;
}

/** True when the slot has already started. */
export function slotIsPast(date, hour, ms = Date.now()) {
  return slotStartMs(date, hour) <= ms;
}
