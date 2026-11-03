import { initLang, t, onLang } from './i18n.js';
import { h, mount, $ } from './dom.js';
import { icon } from './icons.js';
import { post, whoAmI, setCsrf, ApiError, errorText } from './api.js';
import { langToggle } from './ui.js';
import { field, passwordField, submitButton, formBanner } from './forms.js';

initLang();
const params = new URLSearchParams(location.search);
let portal = params.get('portal') === 'admin' ? 'admin' : 'customer';
let mode = params.get('mode') === 'register' ? 'register' : 'signin';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[a-z]{2,}$/i;
const PHONE_RE = /^\+?[0-9]{8,15}$/;

/** Wire a <form>: validate (UX only), call the API, map server errors onto fields. */
function wireForm({ fields, button, banner, validate, call, onDone }) {
  const form = h('form', { novalidate: true, class: 'form' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    banner.hide();
    fields.forEach((f) => f.error(''));
    const problem = validate();
    if (problem) {
      if (problem.field) problem.field.error(problem.msg); else banner.show(problem.msg);
      (problem.field?.input ?? form.querySelector('input'))?.focus();
      return;
    }
    button.busy(true);
    try {
      const res = await call();
      if (res.csrf) setCsrf(res.csrf);
      onDone(res);
    } catch (err) {
      button.busy(false);
      const target = err instanceof ApiError && err.field ? fields.find((f) => f.name === err.field) : null;
      if (target) { target.error(errorText(err)); target.input.focus(); } else banner.show(errorText(err));
    }
  });
  return form;
}

const go = (res) => location.assign(res.user.role === 'admin' ? '/admin' : '/account');

function signInForm(kind) {
  const email = field({ name: 'email', label: t('field.email'), type: 'email', autocomplete: 'username', placeholder: t('ph.email'), maxlength: 254, inputmode: 'email' });
  const pw = passwordField({ name: 'password', label: t('field.password'), autocomplete: 'current-password' });
  const btn = submitButton(t('btn.signin'), { kind: kind === 'admin' ? 'primary' : 'primary' });
  const banner = formBanner();
  const form = wireForm({
    fields: [email, pw], button: btn, banner,
    validate: () => (!EMAIL_RE.test(email.value.trim()) ? { field: email, msg: t('err.invalid_email') } : !pw.value ? { field: pw, msg: t('err.password_invalid') } : null),
    call: () => post('/api/auth/login', { email: email.value.trim(), password: pw.value, portal: kind }),
    onDone: go,
  });
  form.append(banner.el, email.root, pw.root, btn.el);
  return form;
}

function registerForm() {
  const name = field({ name: 'name', label: t('field.name'), autocomplete: 'name', placeholder: t('ph.name'), maxlength: 60 });
  const email = field({ name: 'email', label: t('field.email'), type: 'email', autocomplete: 'email', placeholder: t('ph.email'), maxlength: 254, inputmode: 'email' });
  const phone = field({ name: 'phone', label: t('field.phone'), type: 'tel', autocomplete: 'tel', placeholder: t('ph.phone'), maxlength: 20, inputmode: 'tel' });
  const pw = passwordField({ name: 'password', label: t('field.password_new'), autocomplete: 'new-password', meter: true, hint: t('pw.hint') });
  const btn = submitButton(t('btn.register'));
  const banner = formBanner();
  const form = wireForm({
    fields: [name, email, phone, pw], button: btn, banner,
    validate: () => {
      if (name.value.trim().length < 2) return { field: name, msg: t('err.invalid_input') };
      if (!EMAIL_RE.test(email.value.trim())) return { field: email, msg: t('err.invalid_email') };
      if (!PHONE_RE.test(phone.value.replace(/[\s()-]/g, ''))) return { field: phone, msg: t('err.invalid_phone') };
      if (pw.value.length < 10) return { field: pw, msg: t('err.password_too_short') };
      return null;
    },
    call: () => post('/api/auth/register', { name: name.value.trim(), email: email.value.trim(), phone: phone.value, password: pw.value }),
    onDone: go,
  });
  form.append(banner.el, name.root, email.root, phone.root, pw.root, btn.el);
  return form;
}

function render() {
  // tabs
  mount($('#seg'), ['customer', 'admin'].map((p) =>
    h('button', { class: `seg__btn${portal === p ? ' is-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(portal === p), onClick: () => { portal = p; mode = 'signin'; render(); } },
      icon(p === 'admin' ? 'shield' : 'user', { size: 16 }), h('span', { text: t(`portal.${p}`) }))));

  const host = $('#formHost');
  const register = portal === 'customer' && mode === 'register';
  const head = h('div', { class: 'auth__head' },
    portal === 'admin' && h('span', { class: 'chip chip--yellow' }, icon('lock', { size: 13 }), t('portal.admin')),
    h('h2', { text: register ? t('reg.h') : t(`login.h.${portal}`) }),
    h('p', { class: 'muted', text: register ? t('reg.sub') : t(`login.sub.${portal}`) }));
  const form = register ? registerForm() : signInForm(portal);
  const foot = portal === 'admin'
    ? h('p', { class: 'auth__foot muted', text: t('login.admin_note') })
    : h('p', { class: 'auth__foot' }, h('span', { class: 'muted', text: register ? t('login.have_account') : t('login.no_account') }), ' ',
        h('button', { class: 'linkbtn', type: 'button', onClick: () => { mode = register ? 'signin' : 'register'; render(); } }, register ? t('btn.signin') : t('login.create')));
  mount(host, head, form, h('p', { class: 'secure-note' }, icon('shield', { size: 15 }), h('span', { text: t('login.secure') })), foot);
  host.setAttribute('aria-label', t(`portal.${portal}`));
  mount($('#trust'), [['shield', 'trust.1'], ['lock', 'trust.2'], ['refresh', 'trust.3']].map(([i, k]) => h('li', null, icon(i, { size: 18 }), h('span', { text: t(k) }))));
  mount($('#backLink'), icon('chevL', { size: 16, class: 'icon--dir' }), h('span', { text: t('login.back') }));
}

$('#langSlot').replaceChildren(langToggle());
onLang(render);
render();
whoAmI().then((u) => { if (u) go({ user: u }); }).catch(() => {});
