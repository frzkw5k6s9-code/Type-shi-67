import { initLang, t, onLang } from './i18n.js';
import { h, mount, $ } from './dom.js';
import { icon } from './icons.js';
import { post, whoAmI, setCsrf, ApiError, errorText } from './api.js';
import { langToggle, toast, openModal, initials } from './ui.js';
import { passwordField, submitButton, formBanner } from './forms.js';
import { S } from './admin/common.js';
import * as overview from './admin/overview.js';
import * as schedule from './admin/schedule.js';
import * as template from './admin/template.js';
import * as notify from './admin/notify.js';
import * as customers from './admin/customers.js';
import * as services from './admin/services.js';
import * as activity from './admin/activity.js';

initLang();

const NAV = [['overview', 'grid'], ['schedule', 'calendar'], ['template', 'sliders'], ['notify', 'megaphone'], ['customers', 'users'], ['services', 'tag'], ['activity', 'list']];
const VIEWS = { overview, schedule, template, notify, customers, services, activity };

async function logout() {
  try { await post('/api/auth/logout'); } catch { /* ignore */ }
  location.assign('/login?portal=admin');
}

function renderChrome() {
  mount($('#nav'), NAV.map(([id, ic]) => h('button', { class: `nav-item${S.tab === id ? ' is-on' : ''}`, type: 'button', 'aria-current': S.tab === id ? 'page' : null, onClick: () => { location.hash = id; } }, icon(ic, { size: 18 }), h('span', { text: t(`adm.nav.${id}`) }))));
  const logoutBtn = () => h('button', { class: 'icon-btn', type: 'button', title: t('logout'), 'aria-label': t('logout'), onClick: logout }, icon('logout', { size: 18 }));
  mount($('#mobileActions'), langToggle(), logoutBtn());
  mount($('#sideFoot'),
    h('div', { class: 'side__user' }, h('span', { class: 'avatar', text: initials(S.user.name) }), h('div', { style: { 'min-width': '0' } }, h('b', { text: S.user.name }), h('small', { text: t('adm.role') }))),
    h('div', { class: 'row' }, langToggle(), h('a', { class: 'btn btn--ghost btn--sm', href: '/' }, icon('home', { size: 15 }), t('nav.home')), logoutBtn()));
}

function renderView() {
  const my = ++S.token;
  const root = $('#view');
  mount(root);
  const ctx = { alive: () => my === S.token && root.isConnected, go: (tab) => { location.hash = tab; } };
  Promise.resolve(VIEWS[S.tab].render(root, ctx)).catch((e) => { if (ctx.alive()) toast(errorText(e), 'error'); });
  renderChrome();
}

function route() {
  const id = location.hash.slice(1);
  const next = NAV.some(([x]) => x === id) ? id : 'overview';
  if (next !== S.tab) window.scrollTo({ top: 0, behavior: 'instant' });
  S.tab = next;
  renderView();
}

/** First sign-in with the generated password: nothing else works until it is replaced. */
function forcePasswordChange() {
  return new Promise((resolve) => {
    const cur = passwordField({ name: 'current', label: t('field.current_password'), autocomplete: 'current-password' });
    const next = passwordField({ name: 'next', label: t('field.new_password'), autocomplete: 'new-password', meter: true, hint: t('pw.hint') });
    const btn = submitButton(t('prof.save'));
    const banner = formBanner();
    const form = h('form', { class: 'form', novalidate: true }, banner.el, cur.root, next.root, btn.el);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      banner.hide(); cur.error(''); next.error('');
      if (!cur.value) return cur.error(t('err.password_invalid'));
      if (next.value.length < 10) return next.error(t('err.password_too_short'));
      btn.busy(true);
      try {
        const r = await post('/api/auth/password', { current: cur.value, next: next.value });
        setCsrf(r.csrf);
        S.user.mustChange = false;
        modal.close();
        toast(t('prof.changed'), 'success');
        resolve();
      } catch (err) {
        btn.busy(false);
        if (err instanceof ApiError && err.code === 'invalid_credentials') cur.error(errorText(err));
        else if (err instanceof ApiError && err.field === 'next') next.error(errorText(err));
        else banner.show(errorText(err));
      }
    });
    const modal = openModal({ title: t('adm.must_change.h'), dismissible: false, body: h('div', { class: 'form' }, h('p', { class: 'muted', text: t('adm.must_change.p') }), form) });
  });
}

async function boot() {
  let user;
  try { user = await whoAmI(); } catch { user = null; }
  if (!user || user.role !== 'admin') return location.replace('/login?portal=admin');
  S.user = user;
  onLang(() => { renderView(); });
  renderChrome();
  if (user.mustChange) await forcePasswordChange();
  window.addEventListener('hashchange', route);
  route();
}

boot();
