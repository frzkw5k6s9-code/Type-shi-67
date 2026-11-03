import { t } from '../i18n.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { get, post, put, errorText } from '../api.js';
import { toast, spinner } from '../ui.js';
import { field, submitButton } from '../forms.js';
import { safe, pageHead } from './common.js';

const ICONS = ['scissors', 'clipper', 'beard', 'combo', 'razor', 'kid'];

/** One editable service card (also used, empty, to add a new service). */
function editor(svc, onSaved) {
  const isNew = !svc;
  const s = svc ?? { nameEn: '', nameAr: '', descEn: '', descAr: '', icon: 'scissors', priceSar: null, active: true };
  const nameEn = field({ name: 'nameEn', label: t('adm.svc.name_en'), maxlength: 60, value: s.nameEn });
  const nameAr = field({ name: 'nameAr', label: t('adm.svc.name_ar'), maxlength: 60, value: s.nameAr });
  const descEn = field({ name: 'descEn', label: t('adm.svc.desc_en'), maxlength: 200, required: false, value: s.descEn });
  const descAr = field({ name: 'descAr', label: t('adm.svc.desc_ar'), maxlength: 200, required: false, value: s.descAr });
  const price = field({ name: 'priceSar', label: `${t('adm.svc.price')} (${t('currency')})`, type: 'number', inputmode: 'numeric', required: false, value: s.priceSar === null ? '' : String(s.priceSar) });
  price.input.min = '0'; price.input.max = '10000'; price.input.step = '1';
  const sel = h('select', { class: 'input', id: `ic-${Math.random().toString(36).slice(2, 7)}` }, ICONS.map((i) => h('option', { value: i, text: t(`adm.icon.${i}`) })));
  sel.value = s.icon;
  const active = h('input', { type: 'checkbox', checked: s.active });
  const btn = submitButton(isNew ? t('adm.svc.add') : t('common.save'), { block: false, large: false });
  btn.el.type = 'button';
  const card = h('div', { class: `svc-edit${s.active ? '' : ' is-off'}` },
    h('div', { class: 'svc-edit__row' }, nameEn.root, nameAr.root, price.root),
    h('div', { class: 'svc-edit__row' }, descEn.root, descAr.root),
    h('div', { class: 'svc-edit__row' },
      h('div', { class: 'field' }, h('label', { text: t('adm.svc.icon') }), sel),
      h('label', { class: 'switch' }, active, h('span', { class: 'switch__track' }), h('span', { text: t('adm.svc.active') })),
      h('div', { class: 'row', style: { 'justify-content': 'flex-end' } }, btn.el)));
  active.addEventListener('change', () => card.classList.toggle('is-off', !active.checked));
  btn.el.addEventListener('click', async () => {
    [nameEn, nameAr, price, descEn, descAr].forEach((f) => f.error(''));
    const payload = { nameEn: nameEn.value.trim(), nameAr: nameAr.value.trim(), descEn: descEn.value.trim(), descAr: descAr.value.trim(), icon: sel.value, active: active.checked };
    if (price.value.trim() !== '') payload.priceSar = Number(price.value);
    btn.busy(true);
    try {
      if (isNew) await safe(() => post('/api/admin/services', payload)); else await safe(() => put(`/api/admin/services/${svc.id}`, payload));
      toast(t('adm.saved'), 'success');
      onSaved();
    } catch (e) {
      const f = { nameEn, nameAr, descEn, descAr, priceSar: price }[e.field];
      if (f) f.error(errorText(e)); else toast(errorText(e), 'error');
    } finally { btn.busy(false); }
  });
  return card;
}

export async function render(root, { alive }) {
  root.append(pageHead(t('adm.svc.h'), t('adm.svc.sub')));
  const host = h('div', { class: 'stack' }, spinner());
  root.append(host);
  async function load() {
    const { services } = await safe(() => get('/api/admin/services'));
    if (!alive()) return;
    mount(host,
      h('section', { class: 'card' }, h('h2', { text: t('adm.svc.new') }), editor(null, load)),
      h('div', { class: 'stack' }, services.map((s) => editor(s, load))));
  }
  await load();
}
