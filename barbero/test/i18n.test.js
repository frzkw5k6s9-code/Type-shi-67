import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const server = join(here, '..', 'server');
const walk = (d, re, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p, re, out) : re.test(p) && out.push(p); } return out; };

const { EN } = await import('../public/js/i18n-en.js');
const { AR } = await import('../public/js/i18n-ar.js');

function usedKeys() {
  const keys = new Set();
  const files = [...walk(join(pub, 'js'), /\.js$/).filter((f) => !/i18n-/.test(f)), ...walk(pub, /\.html$/)];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bt\(\s*['"`]([\w.]+)['"`]/g)) keys.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-[a-z-]+)?=["']([\w.]+)["']/g)) keys.add(m[1]);
    for (const m of s.matchAll(/data-i18n['"]?\s*:\s*['"]([\w.]+)['"]/g)) keys.add(m[1]);
    for (const m of s.matchAll(/['"`]((?:adm|tab|nav|hero|feat\d|step\d|n)\.[\w.]+)['"`]/g)) keys.add(m[1]);
  }
  // dynamic families: t(`prefix.${x}`)
  for (const id of ['overview', 'schedule', 'template', 'notify', 'customers', 'services', 'activity']) keys.add(`adm.nav.${id}`);
  for (const i of ['scissors', 'clipper', 'beard', 'combo', 'razor', 'kid']) keys.add(`adm.icon.${i}`);
  for (const s of ['confirmed', 'cancelled', 'completed', 'no_show']) keys.add(`status.${s}`);
  for (const p of ['customer', 'admin']) { keys.add(`portal.${p}`); keys.add(`login.h.${p}`); keys.add(`login.sub.${p}`); }
  for (let i = 0; i <= 4; i++) keys.add(`pw.s${i}`);
  for (const s of ['free', 'booked', 'blocked', 'mine', 'past', 'selected']) keys.add(`chairs.state.${s}`);
  for (const k of ['feat1', 'feat2', 'feat3']) { keys.add(`${k}.t`); keys.add(`${k}.p`); }
  for (let n = 1; n <= 3; n++) { keys.add(`step${n}.t`); keys.add(`step${n}.p`); }
  for (const t of ['book', 'bookings', 'inbox', 'profile']) keys.add(`tab.${t}`);
  for (const c of ['welcome', 'booking_confirmed', 'booking_cancelled_admin', 'times_open']) { keys.add(`n.${c}.t`); keys.add(`n.${c}.p`); }
  return keys;
}

test('i18n: every key used by the UI exists in English and Arabic', () => {
  const missing = [];
  for (const k of usedKeys()) {
    if (!(k in EN)) missing.push(`EN: ${k}`);
    if (!(k in AR)) missing.push(`AR: ${k}`);
  }
  assert.deepEqual(missing, []);
});

test('i18n: English and Arabic dictionaries have identical keys and placeholders', () => {
  const only = [];
  for (const k of Object.keys(EN)) if (!(k in AR)) only.push(`missing in AR: ${k}`);
  for (const k of Object.keys(AR)) if (!(k in EN)) only.push(`missing in EN: ${k}`);
  assert.deepEqual(only, []);
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.keys(EN).filter((k) => k in AR && ph(EN[k]) !== ph(AR[k]));
  assert.deepEqual(bad, [], 'placeholders must match between languages');
  for (const [k, v] of Object.entries(AR)) assert.ok(v.trim().length > 0, k);
});

test('i18n: every error code the server can return has a translated message', () => {
  const codes = new Set();
  for (const f of walk(server, /\.js$/)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/HttpError\(\s*\d+\s*,\s*'(\w+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/\b(?:badRequest|unauthorized|forbidden|notFound|conflict)\(\s*'(\w+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/\bfail\([^)]*?,\s*'(\w+)'\)/g)) codes.add(m[1]);
    for (const m of s.matchAll(/return '(password_\w+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/\? '(hour_full|slot_unavailable)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/b\.chair \? '(\w+)' : '(\w+)'/g)) { codes.add(m[1]); codes.add(m[2]); }
  }
  codes.add('invalid_input'); codes.add('required'); codes.add('server_error');
  const missing = [...codes].filter((c) => !(`err.${c}` in EN) || !(`err.${c}` in AR));
  assert.deepEqual(missing, []);
  assert.ok(codes.size > 25, `found ${codes.size} codes`);
});
