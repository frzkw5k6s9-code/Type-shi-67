import { t } from './i18n.js';

let csrfToken = null;
export const setCsrf = (v) => { csrfToken = v; };

export class ApiError extends Error {
  constructor(status, code, field, retryAfter) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAfter = retryAfter;
  }
}

/** Same-origin JSON fetch. Adds the per-session CSRF token to every state-changing request. */
export async function api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  let res;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty / non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'server_error', data?.error?.field, data?.error?.retryAfter);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);

export async function whoAmI() {
  const r = await get('/api/auth/me');
  if (r.csrf) setCsrf(r.csrf);
  return r.user;
}

/** Human, translated message for an ApiError. */
export function errorText(e) {
  if (!(e instanceof ApiError)) return t('err.server_error');
  const key = `err.${e.code}`;
  const msg = t(key);
  const base = msg === key ? t('err.server_error') : msg;
  return e.code === 'too_many_attempts' && e.retryAfter ? `${base} (${Math.ceil(e.retryAfter / 60)} ${t('unit.min')})` : base;
}
