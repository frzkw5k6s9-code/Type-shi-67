import { t, getLang } from '../i18n.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { get, post, errorText } from '../api.js';
import { toast, fmtRange, fmtDate, spinner, emptyState } from '../ui.js';
import { safe, pageHead, statusChip, telLink } from './common.js';

export async function render(root, { alive, go }) {
  root.append(pageHead(t('adm.overview.h'), t('adm.overview.sub'),
    h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => go('notify') }, icon('megaphone', { size: 15 }), t('adm.nav.notify')),
    h('button', { class: 'btn btn--primary btn--sm', type: 'button', onClick: () => go('template') }, icon('calendar', { size: 15 }), t('adm.publish.cta'))));
  const body = h('div', null, spinner());
  root.append(body);

  const s = await safe(() => get('/api/admin/summary'));
  if (!alive()) return;
  const tile = (label, value, sub, cls = '') => h('div', { class: `tile ${cls}` }, h('small', { text: label }), h('b', { text: value }), h('span', { text: sub }));
  const util = s.slots.total ? Math.round((s.slots.booked / s.slots.total) * 100) : 0;
  const svcName = (b) => (getLang() === 'ar' ? b.serviceAr : b.serviceEn) ?? '—';

  const sheet = s.todayBookings.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['adm.col.time', 'adm.col.chair', 'adm.col.customer', 'adm.col.service', 'adm.col.status', ''].map((k) => h('th', { text: k ? t(k) : '' })))),
        h('tbody', null, s.todayBookings.map((b) => h('tr', null,
          h('td', { class: 'sheet-time' }, fmtRange(b.hour)),
          h('td', { class: 'num', text: `${t('chairs.chair')} ${b.chair}` }),
          h('td', null, h('b', { text: b.customer.name }), h('div', { class: 'muted', style: { 'font-size': '0.85rem' } }, telLink(b.customer.phone))),
          h('td', null, svcName(b), b.notes && h('div', { class: 'muted pre', style: { 'font-size': '0.8rem' }, text: b.notes })),
          h('td', null, statusChip(t(`status.${b.status}`), b.status)),
          h('td', null, b.status === 'confirmed' && h('span', { class: 'row', style: { 'flex-wrap': 'nowrap' } },
            h('button', { class: 'btn btn--green btn--sm', type: 'button', onClick: () => mark(b.id, 'completed') }, icon('check', { size: 14 }), t('status.completed')),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => mark(b.id, 'no_show') }, t('status.no_show')))))))))
    : h('div', { class: 'card' }, emptyState('calendar', t('adm.sheet.empty'), t('adm.sheet.empty_sub')));

  async function mark(id, status) {
    try { await safe(() => post(`/api/admin/bookings/${id}/status`, { status })); toast(t('adm.saved'), 'success'); mount(root); render(root, { alive, go }); } catch (e) { toast(errorText(e), 'error'); }
  }

  mount(body,
    h('div', { class: 'tiles' },
      tile(t('adm.tile.today'), s.slots.booked, t('adm.tile.today_sub', { pct: util }), 'tile--g'),
      tile(t('adm.tile.free'), s.slots.free, t('adm.tile.free_sub', { n: s.slots.total })),
      tile(t('adm.tile.week'), s.weekBookings, t('adm.tile.week_sub')),
      tile(t('adm.tile.customers'), s.customers, t('adm.tile.customers_sub')),
      tile(t('adm.tile.published'), s.publishedUntil ? fmtDate(s.publishedUntil, { day: 'numeric', month: 'short' }) : '—', s.publishedUntil ? t('adm.tile.published_sub') : t('adm.tile.nothing'))),
    h('div', { class: 'section-label', text: `${t('adm.sheet.h')} · ${fmtDate(s.today, { weekday: 'long', day: 'numeric', month: 'long' })}` }),
    sheet);
}
