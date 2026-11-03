import { t } from '../i18n.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { get, put, post, errorText } from '../api.js';
import { toast, fmtHour, weekdayName, confirmDialog, spinner } from '../ui.js';
import { submitButton } from '../forms.js';
import { safe, pageHead, shopToday, addDays } from './common.js';

const dateInput = (value, label) => h('div', { class: 'field' }, h('label', { text: label }), h('input', { class: 'input', type: 'date', value, 'aria-label': label }));

export async function render(root, { alive }) {
  root.append(pageHead(t('adm.template.h'), t('adm.template.sub')));
  const host = h('div', { class: 'stack' }, spinner());
  root.append(host);
  const { days } = await safe(() => get('/api/admin/template'));
  if (!alive()) return;

  /* ── weekly template ── */
  const rows = days.map((d) => {
    const on = h('input', { type: 'checkbox', checked: d.enabled, 'aria-label': weekdayName(d.weekday) });
    const mk = (from, to, val) => {
      const s = h('select', { class: 'input' }, [...Array(to - from + 1).keys()].map((i) => h('option', { value: from + i, text: fmtHour(from + i) })));
      s.value = String(val);
      return s;
    };
    const open = mk(0, 23, d.openHour);
    const close = mk(1, 24, d.closeHour);
    const count = h('span', { class: 'chip chip--green' });
    const row = h('div', { class: 'tpl__row' },
      h('b', { text: weekdayName(d.weekday) }),
      h('label', { class: 'switch' }, on, h('span', { class: 'switch__track' }), h('span', { text: t('adm.open') })),
      h('div', { class: 'tpl__times' }, count, open, h('span', { class: 'muted', text: '→' }), close));
    const sync = () => {
      const n = Math.max(0, Number(close.value) - Number(open.value));
      row.classList.toggle('is-off', !on.checked);
      open.disabled = close.disabled = !on.checked;
      count.textContent = on.checked ? t('adm.slots_per_day', { h: n, n: n * 10 }) : t('visit.closed');
      count.className = `chip ${on.checked && n > 0 ? 'chip--green' : 'chip--dim'}`;
    };
    [on, open, close].forEach((el) => el.addEventListener('change', sync));
    sync();
    return { row, read: () => ({ weekday: d.weekday, enabled: on.checked, openHour: Number(open.value), closeHour: Number(close.value) }) };
  });
  const saveBtn = submitButton(t('adm.template.save'), { block: false, large: false });
  saveBtn.el.type = 'button';
  saveBtn.el.addEventListener('click', async () => {
    const payload = rows.map((r) => r.read());
    if (payload.some((x) => x.closeHour <= x.openHour)) return toast(t('err.invalid_hours'), 'error');
    saveBtn.busy(true);
    try { await safe(() => put('/api/admin/template', { days: payload })); toast(t('adm.saved'), 'success'); } catch (e) { toast(errorText(e), 'error'); } finally { saveBtn.busy(false); }
  });

  /* ── publish ── */
  const today = shopToday();
  const from = dateInput(today, t('adm.from'));
  const to = dateInput(addDays(today, 13), t('adm.to'));
  const notifyOn = h('input', { type: 'checkbox', checked: true });
  const pubBtn = submitButton(t('adm.publish.btn'), { kind: 'primary', block: false, large: false });
  pubBtn.el.type = 'button';
  pubBtn.el.addEventListener('click', async () => {
    const f = from.querySelector('input').value, e2 = to.querySelector('input').value;
    if (!f || !e2 || e2 < f) return toast(t('err.date_out_of_range'), 'error');
    pubBtn.busy(true);
    try {
      const r = await safe(() => post('/api/admin/publish', { from: f, to: e2, notify: notifyOn.checked }));
      if (r.created) toast(t('adm.published_full', { n: r.created, d: r.days, c: r.notified }), 'success'); else toast(t('adm.nothing_new'), 'info');
    } catch (err) { toast(errorText(err), 'error'); } finally { pubBtn.busy(false); }
  });

  /* ── retract ── */
  const rFrom = dateInput(today, t('adm.from'));
  const rTo = dateInput(addDays(today, 13), t('adm.to'));
  const retract = h('button', { class: 'btn btn--danger btn--sm', type: 'button', onClick: async () => {
    const f = rFrom.querySelector('input').value, e2 = rTo.querySelector('input').value;
    if (!f || !e2 || e2 < f) return toast(t('err.date_out_of_range'), 'error');
    if (!(await confirmDialog(t('adm.retract.q', { from: f, to: e2 }), { title: t('adm.retract.h'), confirmLabel: t('adm.retract.btn'), danger: true }))) return;
    try { const r = await safe(() => post('/api/admin/unpublish', { from: f, to: e2 })); toast(t('adm.retracted', { n: r.removed }), 'success'); } catch (err) { toast(errorText(err), 'error'); }
  } }, icon('x', { size: 15 }), t('adm.retract.btn'));

  mount(host,
    h('section', { class: 'card' }, h('h2', { text: t('adm.template.weekly') }), h('p', { class: 'help', style: { 'margin-bottom': '16px' }, text: t('adm.template.help') }),
      h('div', { class: 'tpl' }, rows.map((r) => r.row)), h('div', { class: 'row', style: { 'margin-top': '18px' } }, saveBtn.el)),
    h('section', { class: 'card' }, h('h2', { text: t('adm.publish.h') }), h('p', { class: 'help', style: { 'margin-bottom': '16px' }, text: t('adm.publish.help') }),
      h('div', { class: 'form-grid' }, from, to),
      h('div', { class: 'checkrow', style: { margin: '18px 0' } }, h('label', { class: 'switch' }, notifyOn, h('span', { class: 'switch__track' }), h('span', { text: t('adm.publish.notify') }))),
      pubBtn.el),
    h('section', { class: 'card' }, h('h2', { text: t('adm.retract.h') }), h('p', { class: 'help', style: { 'margin-bottom': '16px' }, text: t('adm.retract.help') }),
      h('div', { class: 'form-grid' }, rFrom, rTo, h('div', null, retract))));
}
