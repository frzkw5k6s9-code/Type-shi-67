/**
 * XSS-safe DOM construction.
 *
 * Rules enforced here (and by the CSP + Trusted Types header the server sends):
 *   - there is NO innerHTML / insertAdjacentHTML anywhere in this code base;
 *   - strings become TEXT NODES, so `<script>` typed by a user is displayed, never executed;
 *   - URLs are allow-listed (no `javascript:` / `data:`);
 *   - inline event-handler *strings* and `style` *strings* are refused (they would also be blocked by CSP).
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'polyline', 'polygon', 'ellipse', 'defs', 'use']);
const PROP_ATTRS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'required', 'readOnly', 'open']);
const FORBIDDEN = new Set(['srcdoc', 'formaction', 'innerHTML', 'outerHTML']);

export function safeUrl(u) {
  const s = String(u);
  if (/^(\/(?!\/)|#|\?|\.\/)/.test(s)) return s; // same-site paths, fragments
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^tel:\+?[0-9]{5,16}$/i.test(s)) return s;
  if (/^mailto:[^\s"'<>]+$/i.test(s)) return s;
  return '#';
}

function append(parent, kid) {
  if (kid === null || kid === undefined || kid === false) return;
  if (Array.isArray(kid)) { kid.forEach((k) => append(parent, k)); return; }
  parent.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}

export function h(tag, props, ...kids) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (FORBIDDEN.has(k)) throw new Error(`h(): "${k}" is not allowed`);
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style') {
        if (typeof v !== 'object') throw new Error('h(): style must be an object');
        for (const [p, val] of Object.entries(v)) el.style.setProperty(p, String(val)); // CSSOM is CSP-safe
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) {
        if (typeof v !== 'function') throw new Error('h(): event handlers must be functions');
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'href' || k === 'src') el.setAttribute(k, safeUrl(v));
      else if (PROP_ATTRS.has(k) && !SVG_TAGS.has(tag)) el[k] = v === true ? true : v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids) append(el, kid);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const mount = (el, ...kids) => { el.replaceChildren(); kids.forEach((k) => append(el, k)); return el; };
export const frag = (...kids) => { const f = document.createDocumentFragment(); kids.forEach((k) => append(f, k)); return f; };
