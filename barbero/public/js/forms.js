import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

/** Form building blocks. Client-side checks are UX only - the server re-validates everything. */

let seq = 0;

export function field({ name, label, type = 'text', autocomplete, placeholder, inputmode, maxlength, required = true, hint, value = '', multiline = false, rows = 3 }) {
  const id = `f${++seq}-${name}`;
  const props = { class: 'input', id, name, autocomplete, placeholder, maxlength, required, 'aria-describedby': `${id}-e` };
  const input = multiline ? h('textarea', { ...props, rows }) : h('input', { ...props, type, inputmode });
  if (value) input.value = value;
  const err = h('div', { class: 'field__error', id: `${id}-e`, role: 'alert' });
  const root = h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint && h('div', { class: 'field__hint', text: hint }), err);
  return {
    root, input, name,
    get value() { return input.value; },
    error(msg) { err.textContent = msg || ''; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); },
  };
}

export function strengthScore(pw) {
  let s = 0;
  if (pw.length >= 10) s = 1;
  if (pw.length >= 12) s += 1;
  if ([/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length >= 3) s += 1;
  if (pw.length >= 16) s += 1;
  return Math.min(4, s);
}

export function passwordField({ name, label, autocomplete, meter = false, hint }) {
  const f = field({ name, label, type: 'password', autocomplete, maxlength: 128, hint });
  const toggle = h('button', { class: 'pw__toggle', type: 'button', 'aria-label': t('pw.show'), 'aria-pressed': 'false' }, icon('eye', { size: 18 }));
  toggle.addEventListener('click', () => {
    const show = f.input.type === 'password';
    f.input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? t('pw.hide') : t('pw.show'));
    toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye', { size: 18 }));
  });
  const wrap = h('div', { class: 'pw' });
  f.input.replaceWith(wrap);
  wrap.append(f.input, toggle);
  if (meter) {
    const bar = h('div', { class: 'meter', 'data-s': '0', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
    const label = h('span', { class: 'meter__label', 'aria-live': 'polite' });
    f.input.addEventListener('input', () => {
      const s = strengthScore(f.input.value);
      bar.dataset.s = String(f.input.value ? Math.max(s, 0) : 0);
      label.textContent = f.input.value ? t(`pw.s${s}`) : '';
    });
    f.root.insertBefore(h('div', { class: 'meter-row' }, bar, label), f.root.querySelector('.field__error'));
  }
  return f;
}

/** Button with a busy state (prevents double submits). */
export function submitButton(text, { kind = 'primary', block = true, large = true } = {}) {
  const label = h('span', { text });
  const el = h('button', { class: `btn btn--${kind}${large ? ' btn--lg' : ''}${block ? ' btn--block' : ''}`, type: 'submit' }, label);
  return {
    el,
    setText(v) { label.textContent = v; },
    busy(on) { el.disabled = on; el.setAttribute('aria-busy', String(on)); el.classList.toggle('is-busy', on); },
  };
}

export const formBanner = () => {
  const el = h('div', { class: 'form-banner', role: 'alert', hidden: true });
  return {
    el,
    show(msg) { el.hidden = false; el.replaceChildren(icon('alert', { size: 18 }), h('span', { text: msg })); },
    hide() { el.hidden = true; el.replaceChildren(); },
  };
};
