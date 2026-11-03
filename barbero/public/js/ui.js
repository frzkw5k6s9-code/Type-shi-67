import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { t, getLang, setLang, onLang } from './i18n.js';

/* ───────────────────────── formatting (Western digits in both languages) ───────────────────────── */

const LOCALES = { en: 'en-GB', ar: 'ar-SA-u-ca-gregory-nu-latn' };
const dtf = (opts) => new Intl.DateTimeFormat(LOCALES[getLang()], { timeZone: 'UTC', ...opts });
const dateObj = (s) => new Date(`${s}T12:00:00Z`);

export const fmtHour = (hr) => `${hr % 12 || 12}:00 ${hr % 24 < 12 ? t('time.am') : t('time.pm')}`;
export const fmtRange = (hr) => `${fmtHour(hr)} – ${fmtHour(hr + 1)}`;
export const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => dtf(opts).format(dateObj(s));
export const fmtDateLong = (s) => fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const weekdayName = (i, style = 'long') => dtf({ weekday: style }).format(new Date(Date.UTC(2024, 0, 7 + i, 12))); // 2024-01-07 = Sunday
export const dayParts = (s) => ({ wd: fmtDate(s, { weekday: 'short' }), day: fmtDate(s, { day: 'numeric' }), mon: fmtDate(s, { month: 'short' }) });
export const price = (sar) => (sar === null || sar === undefined ? null : `${t('currency')} ${sar}`);
export const svcName = (s) => (getLang() === 'ar' ? s.nameAr : s.nameEn);
export const svcDesc = (s) => (getLang() === 'ar' ? s.descAr : s.descEn);

export function timeAgo(ms) {
  const rtf = new Intl.RelativeTimeFormat(LOCALES[getLang()], { numeric: 'auto' });
  const s = Math.round((ms - Date.now()) / 1000);
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return rtf.format(0, 'second');
}

export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => [...p][0]).join('').toUpperCase();

/* ───────────────────────── toasts & modal ───────────────────────── */

let toastHost;
export function toast(message, kind = 'info') {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast toast--${kind}` }, icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info', { size: 18 }), h('span', { text: message }));
  toastHost.append(el);
  setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 250); }, kind === 'error' ? 6000 : 3800);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Accessible modal dialog (focus trap, Esc, backdrop click). Returns { close, el }. */
export function openModal({ title, body, actions = [], wide = false, dismissible = true, onClose }) {
  const prev = document.activeElement;
  const titleId = `m${Math.random().toString(36).slice(2, 8)}`;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    document.body.classList.remove('no-scroll');
    prev?.focus?.();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const f = [...modal.querySelectorAll(FOCUSABLE)];
      if (!f.length) return;
      const first = f[0], last = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const modal = h('div', { class: `modal${wide ? ' modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal__head' },
      h('h2', { id: titleId, class: 'modal__title', text: title }),
      dismissible && h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), onClick: close }, icon('x'))),
    h('div', { class: 'modal__body' }, body),
    actions.length > 0 && h('div', { class: 'modal__foot' }, actions.map((a) =>
      h('button', { class: `btn btn--${a.kind || 'ghost'}`, type: 'button', disabled: a.disabled, onClick: () => a.onClick?.(close) }, a.label)))
  );
  const backdrop = h('div', { class: 'modal-backdrop', onMousedown: (e) => { if (e.target === backdrop && dismissible) close(); } }, modal);
  document.body.append(backdrop);
  document.body.classList.add('no-scroll');
  document.addEventListener('keydown', onKey, true);
  (modal.querySelector('[autofocus]') || modal.querySelector(FOCUSABLE))?.focus();
  return { close, el: modal };
}

export function confirmDialog(message, { title = t('common.confirm'), confirmLabel = t('common.confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({
      title, body: h('p', { text: message }), onClose: () => finish(false),
      actions: [
        { label: t('common.cancel'), kind: 'ghost', onClick: (c) => { finish(false); c(); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: (c) => { finish(true); c(); } },
      ],
    });
  });
}

/* ───────────────────────── shared widgets ───────────────────────── */

export function langToggle() {
  const btn = h('button', { class: 'lang-btn', type: 'button', onClick: () => setLang(getLang() === 'ar' ? 'en' : 'ar') });
  const paint = () => {
    mount(btn, icon('globe', { size: 16 }), h('span', { text: getLang() === 'ar' ? 'English' : 'عربي' }));
    btn.setAttribute('aria-label', getLang() === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    btn.setAttribute('lang', getLang() === 'ar' ? 'en' : 'ar');
  };
  paint();
  onLang(paint);
  return btn;
}

export function brand({ href = '/', compact = false } = {}) {
  return h('a', { class: 'brand', href, 'aria-label': 'Barbero' },
    h('img', { class: 'brand__logo', src: '/assets/logo-96.jpg', width: 40, height: 40, alt: '' }),
    !compact && h('span', { class: 'brand__word' }, h('b', { text: 'BARBERO' }), h('small', { 'data-i18n': 'brand.city', text: t('brand.city') })));
}

/**
 * The shop floor: ten chairs. States: free | booked | blocked | mine | past.
 * Interactive (booking) or read-only (landing page).
 */
export function chairBoard(chairs, { selected = null, onPick = null, size = 'md' } = {}) {
  const board = h('div', { class: `chairs chairs--${size}`, role: onPick ? 'radiogroup' : 'list', 'aria-label': t('chairs.label') });
  for (let n = 1; n <= 10; n++) {
    const c = chairs.find((x) => x.chair === n) ?? { chair: n, status: 'blocked' };
    const pickable = onPick && c.status === 'free';
    const state = selected === n ? 'selected' : c.status;
    const label = `${t('chairs.chair')} ${n} — ${t(`chairs.state.${c.status === 'blocked' ? 'blocked' : c.status}`)}`;
    const inner = [icon('chair', { size: size === 'sm' ? 22 : 30 }), h('span', { class: 'chair__n', text: n })];
    board.append(
      onPick
        ? h('button', { class: `chair chair--${state}`, type: 'button', role: 'radio', 'aria-checked': selected === n ? 'true' : 'false', 'aria-label': label, disabled: !pickable, onClick: () => onPick(n) }, inner)
        : h('div', { class: `chair chair--${state}`, role: 'listitem', 'aria-label': label }, inner)
    );
  }
  return board;
}

export const spinner = () => h('div', { class: 'spinner', role: 'status', 'aria-label': t('common.loading') });
export const emptyState = (iconName, title, text) =>
  h('div', { class: 'empty' }, icon(iconName, { size: 36 }), h('h3', { text: title }), text && h('p', { text }));

/** Debounce helper for search boxes. */
export const debounce = (fn, ms = 250) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };

/** .ics download (UTC times; the shop runs on UTC+3 year-round). */
export function downloadIcs({ date, hour, title, location }) {
  const [y, m, d] = date.split('-').map(Number);
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = Date.UTC(y, m - 1, d, hour - 3);
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barbero//Booking//EN', 'BEGIN:VEVENT', `UID:${start}-${Math.random().toString(36).slice(2)}@barbero`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(start)}`, `DTEND:${z(start + 3_600_000)}`, `SUMMARY:${esc(title)}`, `LOCATION:${esc(location)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = h('a', { href: '#', download: 'barbero-booking.ics' });
  a.setAttribute('href', url); // blob: URL we created ourselves (h() would refuse it by design)
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
