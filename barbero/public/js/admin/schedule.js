import { t, getLang } from '../i18n.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { get, post, errorText } from '../api.js';
import { toast, openModal, fmtHour, fmtRange, fmtDate, spinner, emptyState } from '../ui.js';
import { field, submitButton } from '../forms.js';
import { safe, pageHead, shopToday, addDays, statusChip, telLink } from './common.js';

let date = shopToday(); // remembered while you switch tabs

export async function render(root, { alive }) {
  let data = null;
  const toolbar = h('div', { class: 'toolbar' });
  const wrap = h('div', { class: 'grid-wrap' });
  root.append(pageHead(t('adm.schedule.h'), t('adm.schedule.sub')), toolbar, wrap,
    h('div', { class: 'legend legend--row', 'aria-hidden': 'true' },
      h('span', null, h('i'), t('adm.legend.free')), h('span', null, h('i', { class: 'y' }), t('adm.legend.booked')), h('span', null, h('i', { class: 'd' }), t('adm.legend.blocked')),
      h('span', { class: 'muted', text: t('adm.legend.tip') })));

  const editable = () => date >= shopToday();
  const svcName = (b) => (getLang() === 'ar' ? b.serviceAr : b.serviceEn) ?? '—';

  async function load({ quiet = false } = {}) {
    if (!quiet) mount(wrap, spinner());
    const d = date;
    const res = await safe(() => get(`/api/admin/slots?date=${d}`));
    if (!alive() || d !== date) return;
    data = res;
    draw();
  }

  async function setSlots(hours, chairs, status) {
    try {
      const r = await safe(() => post('/api/admin/slots/set', { date, hours, chairs, status }));
      if (r.skipped) toast(t('adm.skipped_booked', { n: r.skipped }), 'info');
    } catch (e) { toast(errorText(e), 'error'); }
    await load({ quiet: true });
  }

  function cellOf(hour, chair) {
    return data.hours.find((r) => r.hour === hour)?.chairs.find((c) => c.chair === chair) ?? null;
  }

  // Decide what a header click should do: if anything in the line is free, block it all; otherwise free it all.
  function lineTarget(cells) {
    const usable = cells.filter((c) => c?.status !== 'booked');
    return usable.some((c) => c?.status === 'free') ? 'blocked' : 'free';
  }

  function openBooking(b, hour, chair) {
    const row = (k, v) => h('div', null, h('dt', { text: k }), h('dd', null, v));
    const close = (c) => c();
    const status = async (s, c) => {
      try { await safe(() => post(`/api/admin/bookings/${b.id}/status`, { status: s })); toast(t('adm.saved'), 'success'); c(); load({ quiet: true }); } catch (e) { toast(errorText(e), 'error'); }
    };
    const m = openModal({
      title: t('adm.booking.h'),
      body: h('div', { class: 'detail' }, h('dl', null,
        row(t('adm.booking.customer'), b.customer.name), row(t('adm.booking.phone'), telLink(b.customer.phone)),
        row(t('sum.service'), svcName(b)), row(t('sum.date'), fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })),
        row(t('sum.time'), fmtRange(hour)), row(t('sum.chair'), `${t('chairs.chair')} ${chair}`),
        b.notes && row(t('adm.booking.notes'), h('span', { class: 'pre', text: b.notes })), row(t('adm.col.status'), statusChip(t(`status.${b.status}`), b.status)))),
      actions: b.status === 'confirmed'
        ? [
            { label: t('adm.booking.cancel'), kind: 'danger', onClick: (c) => { c(); cancelDialog(b); } },
            { label: t('status.no_show'), kind: 'ghost', onClick: (c) => status('no_show', c) },
            { label: t('status.completed'), kind: 'green', onClick: (c) => status('completed', c) },
          ]
        : [{ label: t('common.close'), kind: 'ghost', onClick: close }],
    });
    return m;
  }

  function cancelDialog(b) {
    const reason = field({ name: 'reason', label: `${t('adm.cancel.reason')} (${t('common.optional')})`, multiline: true, rows: 2, maxlength: 200, required: false, placeholder: t('adm.cancel.reason_ph') });
    openModal({
      title: t('adm.cancel.h'),
      body: h('div', { class: 'form' }, h('p', { class: 'muted', text: t('adm.cancel.p', { name: b.customer.name }) }), reason.root),
      actions: [
        { label: t('bk.keep'), kind: 'ghost', onClick: (c) => c() },
        { label: t('adm.booking.cancel'), kind: 'danger', onClick: async (c) => {
          try { await safe(() => post(`/api/admin/bookings/${b.id}/cancel`, { reason: reason.value.trim() })); toast(t('bk.cancelled'), 'success'); c(); load({ quiet: true }); } catch (e) { toast(errorText(e), 'error'); }
        } },
      ],
    });
  }

  function renderToolbar() {
    const dateInput = h('input', { class: 'input', type: 'date', value: date, 'aria-label': t('sum.date'), onChange: (e) => { if (e.target.value) { date = e.target.value; load(); } } });
    const counts = data ? data.hours.flatMap((r) => r.chairs) : [];
    const n = (s) => counts.filter((c) => c.status === s).length;
    const hourSel = h('select', { class: 'input', 'aria-label': t('adm.add_hour') }, [...Array(24).keys()].map((hr) => h('option', { value: hr, text: fmtHour(hr) })));
    hourSel.value = '12';
    mount(toolbar,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('adm.prev_day'), onClick: () => { date = addDays(date, -1); load(); } }, icon('chevL', { size: 18, class: 'icon--dir' })),
      dateInput,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('adm.next_day'), onClick: () => { date = addDays(date, 1); load(); } }, icon('chevR', { size: 18, class: 'icon--dir' })),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => { date = shopToday(); load(); } }, t('day.today')),
      h('strong', { text: fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }) }),
      editable() && data && h('span', { class: 'row' }, hourSel, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => setSlots([Number(hourSel.value)], [...Array(10).keys()].map((i) => i + 1), 'free') }, icon('plus', { size: 15 }), t('adm.add_hour'))),
      h('span', { class: 'counts' }, h('span', { class: 'chip chip--green', text: `${t('adm.legend.free')} ${n('free')}` }), h('span', { class: 'chip chip--yellow', text: `${t('adm.legend.booked')} ${n('booked')}` }), h('span', { class: 'chip chip--dim', text: `${t('adm.legend.blocked')} ${n('blocked')}` })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('adm.refresh'), onClick: () => load({ quiet: true }) }, icon('refresh', { size: 17 })));
  }

  function draw() {
    renderToolbar();
    const ed = editable();
    if (!data.hours.length) {
      mount(wrap, h('div', { class: 'empty' }, icon('calendar', { size: 36 }), h('h3', { text: t('adm.empty_day') }), h('p', { text: t('adm.empty_day_sub') }),
        ed && h('button', { class: 'btn btn--primary', type: 'button', onClick: async () => {
          try {
            const r = await safe(() => post('/api/admin/publish', { from: date, to: date, notify: false }));
            toast(r.created ? t('adm.published', { n: r.created }) : t('adm.nothing_new'), r.created ? 'success' : 'info');
            load();
          } catch (e) { toast(errorText(e), 'error'); }
        } }, icon('calendar', { size: 16 }), t('adm.publish_day'))));
      return;
    }
    const chairs = [...Array(data.chairs).keys()].map((i) => i + 1);
    const hours = data.hours.map((r) => r.hour);
    const head = h('tr', null, h('th', { scope: 'col' }),
      chairs.map((c) => h('th', { scope: 'col' }, h('button', { class: 'hbtn', type: 'button', disabled: !ed, title: t('adm.toggle_chair'), onClick: () => setSlots(hours, [c], lineTarget(hours.map((hr) => cellOf(hr, c)))) }, icon('chair', { size: 15 }), c))));
    const body = hours.map((hr) => h('tr', null,
      h('th', { scope: 'row' }, h('button', { class: 'hbtn', type: 'button', disabled: !ed, title: t('adm.toggle_hour'), onClick: () => setSlots([hr], chairs, lineTarget(chairs.map((c) => cellOf(hr, c)))) }, fmtHour(hr))),
      chairs.map((c) => {
        const cell = cellOf(hr, c);
        if (!cell) return h('td', null, h('button', { class: 'cell cell--none', type: 'button', disabled: !ed, 'aria-label': `${fmtHour(hr)} ${t('chairs.chair')} ${c}: ${t('adm.legend.none')}`, onClick: () => setSlots([hr], [c], 'free') }, icon('plus', { size: 14 })));
        const label = `${fmtHour(hr)} · ${t('chairs.chair')} ${c}`;
        if (cell.status === 'booked' && cell.booking) {
          const b = cell.booking;
          const done = b.status !== 'confirmed';
          return h('td', null, h('button', { class: `cell cell--booked${done ? ' is-done' : ''}`, type: 'button', title: `${b.customer.name} · ${svcName(b)}`, 'aria-label': `${label}: ${b.customer.name}`, onClick: () => openBooking(b, hr, c) }, h('span', { class: 'nm', text: b.customer.name.split(' ')[0] }), done && icon(b.status === 'completed' ? 'check' : 'x', { size: 12 })));
        }
        if (cell.status === 'blocked') return h('td', null, h('button', { class: 'cell cell--blocked', type: 'button', disabled: !ed, 'aria-label': `${label}: ${t('adm.legend.blocked')}`, title: t('adm.click_free'), onClick: () => setSlots([hr], [c], 'free') }, icon('block', { size: 14 })));
        return h('td', null, h('button', { class: 'cell cell--free', type: 'button', disabled: !ed, 'aria-label': `${label}: ${t('adm.legend.free')}`, title: t('adm.click_block'), onClick: () => setSlots([hr], [c], 'blocked') }, icon('check', { size: 14 })));
      })));
    mount(wrap, h('table', { class: 'sgrid' }, h('thead', null, head), h('tbody', null, body)));
  }

  await load();
}
