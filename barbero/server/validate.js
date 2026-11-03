import { badRequest } from './errors.js';
import { isValidDate } from './util.js';

/**
 * Strict allow-list input validation. Every request body is parsed against a schema:
 *  - unknown keys are REJECTED (blocks mass-assignment such as {"role":"admin"})
 *  - every value is type-checked, length-limited and pattern-checked
 *  - the result is a fresh object, so nothing from the raw JSON (e.g. "__proto__") is carried over
 */

// control chars (except \t \n \r handled per-rule) and Unicode bidi-override/isolate characters
// (used for "Trojan Source"-style visual spoofing)
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BIDI = /[‪-‮⁦-⁩]/;

const fail = (field, code = 'invalid_input') => badRequest(code, { field });

export function parse(body, schema) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('bad_json');
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(schema, key)) throw fail(key, 'unknown_field');
  }
  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    out[key] = rule(Object.hasOwn(body, key) ? body[key] : undefined, key);
  }
  return out;
}

/** Validate a query-string / path value set (all strings) with the same rules. */
export function parseQuery(searchParams, schema) {
  const raw = {};
  for (const [k, v] of searchParams) {
    if (!Object.hasOwn(schema, k)) throw fail(k, 'unknown_field');
    raw[k] = v;
  }
  const out = {};
  for (const [key, rule] of Object.entries(schema)) out[key] = rule(Object.hasOwn(raw, key) ? raw[key] : undefined, key);
  return out;
}

const wrapOptional = (opts, fn) => (v, field) => {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return opts.default ?? null;
    throw fail(field, 'required');
  }
  return fn(v, field);
};

export const str = (opts = {}) =>
  wrapOptional(opts, (v, field) => {
    if (typeof v !== 'string') throw fail(field);
    let s = v.normalize('NFC');
    if (opts.trim !== false) s = s.trim();
    if (BIDI.test(s)) throw fail(field);
    if (CONTROL.test(opts.multiline ? s.replace(/[\n\r\t]/g, '') : s)) throw fail(field);
    if (!opts.multiline && /[\n\r\t]/.test(s)) throw fail(field);
    const min = opts.min ?? 1;
    if (s.length < min || s.length > (opts.max ?? 200)) throw fail(field);
    if (opts.re && !opts.re.test(s)) throw fail(field);
    return s;
  });

export const int = (opts = {}) =>
  wrapOptional(opts, (v, field) => {
    const n = typeof v === 'string' && /^-?\d{1,9}$/.test(v) ? Number(v) : v;
    if (!Number.isSafeInteger(n)) throw fail(field);
    if (n < (opts.min ?? 0) || n > (opts.max ?? 1_000_000_000)) throw fail(field);
    return n;
  });

export const bool = (opts = {}) =>
  wrapOptional(opts, (v, field) => {
    if (typeof v !== 'boolean') throw fail(field);
    return v;
  });

export const oneOf = (list, opts = {}) =>
  wrapOptional(opts, (v, field) => {
    if (typeof v !== 'string' || !list.includes(v)) throw fail(field);
    return v;
  });

export const date = (opts = {}) =>
  wrapOptional(opts, (v, field) => {
    if (!isValidDate(v)) throw fail(field);
    return v;
  });

export const intList = ({ min = 0, max = 100, len = 100, optional = false } = {}) =>
  wrapOptional({ optional }, (v, field) => {
    if (!Array.isArray(v) || v.length === 0 || v.length > len) throw fail(field);
    const out = new Set();
    for (const x of v) {
      if (!Number.isSafeInteger(x) || x < min || x > max) throw fail(field);
      out.add(x);
    }
    return [...out];
  });

export const email = (opts = {}) =>
  wrapOptional(opts, (v, field) => {
    if (typeof v !== 'string') throw fail(field);
    const s = v.trim().toLowerCase();
    if (s.length > 254 || !/^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[a-z]{2,}$/i.test(s)) throw fail(field, 'invalid_email');
    return s;
  });

/** Person names: letters (any script, incl. Arabic), marks, spaces and . ' - only. */
export const personName = (opts = {}) =>
  str({ min: 2, max: 60, re: /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u, ...opts });

export const phone = (opts = {}) =>
  wrapOptional(opts, (v, field) => {
    if (typeof v !== 'string') throw fail(field);
    const s = v.replace(/[\s()-]/g, '');
    if (!/^\+?[0-9]{8,15}$/.test(s)) throw fail(field, 'invalid_phone');
    return s;
  });

/** Passwords are NOT trimmed or normalised; only the length is bounded (hashing cost / DoS). */
export const password = () => (v, field) => {
  if (typeof v !== 'string' || v.length < 1 || v.length > 128) throw fail(field, 'password_invalid');
  return v;
};

/** A path segment that must be a positive integer id. */
export function idParam(v) {
  if (!/^[1-9]\d{0,9}$/.test(String(v))) throw badRequest('invalid_input', { field: 'id' });
  return Number(v);
}
