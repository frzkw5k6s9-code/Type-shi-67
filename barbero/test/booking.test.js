import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, Client, adminWithSlots } from './helpers.js';
import { nowShop, addDays } from '../server/util.js';

let S, admin, tomorrow, today, svc;
before(async () => {
  S = await bootServer();
  ({ admin, tomorrow, today } = await adminWithSlots(S.base, 5));
  svc = (await admin.get('/api/admin/services')).json.services[0].id;
});
after(async () => { await S.close(); });

let n = 0;
async function customer() {
  const c = new Client(S.base);
  const r = await c.register(++n, `Customer Number${'abcdefghij'[n % 10]}`);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  c.id = r.json.user.id;
  return c;
}
const book = (c, hour, chair, extra = {}) => c.post('/api/bookings', { date: tomorrow, hour, chair, serviceId: svc, ...extra });
const grid = async (c, d = tomorrow) => (await c.get(`/api/slots?date=${d}`)).json;

test('template -> publish: 10 chairs x one-hour slots, exactly as the template says', async () => {
  const g = await admin.get(`/api/admin/slots?date=${tomorrow}`);
  assert.equal(g.json.chairs, 10);
  assert.deepEqual(g.json.hours.map((h) => h.hour), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], '10:00-22:00 => twelve 1-hour frames');
  for (const h of g.json.hours) {
    assert.deepEqual(h.chairs.map((c) => c.chair), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(h.chairs.every((c) => c.status === 'free'));
  }
  assert.equal(S.db.prepare('SELECT COUNT(*) AS n FROM slots WHERE date = ?').get(tomorrow).n, 120);
  // re-publishing is idempotent
  const again = await admin.post('/api/admin/publish', { from: tomorrow, to: tomorrow, notify: false });
  assert.equal(again.json.created, 0);
  // there is no 11th chair and no 25th hour
  assert.equal((await admin.post('/api/admin/slots/set', { date: tomorrow, hours: [10], chairs: [11], status: 'blocked' })).status, 400);
  assert.equal((await admin.post('/api/admin/slots/set', { date: tomorrow, hours: [24], chairs: [1], status: 'blocked' })).status, 400);
  assert.throws(() => S.db.prepare("INSERT INTO slots (date, hour, chair, status) VALUES (?, 10, 11, 'free')").run(tomorrow), /CHECK/);
  assert.throws(() => S.db.prepare("INSERT INTO slots (date, hour, chair, status) VALUES (?, 10, 1, 'free')").run(tomorrow), /UNIQUE/);
});

test('template validation: hours must be whole, ordered and within the day', async () => {
  const days = (o) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, enabled: true, openHour: 10, closeHour: 22, ...(weekday === 2 ? o : {}) }));
  assert.equal((await admin.put('/api/admin/template', { days: days({ openHour: 22, closeHour: 10 }) })).status, 400);
  assert.equal((await admin.put('/api/admin/template', { days: days({ closeHour: 25 }) })).status, 400);
  assert.equal((await admin.put('/api/admin/template', { days: days({ openHour: 9.5 }) })).status, 400);
  assert.equal((await admin.put('/api/admin/template', { days: days({}).slice(0, 6) })).status, 400);
  assert.equal((await admin.put('/api/admin/template', { days: days({}) })).status, 200);
});

test('publishing with notify tells every customer when booking times open', async () => {
  const c = await customer();
  const far = addDays(today, 8);
  const r = await admin.post('/api/admin/publish', { from: far, to: addDays(far, 1), notify: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.created, 2 * 12 * 10);
  assert.ok(r.json.notified >= 1);
  const list = (await c.get('/api/notifications')).json;
  const note = list.notifications.find((x) => x.code === 'times_open');
  assert.deepEqual(note.params, { from: far, to: addDays(far, 1) });
  assert.ok(list.unread >= 2); // welcome + times_open
  assert.equal((await c.post('/api/notifications/read', {})).status, 200);
  assert.equal((await c.get('/api/notifications')).json.unread, 0);
});

test('admin can message all customers or one customer', async () => {
  const a = await customer();
  const b = await customer();
  const all = await admin.post('/api/admin/notify', { title: 'Eid hours', body: 'Open 2pm-midnight.\nSee you!' });
  assert.ok(all.json.sent >= 2);
  const one = await admin.post('/api/admin/notify', { title: 'Your chair', body: 'Chair 4 is ready.', userId: a.id });
  assert.equal(one.json.sent, 1);
  assert.ok((await a.get('/api/notifications')).json.notifications.some((x) => x.title === 'Your chair'));
  assert.ok(!(await b.get('/api/notifications')).json.notifications.some((x) => x.title === 'Your chair'));
  assert.equal((await admin.post('/api/admin/notify', { title: 'x', body: 'y', userId: 999999 })).status, 404);
});

test('booking: chair is taken, double-booking is refused, "any chair" picks the lowest free one', async () => {
  const a = await customer();
  const b = await customer();
  const r1 = await book(a, 11, 3);
  assert.equal(r1.status, 201);
  assert.equal(r1.json.booking.chair, 3);
  const r2 = await book(b, 11, 3);
  assert.equal(r2.status, 409); assert.equal(r2.json.error.code, 'slot_taken');
  const r3 = await book(b, 11, undefined);
  assert.equal(r3.status, 201); assert.equal(r3.json.booking.chair, 1);
  const ga = await grid(a);
  const row = ga.hours.find((h) => h.hour === 11);
  assert.equal(row.chairs.find((c) => c.chair === 3).status, 'mine');
  assert.equal(row.chairs.find((c) => c.chair === 1).status, 'booked', 'someone else\'s chair is just "booked" - no identity leaked');
  assert.equal(row.free, 8);
  assert.ok(!JSON.stringify(ga).match(/Customer|example\.com|user/i));
  // admin sees who/what
  const adm = (await admin.get(`/api/admin/slots?date=${tomorrow}`)).json.hours.find((h) => h.hour === 11).chairs.find((c) => c.chair === 3);
  assert.equal(adm.status, 'booked');
  assert.match(adm.booking.customer.name, /^Customer Number/);
});

test('booking: ten customers can race for ONE chair - exactly one wins (no double-booking)', async () => {
  const people = await Promise.all(Array.from({ length: 10 }, customer));
  const res = await Promise.all(people.map((p) => book(p, 15, 7)));
  const codes = res.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
  assert.equal(S.db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND hour = 15 AND chair = 7 AND status = 'confirmed'").get(tomorrow).n, 1);
});

test('booking: all 10 chairs fill up, the 11th customer is told the hour is full', async () => {
  const people = await Promise.all(Array.from({ length: 11 }, customer));
  const res = [];
  for (const p of people) res.push(await book(p, 17, undefined)); // "any chair"
  assert.deepEqual(res.map((r) => r.status), [201, 201, 201, 201, 201, 201, 201, 201, 201, 201, 409]);
  assert.equal(res[10].json.error.code, 'hour_full');
  assert.deepEqual(res.slice(0, 10).map((r) => r.json.booking.chair).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const g = await grid(people[10]);
  assert.equal(g.hours.find((h) => h.hour === 17).free, 0);
});

test('booking rules: one chair per person per hour, max 3 upcoming, valid service/date/hour', async () => {
  const c = await customer();
  assert.equal((await book(c, 12, 1)).status, 201);
  const dup = await book(c, 12, 2);
  assert.equal(dup.status, 409); assert.equal(dup.json.error.code, 'already_booked_hour');
  assert.equal((await book(c, 13, 1)).status, 201);
  assert.equal((await book(c, 14, 1)).status, 201);
  const cap = await book(c, 16, 1);
  assert.equal(cap.status, 409); assert.equal(cap.json.error.code, 'too_many_active');
  const d = await customer();
  assert.equal((await d.post('/api/bookings', { date: tomorrow, hour: 12, chair: 9, serviceId: 99999 })).status, 400);
  assert.equal((await d.post('/api/bookings', { date: tomorrow, hour: 12, chair: 0, serviceId: svc })).status, 400);
  assert.equal((await d.post('/api/bookings', { date: tomorrow, hour: 25, chair: 1, serviceId: svc })).status, 400);
  assert.equal((await d.post('/api/bookings', { date: tomorrow, hour: 12, chair: 1, serviceId: svc, price: 0 })).status, 400, 'unknown fields rejected');
  assert.equal((await d.post('/api/bookings', { date: addDays(today, -1), hour: 12, chair: 1, serviceId: svc })).status, 400);
  assert.equal((await d.post('/api/bookings', { date: addDays(today, 400), hour: 12, chair: 1, serviceId: svc })).status, 400);
  assert.equal((await d.post('/api/bookings', { date: addDays(today, 20), hour: 12, chair: 1, serviceId: svc })).status, 409, 'unpublished day: no slot to book');
});

test('cancel: frees the chair, only the owner may cancel (no IDOR), admin cancel notifies', async () => {
  const a = await customer();
  const b = await customer();
  const mine = await book(a, 18, 4);
  const id = mine.json.booking.id;
  assert.equal((await b.post(`/api/bookings/${id}/cancel`, {})).status, 404, 'another customer cannot cancel it');
  assert.equal((await b.post('/api/bookings/999999/cancel', {})).status, 404);
  assert.equal((await a.post(`/api/bookings/${id}/cancel`, {})).status, 200);
  assert.equal((await a.post(`/api/bookings/${id}/cancel`, {})).status, 409, 'already cancelled');
  assert.equal((await book(b, 18, 4)).status, 201, 'the chair is bookable again');

  const c = await customer();
  const bk = (await book(c, 19, 2)).json.booking.id;
  const x = await admin.post(`/api/admin/bookings/${bk}/cancel`, { reason: 'Barber is sick <3' });
  assert.equal(x.status, 200);
  const note = (await c.get('/api/notifications')).json.notifications.find((q) => q.code === 'booking_cancelled_admin');
  assert.equal(note.params.reason, 'Barber is sick <3');
  assert.equal((await book(await customer(), 19, 2)).status, 201);
});

test('cancel: inside the 2-hour cutoff only the shop can cancel', { skip: nowShop().hour >= 22 }, async () => {
  const now = nowShop();
  const c = await customer();
  const r = await c.post('/api/bookings', { date: now.date, hour: now.hour + 1, chair: 8, serviceId: svc });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const t = await c.post(`/api/bookings/${r.json.booking.id}/cancel`, {});
  assert.equal(t.status, 409); assert.equal(t.json.error.code, 'too_late');
  assert.equal((await admin.post(`/api/admin/bookings/${r.json.booking.id}/cancel`, {})).status, 200);
});

test('past hours are not bookable', { skip: nowShop().hour < 11 }, async () => {
  const now = nowShop();
  const c = await customer();
  const r = await c.post('/api/bookings', { date: now.date, hour: 10, chair: 1, serviceId: svc });
  assert.equal(r.status, 409); assert.equal(r.json.error.code, 'slot_in_past');
});

test('admin: block / free chairs, cannot overwrite a booked chair, bookings marked completed / no-show', async () => {
  const blk = await admin.post('/api/admin/slots/set', { date: tomorrow, hours: [20], chairs: [1, 2, 3], status: 'blocked' });
  assert.equal(blk.json.changed, 3);
  const c = await customer();
  assert.equal((await book(c, 20, 2)).json.error.code, 'slot_taken', 'blocked chairs cannot be booked');
  assert.equal((await grid(c)).hours.find((h) => h.hour === 20).chairs[0].status, 'blocked');
  assert.equal((await book(c, 20, undefined)).json.booking.chair, 4, '"any chair" skips blocked ones');
  const over = await admin.post('/api/admin/slots/set', { date: tomorrow, hours: [20], chairs: [4], status: 'blocked' });
  assert.deepEqual(over.json, { changed: 0, skipped: 1 }, 'a booked chair is never overwritten');
  assert.equal((await admin.post('/api/admin/slots/set', { date: tomorrow, hours: [20], chairs: [1, 2, 3], status: 'free' })).json.changed, 3);

  const id = (await c.get('/api/bookings/mine')).json.bookings.find((x) => x.hour === 20).id;
  assert.equal((await admin.post(`/api/admin/bookings/${id}/status`, { status: 'completed' })).status, 200);
  assert.equal((await admin.post(`/api/admin/bookings/${id}/status`, { status: 'no_show' })).status, 409, 'only confirmed bookings can change');
  assert.equal((await admin.post(`/api/admin/bookings/${id}/status`, { status: 'admin' })).status, 400);
});

test('admin: dashboard summary, day sheet, unpublish keeps booked chairs, audit trail records actions', async () => {
  const s = (await admin.get('/api/admin/summary')).json;
  assert.ok(s.customers > 10);
  assert.ok(s.weekBookings > 10);
  const day = (await admin.get(`/api/admin/bookings?date=${tomorrow}`)).json.bookings;
  assert.ok(day.length > 10 && day.every((b) => b.customer.name && b.status !== 'cancelled'));
  const before = S.db.prepare("SELECT COUNT(*) AS n FROM slots WHERE date = ? AND status = 'booked'").get(tomorrow).n;
  const un = await admin.post('/api/admin/unpublish', { from: tomorrow, to: tomorrow });
  assert.ok(un.json.removed > 0);
  assert.equal(S.db.prepare("SELECT COUNT(*) AS n FROM slots WHERE date = ?").get(tomorrow).n, before, 'only booked chairs remain');
  const audit = (await admin.get('/api/admin/audit')).json.entries.map((e) => e.action);
  for (const a of ['publish', 'unpublish', 'notify', 'slots_set', 'template_saved', 'login']) assert.ok(audit.includes(a), a);
});

test('admin: services & prices are editable and appear on the public API', async () => {
  const list = (await admin.get('/api/admin/services')).json.services;
  const s = list[0];
  const body = { nameEn: s.nameEn, nameAr: s.nameAr, descEn: s.descEn, descAr: s.descAr, icon: 'scissors', priceSar: 80, active: true };
  assert.equal((await admin.put(`/api/admin/services/${s.id}`, body)).status, 200);
  const pub = await fetch(`${S.base}/api/public/info`).then((r) => r.json());
  assert.equal(pub.services.find((x) => x.id === s.id).priceSar, 80);
  assert.equal((await admin.put(`/api/admin/services/${s.id}`, { ...body, priceSar: -5 })).status, 400);
  assert.equal((await admin.put(`/api/admin/services/${s.id}`, { ...body, icon: '<script>' })).status, 400);
  assert.equal((await admin.put(`/api/admin/services/${s.id}`, { ...body, active: false })).status, 200);
  assert.ok(!(await fetch(`${S.base}/api/public/info`).then((r) => r.json())).services.some((x) => x.id === s.id), 'inactive services are hidden');
});

test('public API exposes availability + the next open hour, with no personal data', async () => {
  const av = await fetch(`${S.base}/api/public/availability?days=7`).then((r) => r.json());
  assert.equal(av.days.length, 7);
  assert.ok(av.days.some((d) => d.open && d.free > 0));
  const nx = await fetch(`${S.base}/api/public/next`).then((r) => r.json());
  assert.ok(nx.next === null || nx.next.chairs.length === 10);
  const info = await fetch(`${S.base}/api/public/info`).then((r) => r.text());
  assert.ok(!/pw_hash|@example\.com|owner@barbero/.test(info));
});

test('first-run admin: generated password must be changed before anything else works', async () => {
  const T = await bootServer({ adminEmail: null, adminPassword: null });
  try {
    const row = T.db.prepare("SELECT must_change FROM users WHERE role = 'admin'").get();
    assert.equal(row.must_change, 1);
    // we can't know the random password, so set a known one the same way create-admin does, then flag it
    const hash = await T.app.hasher.hash('Temp-Generated-Pass-1');
    T.db.prepare("UPDATE users SET pw_hash = ? WHERE role = 'admin'").run(hash);
    const a = new Client(T.base);
    const l = await a.login('admin@barbero.local', 'Temp-Generated-Pass-1', 'admin');
    assert.equal(l.status, 200); assert.equal(l.json.user.mustChange, true);
    assert.equal((await a.get('/api/admin/summary')).json.error.code, 'password_change_required');
    assert.equal((await a.post('/api/auth/password', { current: 'Temp-Generated-Pass-1', next: 'Temp-Generated-Pass-1' })).status, 400);
    assert.equal((await a.post('/api/auth/password', { current: 'Temp-Generated-Pass-1', next: 'Real-Owner-Passphrase-2026' })).status, 200);
    assert.equal((await a.get('/api/admin/summary')).status, 200);
  } finally { await T.close(); }
});
