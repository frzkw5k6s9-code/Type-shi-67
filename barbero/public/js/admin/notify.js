import { t } from '../i18n.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { get, post, errorText } from '../api.js';
import { toast, confirmDialog } from '../ui.js';
import { field, submitButton } from '../forms.js';
import { safe, pageHead } from './common.js';

export async function render(root, { alive }) {
  root.append(pageHead(t('adm.notify.h'), t('adm.notify.sub')));
  const title = field({ name: 'title', label: t('adm.notify.title'), maxlength: 80, placeholder: t('adm.notify.title_ph') });
  const body = field({ name: 'body', label: t('adm.notify.body'), multiline: true, rows: 5, maxlength: 500, placeholder: t('adm.notify.body_ph') });
  const counter = h('span', { class: 'muted', style: { 'font-size': '0.8rem' } });
  const btn = submitButton(t('adm.notify.send'), { block: false, large: false });
  btn.el.type = 'button';

  // Live preview: exactly how it will look in the customer's inbox (rendered with textContent only).
  const pvTitle = h('h3'), pvBody = h('p', { class: 'pre' });
  const preview = h('article', { class: 'notif is-new' }, h('div', { class: 'notif__ic' }, icon('megaphone', { size: 20 })), h('div', null, pvTitle, pvBody), h('time', { text: t('adm.notify.now') }));
  const sync = () => {
    pvTitle.textContent = title.value || t('adm.notify.title_ph');
    pvBody.textContent = body.value || t('adm.notify.body_ph');
    counter.textContent = `${body.value.length}/500`;
  };
  title.input.addEventListener('input', sync);
  body.input.addEventListener('input', sync);
  sync();

  const quick = [['adm.quick1', 'adm.quick1_body'], ['adm.quick2', 'adm.quick2_body'], ['adm.quick3', 'adm.quick3_body']];
  btn.el.addEventListener('click', async () => {
    title.error(''); body.error('');
    if (!title.value.trim()) return title.error(t('err.required'));
    if (!body.value.trim()) return body.error(t('err.required'));
    let count = '';
    try { count = (await safe(() => get('/api/admin/summary'))).customers; } catch { /* just ask without the number */ }
    if (!(await confirmDialog(t('adm.notify.confirm', { n: count }), { title: t('adm.notify.send'), confirmLabel: t('adm.notify.send') }))) return;
    btn.busy(true);
    try {
      const r = await safe(() => post('/api/admin/notify', { title: title.value.trim(), body: body.value.trim() }));
      toast(t('adm.notify.sent', { n: r.sent }), 'success');
      title.input.value = ''; body.input.value = ''; sync();
    } catch (e) {
      const f = { title, body }[e.field];
      if (f) f.error(errorText(e)); else toast(errorText(e), 'error');
    } finally { btn.busy(false); }
  });

  root.append(h('div', { class: 'grid2' },
    h('section', { class: 'card form' },
      h('div', { class: 'row' }, quick.map(([tk, bk]) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => { title.input.value = t(tk); body.input.value = t(bk); sync(); } }, t(tk)))),
      title.root, body.root, h('div', { class: 'row', style: { 'justify-content': 'space-between' } }, counter, btn.el),
      h('p', { class: 'help', text: t('adm.notify.tip') })),
    h('section', { class: 'card' }, h('h2', { text: t('adm.notify.preview') }), preview,
      h('p', { class: 'help', style: { 'margin-top': '14px' }, text: t('adm.notify.auto') }))));
}
