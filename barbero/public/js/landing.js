import { initLang, t, getLang, onLang } from './i18n.js';
import { h, mount, $ } from './dom.js';
import { icon, hasIcon } from './icons.js';
import { get, whoAmI } from './api.js';
import { langToggle, chairBoard, fmtHour, fmtDate, weekdayName, dayParts, price, svcName, svcDesc, openModal } from './ui.js';

document.documentElement.classList.add('js');
initLang();

const state = { info: null, next: null, avail: null, user: null };
const SAFE_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const prettyPhone = (p) => (/^\+966(\d{2})(\d{3})(\d{4})$/.exec(p) ? p.replace(/^\+966(\d{2})(\d{3})(\d{4})$/, '+966 $1 $2 $3') : p);

/* ───────────────────────── static chrome ───────────────────────── */

$('#langSlot').replaceChildren(langToggle());
const nav = $('#nav');
const burger = h('button', { class: 'icon-btn nav__burger', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'menu', 'data-i18n-aria-label': 'nav.menu', 'aria-label': t('nav.menu'),
  onClick: () => { const open = nav.classList.toggle('is-open'); burger.setAttribute('aria-expanded', String(open)); } }, icon('menu'));
$('#burgerSlot').replaceChildren(burger);
$('#menu').addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('is-open'); burger.setAttribute('aria-expanded', 'false'); } });
const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
  : null;
function reveal(root = document) {
  for (const el of root.querySelectorAll('.reveal:not(.is-in)')) (io ? io.observe(el) : el.classList.add('is-in'));
}

/* ───────────────────────── renderers ───────────────────────── */

const FEATS = [['scissors', 'feat1'], ['beard', 'feat2'], ['razor', 'feat3']];

function renderMarquee() {
  const words = t('marquee.words').split('|');
  const group = () => words.map((w) => h('span', { class: 'marquee__item' }, h('span', { text: w }), icon('mustache', { size: 38 })));
  mount($('#marquee'), h('div', { style: { display: 'flex' } }, group()), h('div', { style: { display: 'flex' } }, group()));
}

function renderFeats() {
  mount($('#feats'), FEATS.map(([ic, k]) => h('li', null, h('div', { class: 'ic' }, icon(ic, { size: 26 })), h('div', null, h('h3', { text: t(`${k}.t`) }), h('p', { text: t(`${k}.p`) })))));
}

function renderSteps() {
  mount($('#steps'), [1, 2, 3].map((n) => h('li', { class: 'reveal', style: { 'transition-delay': `${n * 90}ms` } },
    h('span', { class: 'steps__n', text: `0${n}` }), h('h3', { text: t(`step${n}.t`) }), h('p', { text: t(`step${n}.p`) }))));
  reveal($('#steps'));
}

function renderServices() {
  const grid = $('#svcGrid');
  if (!state.info) return;
  mount(grid, state.info.services.map((s, i) => {
    const p = price(s.priceSar);
    return h('article', { class: 'svc reveal', style: { 'transition-delay': `${(i % 3) * 90}ms` } },
      h('div', { class: 'svc__top' }, h('div', { class: 'svc__ic' }, icon(hasIcon(s.icon) ? s.icon : 'scissors', { size: 28 })), p && h('div', { class: 'svc__price', text: p })),
      h('h3', { text: svcName(s) }),
      h('p', { text: svcDesc(s) }),
      h('div', { class: 'svc__foot' }, h('span', null, h('span', { text: t('svc.duration') })), h('a', { href: '/account' }, t('svc.book'), icon('arrowR', { size: 16, class: 'icon--dir' }))));
  }));
  reveal(grid);
}

function dayLabel(date) {
  const today = state.avail?.today;
  if (!today) return fmtDate(date);
  if (date === today) return t('day.today');
  const t1 = new Date(`${today}T12:00:00Z`); t1.setUTCDate(t1.getUTCDate() + 1);
  return date === t1.toISOString().slice(0, 10) ? t('day.tomorrow') : fmtDate(date);
}

function renderBoard() {
  const n = state.next?.next;
  const holder = $('#boardChairs');
  if (!n) {
    $('#boardTime').textContent = '—';
    $('#boardDay').textContent = t('board.none');
    $('#boardCount').textContent = t('board.soon');
    mount(holder, chairBoard(Array.from({ length: 10 }, (_, i) => ({ chair: i + 1, status: 'blocked' }))));
    return;
  }
  $('#boardTime').textContent = fmtHour(n.hour);
  $('#boardDay').textContent = dayLabel(n.date);
  $('#boardCount').textContent = t('board.free_of', { n: n.free });
  mount(holder, chairBoard(n.chairs));
}

function renderDays() {
  const box = $('#days');
  if (!state.avail) return;
  mount(box, state.avail.days.slice(0, 7).map((d) => {
    const p = dayParts(d.date);
    const cls = ['day', d.date === state.avail.today && 'day--today', !d.open && 'day--soon', d.open && d.free === 0 && 'day--full'].filter(Boolean).join(' ');
    const wd = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    const closedDay = state.info?.hours.find((x) => x.weekday === wd)?.enabled === false;
    const label = !d.open ? (closedDay ? t('visit.closed') : t('days.soon')) : d.free === 0 ? t('days.full') : t('days.free', { n: d.free });
    const inner = [h('span', { class: 'day__wd', text: d.date === state.avail.today ? t('day.today') : p.wd }), h('span', { class: 'day__n', text: p.day }), h('span', { class: 'day__free', text: label })];
    return d.open && d.free > 0 ? h('a', { class: cls, href: '/account' }, inner) : h('div', { class: cls }, inner);
  }));
}

function renderGallery() {
  const photos = state.info?.photos;
  const section = $('#gallery');
  const hero = $('#heroPhoto');
  if (photos?.hero) {
    hero.style.setProperty('--hero-img', `url("/assets/photos/${encodeURIComponent(photos.hero)}")`);
    hero.classList.add('has-img');
  }
  const list = photos?.gallery ?? [];
  section.hidden = list.length === 0;
  $('#navGallery').hidden = list.length === 0;
  if (!list.length) return;
  mount($('#galleryGrid'), list.map((f, i) => {
    const src = `/assets/photos/${encodeURIComponent(f)}`;
    const img = h('img', { src, loading: 'lazy', decoding: 'async', alt: t('gal.alt', { n: i + 1 }) });
    return h('figure', { class: 'reveal', tabindex: 0, role: 'button', 'aria-label': t('gal.open', { n: i + 1 }),
      onClick: () => openModal({ title: t('gal.h'), wide: true, body: h('img', { class: 'lightbox-img', src, alt: t('gal.alt', { n: i + 1 }) }) }),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } }, img);
  }));
  reveal($('#galleryGrid'));
}

function renderVisit() {
  const info = state.info;
  if (!info) return;
  const s = info.shop;
  const rows = [];
  if (s.area) {
    rows.push(h('li', null, h('a', { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.mapsQuery || s.name)}`, target: '_blank', rel: 'noopener noreferrer' },
      h('span', { class: 'ic' }, icon('pin')), h('span', null, h('b', { text: t('visit.address') }), h('span', { class: 'v', text: getLang() === 'ar' && s.areaAr ? s.areaAr : s.area })))));
  }
  if (s.phone && /^\+?[0-9]{8,15}$/.test(s.phone)) {
    rows.push(h('li', null, h('a', { href: `tel:${s.phone}` }, h('span', { class: 'ic' }, icon('phone')), h('span', null, h('b', { text: t('visit.phone') }), h('span', { class: 'v', text: prettyPhone(s.phone) })))));
  }
  if (s.instagram && SAFE_HANDLE.test(s.instagram)) {
    rows.push(h('li', null, h('a', { href: `https://www.instagram.com/${s.instagram}/`, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'ic' }, icon('instagram')), h('span', null, h('b', { text: 'Instagram' }), h('span', { class: 'v', text: `@${s.instagram}` })))));
  }
  mount($('#contact'), rows);

  const shopDay = new Date(Date.now() + 3 * 3600_000).getUTCDay();
  mount($('#hours'), info.hours.map((d) => h('li', { class: d.weekday === shopDay ? 'is-today' : '' },
    h('span', { text: weekdayName(d.weekday) }),
    h('span', { class: d.enabled ? '' : 'closed', text: d.enabled ? `${fmtHour(d.openHour)} – ${fmtHour(d.closeHour)}` : t('visit.closed') }))));
}

function renderAll() {
  renderMarquee(); renderFeats(); renderSteps(); renderServices(); renderBoard(); renderDays(); renderGallery(); renderVisit();
  $('#ctaArrow').replaceChildren(icon('arrowR', { size: 20, class: 'icon--dir' }));
  reveal();
}

/* ───────────────────────── data ───────────────────────── */

async function refreshLive() {
  try {
    const [next, avail] = await Promise.all([get('/api/public/next'), get('/api/public/availability?days=7')]);
    state.next = next; state.avail = avail;
    renderBoard(); renderDays();
  } catch { /* offline: keep showing what we have */ }
}

async function boot() {
  renderAll();
  const [info, user] = await Promise.allSettled([get('/api/public/info'), whoAmI()]);
  if (info.status === 'fulfilled') state.info = info.value;
  if (user.status === 'fulfilled' && user.value) {
    state.user = user.value;
    const login = $('#navLogin');
    login.setAttribute('href', user.value.role === 'admin' ? '/admin' : '/account');
    login.dataset.i18n = user.value.role === 'admin' ? 'nav.dashboard' : 'nav.account';
    login.textContent = t(login.dataset.i18n);
    if (user.value.role === 'admin') $('.nav__cta').setAttribute('href', '/admin');
  }
  await refreshLive();
  renderAll();
}

onLang(() => renderAll());
setInterval(() => { if (!document.hidden) refreshLive(); }, 60_000);
boot();
