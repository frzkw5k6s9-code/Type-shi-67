import { initLang, t, getLang, onLang } from './i18n.js';
import { h, mount, $ } from './dom.js';
import { icon, hasIcon } from './icons.js';
import { get, post, whoAmI, setCsrf, ApiError, errorText } from './api.js';
import {
  langToggle, toast, confirmDialog, openModal, chairBoard, fmtRange, fmtDate, dayParts, price, svcName, svcDesc,
  timeAgo, initials, spinner, emptyState, downloadIcs, fmtHour,
} from './ui.js';
import { field, passwordField, submitButton, formBanner } from './forms.js';

initLang();

const TABS = [['book', 'calendar'], ['bookings', 'list'], ['inbox', 'bell'], ['profile', 'user']];
const fresh = () => ({ serviceId: null, date: null, hour: null, chair: null, notes: '' });
const S = { user: null, info: null, tab: 'book', unread: null, bk: fresh(), avail: null, grid: null, gridFor: null };
let viewToken = 0;

/** Every API call goes through here: an expired session sends you back to the login page. */
async function safe(fn) {
  try { return await fn(); } catch (e) {
    if (e instanceof ApiError && e.status === 401) { location.replace('/login'); return new Promise(() => {}); }
    throw e;
  }
}

const pageHead = (title, sub) => h('div', { class: 'page__head' }, h('div', null, h('h1', { class: 'display', text: title }), sub && h('p', { text: sub })));
const statusChip = (s) => h('span', { class: `chip chip--${{ confirmed: 'green', completed: 'dim', cancelled: 'red', no_show: 'yellow' }[s] ?? 'dim'}`, text: t(`status.${s}`) });
const svcById = (id) => S.info?.services.find((s) => s.id === id);

/* ───────────────────────── chrome (tabs, user, language) ───────────────────────── */

function renderChrome() {
  mount($('#tabs'), TABS.map(([id, ic]) => h('button', { class: `tab${S.tab === id ? ' is-on' : ''}`, type: 'button', 'aria-current': S.tab === id ? 'page' : null, onClick: () => { location.hash = id; } },
    icon(ic, { size: 18 }), h('span', { text: t(`tab.${id}`) }), id === 'inbox' && S.unread > 0 && h('span', { class: 'dot', text: S.unread > 9 ? '9+' : S.unread }))));
  mount($('#topEnd'),
    langToggle(),
    h('span', { class: 'userchip' }, h('span', { class: 'avatar', text: initials(S.user.name) }), h('span', { text: S.user.name.split(' ')[0] })),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('logout'), title: t('logout'), onClick: logout }, icon('logout', { size: 18 })));
}

async function logout() {
  try { await post('/api/auth/logout'); } catch { /* cookie is cleared either way on the next request */ }
  location.assign('/');
}

/* ───────────────────────── BOOK ───────────────────────── */

function stepHead(n, title, { done, hint } = {}) {
  return h('div', { class: 'step__head' }, h('span', { class: 'step__n' }, done ? icon('check', { size: 16 }) : n), h('h2', null, title, hint && h('small', { text: `  · ${hint}` })));
}

function bookView() {
  const root = h('div');
  const sSvc = h('section', { class: 'card step' });
  const sDate = h('section', { class: 'card step' });
  const sTime = h('section', { class: 'card step' });
  const sChair = h('section', { class: 'card step' });
  const sum = h('aside', { class: 'summary', 'aria-live': 'polite' });
  const bk = S.bk;
  const mark = (el, done, active) => { el.classList.toggle('is-done', done); el.classList.toggle('is-active', !done && active); };

  function renderSvc() {
    mark(sSvc, bk.serviceId !== null, bk.serviceId === null);
    mount(sSvc, stepHead(1, t('step.service'), { done: bk.serviceId !== null }),
      h('div', { class: 'picks', role: 'radiogroup', 'aria-label': t('step.service') }, (S.info?.services ?? []).map((s) =>
        h('button', { class: 'pick', type: 'button', role: 'radio', 'aria-checked': String(bk.serviceId === s.id), onClick: () => { bk.serviceId = s.id; renderSvc(); renderSum(); } },
          h('span', { class: 'pick__ic' }, icon(hasIcon(s.icon) ? s.icon : 'scissors', { size: 22 })),
          h('span', null, h('b', { text: svcName(s) }), s.priceSar !== null && h('small', { text: price(s.priceSar) }))))));
  }

  function renderDate() {
    mark(sDate, bk.date !== null, bk.serviceId !== null && bk.date === null);
    const days = S.avail?.days ?? [];
    const body = !S.avail ? spinner()
      : !days.some((d) => d.open) ? h('p', { class: 'muted', text: t('book.no_days') })
      : h('div', { class: 'daystrip', role: 'group', 'aria-label': t('step.date') }, days.map((d) => {
          const p = dayParts(d.date);
          const dis = !d.open || d.free === 0;
          return h('button', { class: 'dchip', type: 'button', disabled: dis, 'aria-pressed': String(bk.date === d.date), onClick: () => pickDate(d.date) },
            h('span', { class: 'dchip__wd', text: d.date === S.avail.today ? t('day.today') : p.wd }),
            h('span', { class: 'dchip__n', text: p.day }), h('span', { class: 'dchip__m', text: p.mon }),
            h('span', { class: 'dchip__f', text: !d.open ? t('day.soon') : d.free === 0 ? t('time.full') : t('time.free', { n: d.free }) }));
        }));
    mount(sDate, stepHead(2, t('step.date'), { done: bk.date !== null }), body);
  }

  function renderTime() {
    mark(sTime, bk.hour !== null, bk.date !== null && bk.hour === null);
    let body;
    if (!bk.date) body = h('p', { class: 'muted', text: t('book.pick_day') });
    else if (!S.grid || S.gridFor !== bk.date) body = spinner();
    else if (!S.grid.hours.length) body = h('p', { class: 'muted', text: t('book.closed_day') });
    else body = h('div', { class: 'times', role: 'group', 'aria-label': t('step.time') }, S.grid.hours.map((r) => {
      const dis = r.past || r.free === 0;
      return h('button', { class: 'tbtn', type: 'button', disabled: dis, 'aria-pressed': String(bk.hour === r.hour), onClick: () => { bk.hour = r.hour; bk.chair = null; renderTime(); renderChair(); renderSum(); } },
        h('span', { text: fmtHour(r.hour) }), h('small', { text: r.past ? t('time.past') : r.free === 0 ? t('time.full') : t('time.free', { n: r.free }) }));
    }));
    mount(sTime, stepHead(3, t('step.time'), { done: bk.hour !== null, hint: t('step.time.hint') }), body);
  }

  function renderChair() {
    const row = S.grid?.hours.find((r) => r.hour === bk.hour);
    mark(sChair, false, bk.hour !== null);
    if (!bk.hour && bk.hour !== 0 || !row) { mount(sChair, stepHead(4, t('step.chair')), h('p', { class: 'muted', text: t('book.pick_time') })); return; }
    const any = h('button', { class: `btn btn--sm anychair ${bk.chair === null ? 'btn--primary' : 'btn--ghost'}`, type: 'button', 'aria-pressed': String(bk.chair === null), title: t('chair.any_hint'), onClick: () => { bk.chair = null; renderChair(); renderSum(); } }, icon('refresh', { size: 15 }), t('chair.any'));
    mount(sChair, stepHead(4, t('step.chair'), { done: true }),
      h('div', { class: 'chairs-wrap' },
        any,
        h('div', { class: 'floor' }, chairBoard(row.chairs, { selected: bk.chair, onPick: (n) => { bk.chair = n; renderChair(); renderSum(); } })),
        h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', null, h('i'), t('legend.free')), h('span', null, h('i', { class: 'y' }), t('legend.selected')), h('span', null, h('i', { class: 'd' }), t('legend.booked')), h('span', null, h('i', { class: 'm' }), t('legend.mine')))));
  }

  let confirmBtn;
  function renderSum() {
    const svc = svcById(bk.serviceId);
    const ready = svc && bk.date && bk.hour !== null;
    confirmBtn = submitButton(t('sum.confirm'), { kind: 'primary' });
    confirmBtn.el.type = 'button';
    confirmBtn.el.disabled = !ready;
    confirmBtn.el.addEventListener('click', () => confirmBooking(confirmBtn));
    const row = (k, v, empty) => h('div', null, h('dt', { text: k }), h('dd', { class: empty ? 'is-empty' : '', text: v }));
    const notes = field({ name: 'notes', label: `${t('sum.notes')} (${t('common.optional')})`, multiline: true, rows: 2, maxlength: 200, required: false, placeholder: t('sum.notes_ph'), value: bk.notes });
    notes.input.addEventListener('input', () => { bk.notes = notes.input.value; });
    mount(sum,
      h('h2', null, icon('scissors', { size: 18 }), t('sum.h')),
      h('dl', null,
        row(t('sum.service'), svc ? svcName(svc) : t('sum.none'), !svc),
        svc && svc.priceSar !== null && row(t('sum.price'), price(svc.priceSar)),
        row(t('sum.date'), bk.date ? fmtDate(bk.date, { weekday: 'long', day: 'numeric', month: 'long' }) : t('sum.none'), !bk.date),
        row(t('sum.time'), bk.hour !== null ? fmtRange(bk.hour) : t('sum.none'), bk.hour === null),
        row(t('sum.chair'), bk.hour === null ? t('sum.none') : bk.chair ? `${t('chairs.chair')} ${bk.chair}` : t('sum.any'), bk.hour === null)),
      notes.root, confirmBtn.el,
      h('p', { class: 'muted', style: { 'font-size': '0.82rem' }, text: t('sum.policy', { h: S.info?.cancelCutoffHours ?? 2 }) }));
  }

  async function pickDate(d) {
    bk.date = d; bk.hour = null; bk.chair = null; S.grid = null;
    renderDate(); renderTime(); renderChair(); renderSum();
    await loadGrid();
  }

  async function loadGrid({ silent = false } = {}) {
    const d = bk.date;
    if (!d) return;
    try {
      const g = await safe(() => get(`/api/slots?date=${d}`));
      if (bk.date !== d) return; // user moved on
      S.grid = g; S.gridFor = d;
      const cur = g.hours.find((r) => r.hour === bk.hour);
      if (bk.hour !== null && (!cur || cur.past || cur.free === 0)) { bk.hour = null; bk.chair = null; }
      if (bk.chair && cur?.chairs.find((c) => c.chair === bk.chair)?.status !== 'free') bk.chair = null;
      renderTime(); renderChair(); renderSum();
    } catch (e) { if (!silent) toast(errorText(e), 'error'); }
  }

  async function refreshAvail() {
    try { S.avail = await safe(() => get('/api/public/availability?days=14')); renderDate(); } catch { /* keep old */ }
  }

  async function confirmBooking(btn) {
    const svc = svcById(bk.serviceId);
    btn.busy(true);
    try {
      const body = { date: bk.date, hour: bk.hour, serviceId: bk.serviceId, notes: bk.notes };
      if (bk.chair) body.chair = bk.chair;
      const { booking } = await safe(() => post('/api/bookings', body));
      showSuccess(booking, svc);
      S.bk = Object.assign(bk, fresh());
      await Promise.all([refreshAvail(), loadGrid(), refreshUnread()]);
      renderSvc(); renderSum(); renderTime(); renderChair();
    } catch (e) {
      toast(errorText(e), 'error');
      if (['slot_taken', 'slot_unavailable', 'hour_full', 'slot_in_past'].includes(e.code)) { bk.chair = null; await loadGrid(); }
      btn.busy(false);
    }
  }

  root.append(pageHead(t('book.h'), t('book.sub')), h('div', { class: 'book' }, h('div', { class: 'steps-col' }, sSvc, sDate, sTime, sChair), sum));
  renderSvc(); renderDate(); renderTime(); renderChair(); renderSum();
  refreshAvail().then(() => { if (bk.date) loadGrid(); });
  const poll = setInterval(() => { if (!root.isConnected) return clearInterval(poll); if (!document.hidden && S.tab === 'book') { refreshAvail(); if (bk.date) loadGrid({ silent: true }); } }, 30_000);
  return root;
}

function showSuccess(b, svc) {
  const name = svc ? svcName(svc) : '';
  openModal({
    title: t('done.h'),
    body: h('div', { class: 'success' },
      h('div', { class: 'success__tick' }, icon('check', { size: 38 })),
      h('p', { class: 'muted', text: t('done.sub') }),
      h('dl', { class: 'ticket' },
        h('div', null, h('dt', { text: t('sum.service') }), h('dd', { text: name })),
        h('div', null, h('dt', { text: t('sum.date') }), h('dd', { text: fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' }) })),
        h('div', null, h('dt', { text: t('sum.time') }), h('dd', { text: fmtRange(b.hour) })),
        h('div', null, h('dt', { text: t('sum.chair') }), h('dd', { text: `${t('chairs.chair')} ${b.chair}` })))),
    actions: [
      { label: t('done.cal'), kind: 'ghost', onClick: () => downloadIcs({ date: b.date, hour: b.hour, title: t('cal.title', { service: name }), location: S.info?.shop.area || 'Barbero, Jeddah' }) },
      { label: t('done.view'), kind: 'green', onClick: (c) => { c(); location.hash = 'bookings'; } },
      { label: t('done.close'), kind: 'primary', onClick: (c) => c() },
    ],
  });
}

/* ───────────────────────── MY BOOKINGS ───────────────────────── */

function bkCard(b, reload) {
  const p = dayParts(b.date);
  const live = b.status === 'confirmed' && !b.past;
  const act = [statusChip(b.status)];
  if (live) {
    act.push(h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => downloadIcs({ date: b.date, hour: b.hour, title: t('cal.title', { service: getLang() === 'ar' ? b.serviceAr : b.serviceEn }), location: S.info?.shop.area || 'Barbero, Jeddah' }) }, icon('download', { size: 15 }), t('done.cal')));
    if (b.canCancel) {
      act.push(h('button', { class: 'btn btn--danger btn--sm', type: 'button', onClick: async () => {
        if (!(await confirmDialog(t('bk.cancel_q', { date: fmtDate(b.date), time: fmtRange(b.hour) }), { title: t('bk.cancel'), confirmLabel: t('bk.cancel_yes'), danger: true }))) return;
        try { await safe(() => post(`/api/bookings/${b.id}/cancel`)); toast(t('bk.cancelled'), 'success'); reload(); } catch (e) { toast(errorText(e), 'error'); }
      } }, icon('x', { size: 15 }), t('bk.cancel')));
    } else {
      const phone = S.info?.shop.phone;
      act.push(h('p', { class: 'bk__note', text: t('bk.too_late', { h: S.info?.cancelCutoffHours ?? 2 }) }));
      if (phone && /^\+?[0-9]{8,15}$/.test(phone)) act.push(h('a', { class: 'btn btn--ghost btn--sm', href: `tel:${phone}` }, icon('phone', { size: 15 }), t('bk.call')));
    }
  }
  return h('article', { class: `bk${live ? '' : ' bk--past'}${b.status === 'cancelled' ? ' bk--cancelled' : ''}` },
    h('div', { class: 'bk__date' }, h('b', { text: p.day }), h('small', { text: p.mon })),
    h('div', null,
      h('h3', { text: getLang() === 'ar' ? b.serviceAr : b.serviceEn }),
      h('div', { class: 'bk__meta' },
        h('span', null, icon('calendar', { size: 15 }), fmtDate(b.date, { weekday: 'long' })),
        h('span', null, icon('clock', { size: 15 }), fmtRange(b.hour)),
        h('span', null, icon('chair', { size: 15 }), `${t('chairs.chair')} ${b.chair}`)),
      b.notes && h('p', { class: 'muted pre', style: { 'margin-top': '8px', 'font-size': '0.88rem' }, text: b.notes })),
    h('div', { class: 'bk__act' }, act));
}

function bookingsView() {
  const root = h('div');
  const list = h('div', null, spinner());
  root.append(pageHead(t('bk.h'), t('bk.sub')), list);
  const token = viewToken;
  const load = async () => {
    try {
      const { bookings } = await safe(() => get('/api/bookings/mine'));
      if (token !== viewToken) return;
      const up = bookings.filter((b) => b.status === 'confirmed' && !b.past).reverse();
      const rest = bookings.filter((b) => !(b.status === 'confirmed' && !b.past));
      mount(list,
        h('div', { class: 'section-label', text: t('bk.upcoming') }),
        up.length ? h('div', { class: 'list' }, up.map((b) => bkCard(b, load)))
          : h('div', { class: 'card' }, emptyState('calendar', t('bk.empty'), t('bk.empty_sub')), h('div', { class: 'row', style: { 'justify-content': 'center' } }, h('button', { class: 'btn btn--primary', type: 'button', onClick: () => { location.hash = 'book'; } }, t('bk.book')))),
        rest.length > 0 && h('div', { class: 'section-label', text: t('bk.past') }),
        rest.length > 0 && h('div', { class: 'list' }, rest.map((b) => bkCard(b, load))));
    } catch (e) { toast(errorText(e), 'error'); }
  };
  load();
  return root;
}

/* ───────────────────────── INBOX ───────────────────────── */

const NOTIF_ICON = { welcome: 'scissors', booking_confirmed: 'check', booking_cancelled_admin: 'alert', times_open: 'calendar', message: 'megaphone' };

function notifCard(n) {
  const p = n.params || {};
  let title, body, cta;
  switch (n.code) {
    case 'message': title = n.title; body = n.body; break;
    case 'booking_confirmed': title = t('n.booking_confirmed.t'); body = t('n.booking_confirmed.p', { date: fmtDate(p.date), time: fmtRange(p.hour), chair: p.chair }); break;
    case 'booking_cancelled_admin': title = t('n.booking_cancelled_admin.t'); body = t('n.booking_cancelled_admin.p', { date: fmtDate(p.date), time: fmtRange(p.hour) }) + (p.reason ? ` ${t('n.reason')}: ${p.reason}` : ''); break;
    case 'times_open': title = t('n.times_open.t'); body = t('n.times_open.p', { from: fmtDate(p.from), to: fmtDate(p.to) }); cta = true; break;
    case 'welcome': title = t('n.welcome.t'); body = t('n.welcome.p'); cta = true; break;
    default: title = n.title || t('n.generic.t'); body = n.body || '';
  }
  return h('article', { class: `notif${n.read ? '' : ' is-new'}` },
    h('div', { class: 'notif__ic' }, icon(NOTIF_ICON[n.code] ?? 'bell', { size: 20 })),
    h('div', null, h('h3', { text: title }), body && h('p', { class: 'pre', text: body }), cta && h('button', { class: 'btn btn--primary btn--sm', type: 'button', onClick: () => { location.hash = 'book'; } }, t('n.book_now'))),
    h('time', { datetime: new Date(n.createdAt).toISOString(), text: timeAgo(n.createdAt) }));
}

function inboxView() {
  const root = h('div');
  const list = h('div', { class: 'list' }, spinner());
  root.append(pageHead(t('inbox.h'), t('inbox.sub')), list);
  const token = viewToken;
  (async () => {
    try {
      const r = await safe(() => get('/api/notifications'));
      if (token !== viewToken) return;
      mount(list, r.notifications.length ? r.notifications.map(notifCard) : h('div', { class: 'card' }, emptyState('bell', t('inbox.empty'), t('inbox.empty_sub'))));
      if (r.unread > 0) { await safe(() => post('/api/notifications/read')); S.unread = 0; renderChrome(); }
    } catch (e) { toast(errorText(e), 'error'); }
  })();
  return root;
}

async function refreshUnread() {
  try {
    const r = await safe(() => get('/api/notifications'));
    if (S.unread !== null && r.unread > S.unread && S.tab !== 'inbox') toast(t('n.new_toast'), 'info');
    S.unread = S.tab === 'inbox' ? 0 : r.unread;
    renderChrome();
  } catch { /* ignore */ }
}

/* ───────────────────────── PROFILE ───────────────────────── */

function profileView() {
  const u = S.user;
  const cur = passwordField({ name: 'current', label: t('field.current_password'), autocomplete: 'current-password' });
  const next = passwordField({ name: 'next', label: t('field.new_password'), autocomplete: 'new-password', meter: true, hint: t('pw.hint') });
  const btn = submitButton(t('prof.save'), { block: false, large: false });
  const banner = formBanner();
  const form = h('form', { class: 'form', novalidate: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    banner.hide(); cur.error(''); next.error('');
    if (!cur.value) return cur.error(t('err.password_invalid'));
    if (next.value.length < 10) return next.error(t('err.password_too_short'));
    btn.busy(true);
    try {
      const r = await safe(() => post('/api/auth/password', { current: cur.value, next: next.value }));
      setCsrf(r.csrf);
      cur.input.value = ''; next.input.value = '';
      next.input.dispatchEvent(new Event('input'));
      toast(t('prof.changed'), 'success');
    } catch (err) {
      const f = err instanceof ApiError && { current: cur, next }[err.field];
      if (err.code === 'invalid_credentials') cur.error(errorText(err)); else if (f) f.error(errorText(err)); else banner.show(errorText(err));
    } finally { btn.busy(false); }
  });
  form.append(banner.el, cur.root, next.root, h('div', null, btn.el), h('p', { class: 'secure-note' }, icon('shield', { size: 15 }), h('span', { text: t('prof.tip') })));
  return h('div', null, pageHead(t('prof.h'), t('prof.sub')),
    h('div', { class: 'grid2' },
      h('section', { class: 'card' }, h('h2', { text: t('prof.details') }),
        h('dl', { class: 'kv' }, h('div', null, h('dt', { text: t('prof.name') }), h('dd', { text: u.name })), h('div', null, h('dt', { text: t('prof.email') }), h('dd', { text: u.email })), h('div', null, h('dt', { text: t('prof.phone') }), h('dd', { class: 'tag-code', style: { direction: 'ltr' }, text: u.phone ?? '—' })))),
      h('section', { class: 'card' }, h('h2', { text: t('prof.security') }), form)));
}

/* ───────────────────────── router ───────────────────────── */

function renderView() {
  viewToken += 1;
  const view = $('#view');
  const views = { book: bookView, bookings: bookingsView, inbox: inboxView, profile: profileView };
  mount(view, views[S.tab]());
  renderChrome();
}

function route() {
  const id = location.hash.slice(1);
  const next = TABS.some(([x]) => x === id) ? id : 'book';
  const changed = next !== S.tab;
  S.tab = next;
  if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
  if (S.tab === 'inbox') S.unread = 0;
  renderView();
}

async function boot() {
  let user;
  try { user = await whoAmI(); } catch { user = null; }
  if (!user) return location.replace('/login');
  if (user.role === 'admin') return location.replace('/admin');
  S.user = user;
  try { S.info = await get('/api/public/info'); } catch { S.info = { services: [], shop: {}, cancelCutoffHours: 2 }; }
  onLang(() => { renderView(); });
  window.addEventListener('hashchange', route);
  route();
  refreshUnread();
  setInterval(() => { if (!document.hidden) refreshUnread(); }, 60_000);
}

boot();
