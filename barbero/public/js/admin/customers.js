import { t } from '../i18n.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { get, post, errorText } from '../api.js';
import { toast, openModal, spinner, emptyState, debounce, fmtDate } from '../ui.js';
import { field } from '../forms.js';
import { safe, pageHead, telLink } from './common.js';

function messageDialog(c) {
  const title = field({ name: 'title', label: t('adm.notify.title'), maxlength: 80, placeholder: t('adm.notify.title_ph') });
  const body = field({ name: 'body', label: t('adm.notify.body'), multiline: true, rows: 4, maxlength: 500, placeholder: t('adm.notify.body_ph') });
  openModal({
    title: t('adm.msg_to', { name: c.name }),
    body: h('div', { class: 'form' }, title.root, body.root),
    actions: [
      { label: t('common.cancel'), kind: 'ghost', onClick: (close) => close() },
      { label: t('adm.notify.send'), kind: 'primary', onClick: async (close) => {
        title.error(''); body.error('');
        if (!title.value.trim()) return title.error(t('err.required'));
        if (!body.value.trim()) return body.error(t('err.required'));
        try { await safe(() => post('/api/admin/notify', { title: title.value.trim(), body: body.value.trim(), userId: c.id })); toast(t('adm.notify.sent', { n: 1 }), 'success'); close(); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

export async function render(root, { alive }) {
  root.append(pageHead(t('adm.customers.h'), t('adm.customers.sub')));
  const search = h('input', { class: 'input', type: 'search', maxlength: 60, placeholder: t('adm.customers.search'), 'aria-label': t('adm.customers.search'), style: { 'max-width': '420px' } });
  const out = h('div', null, spinner());
  root.append(h('div', { class: 'toolbar' }, search), out);

  async function load() {
    const q = search.value.trim();
    const { customers } = await safe(() => get(`/api/admin/customers?q=${encodeURIComponent(q)}`));
    if (!alive()) return;
    if (!customers.length) return mount(out, h('div', { class: 'card' }, emptyState('users', t('adm.customers.none'))));
    mount(out, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['adm.col.customer', 'adm.col.phone', 'adm.col.email', 'adm.col.bookings', 'adm.col.joined', ''].map((k) => h('th', { text: k ? t(k) : '' })))),
      h('tbody', null, customers.map((c) => h('tr', null,
        h('td', null, h('b', { text: c.name })), h('td', null, telLink(c.phone)),
        h('td', { style: { 'overflow-wrap': 'anywhere' }, text: c.email }), h('td', { class: 'num', text: c.bookings }),
        h('td', { class: 'num', text: fmtDate(new Date(c.createdAt + 3 * 3_600_000).toISOString().slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) }),
        h('td', null, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => messageDialog(c) }, icon('send', { size: 14 }), t('adm.customers.message')))))))));
  }
  search.addEventListener('input', debounce(() => load().catch((e) => toast(errorText(e), 'error')), 250));
  await load();
}
