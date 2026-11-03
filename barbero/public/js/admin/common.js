import { h } from '../dom.js';
import { ApiError } from '../api.js';
import { getLang } from '../i18n.js';

/** State shared by the admin views. */
export const S = { user: null, tab: 'overview', token: 0 };

/** Every admin API call: an expired/invalid session (30-min idle timeout) returns to the staff login. */
export async function safe(fn) {
  try { return await fn(); } catch (e) {
    if (e instanceof ApiError && e.status === 401) { location.replace('/login?portal=admin'); return new Promise(() => {}); }
    throw e;
  }
}

export const pageHead = (title, sub, ...actions) =>
  h('div', { class: 'main__head' },
    h('div', null, h('h1', { class: 'display', text: title }), sub && h('p', { text: sub })),
    actions.length > 0 && h('div', { class: 'row' }, actions));

/** Shop-local (Asia/Riyadh, UTC+3) calendar date. */
export const shopToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const LOC = { en: 'en-GB', ar: 'ar-SA-u-ca-gregory-nu-latn' };
export const fmtDateTime = (ms) => new Intl.DateTimeFormat(LOC[getLang()], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(ms));

export const statusChip = (label, status) =>
  h('span', { class: `chip chip--${{ confirmed: 'green', completed: 'dim', cancelled: 'red', no_show: 'yellow' }[status] ?? 'dim'}`, text: label });

export const telLink = (phone) => (phone && /^\+?[0-9]{8,15}$/.test(phone) ? h('a', { href: `tel:${phone}`, style: { direction: 'ltr', display: 'inline-block' }, text: phone }) : h('span', { text: phone || '—' }));
