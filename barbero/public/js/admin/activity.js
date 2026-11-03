import { t } from '../i18n.js';
import { h, mount } from '../dom.js';
import { get } from '../api.js';
import { spinner } from '../ui.js';
import { safe, pageHead, fmtDateTime } from './common.js';

export async function render(root, { alive }) {
  root.append(pageHead(t('adm.activity.h'), t('adm.activity.sub')));
  const out = h('div', null, spinner());
  root.append(out);
  const { entries } = await safe(() => get('/api/admin/audit'));
  if (!alive()) return;
  const label = (a) => { const k = `adm.audit.${a}`; const v = t(k); return v === k ? a : v; };
  mount(out, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, ['adm.col.when', 'adm.col.who', 'adm.col.action', 'adm.col.detail', 'adm.col.ip'].map((k) => h('th', { text: t(k) })))),
    h('tbody', null, entries.map((e) => h('tr', null,
      h('td', { class: 'num', text: fmtDateTime(e.createdAt) }), h('td', { text: e.actor ?? '—' }),
      h('td', null, h('span', { class: 'tag-code', text: label(e.action) })),
      h('td', { style: { 'overflow-wrap': 'anywhere', 'max-width': '360px' }, text: e.detail }),
      h('td', { class: 'num muted', text: e.ip ?? '' })))))));
}
