import { EN } from './i18n-en.js';
import { AR } from './i18n-ar.js';

/** English / Arabic (RTL) support. Text is always inserted with textContent, never as HTML. */
const DICT = { en: EN, ar: AR };
const KEY = 'barbero-lang';
let lang = 'en';
const listeners = new Set();

function saved() {
  try { return localStorage.getItem(KEY); } catch { return null; } // storage can be blocked
}

export function initLang() {
  const s = saved();
  lang = s === 'ar' || s === 'en' ? s : (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  apply();
}

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  translateStatic();
}

export function setLang(next) {
  if (next !== 'en' && next !== 'ar') return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  apply();
  listeners.forEach((fn) => fn(next));
}

export const getLang = () => lang;
export const onLang = (fn) => { listeners.add(fn); };

export function t(key, vars) {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  return s;
}

/** Translate everything marked with data-i18n* in `root`. */
export function translateStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const attr of ['placeholder', 'aria-label', 'title', 'alt']) {
    const ds = `i18n${attr === 'aria-label' ? 'AriaLabel' : attr[0].toUpperCase() + attr.slice(1)}`;
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.dataset[ds]));
  }
}
