// Boot: auth gate → shell (sidebar on lg+, header + sheet below) → hash router.
import { api, session, onUnauthorized } from './api.mjs';
import { h, mount, iconEl, button, badge, sheet, skeleton, errorState, confirmDialog, toast, busy, fmt } from './ui.mjs';
import { route, start, stop, navigate } from './router.mjs';

import loginView from './views/login.mjs';
import dashboard from './views/dashboard.mjs';
import calendar from './views/calendar.mjs';
import day from './views/day.mjs';
import puzzles from './views/puzzles.mjs';
import analytics from './views/analytics.mjs';
import team from './views/team.mjs';
import settings from './views/settings.mjs';
import activity from './views/activity.mjs';
import account from './views/account.mjs';

route('/', dashboard);
route('/calendar', calendar);
route('/calendar/:month', calendar);
route('/day/:date', day);
route('/puzzles', puzzles);
route('/puzzles/new', puzzles);
route('/puzzles/:id', puzzles);
route('/analytics', analytics);
route('/team', team);
route('/settings', settings);
route('/activity', activity);
route('/account', account);

const OWNER_ONLY = new Set(['/team', '/settings']);
const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
const ROLE_TONE = { owner: 'brand', editor: 'blue', viewer: 'neutral' };

export const state = { me: null, org: null, unpublished: 0 };
export const canEdit = (me = state.me) => me?.role === 'owner' || me?.role === 'editor';
export const isOwner = (me = state.me) => me?.role === 'owner';

const appEl = () => document.getElementById('app');

// ── Navigation model ─────────────────────────────────────────────────────────
const NAV = [
  { href: '#/', label: 'Dashboard', icon: 'home', match: (p) => p === '/' },
  { href: '#/calendar', label: 'Calendar', icon: 'calendar-days', match: (p) => p.startsWith('/calendar') || p.startsWith('/day/') },
  { href: '#/puzzles', label: 'Puzzles', icon: 'puzzle-piece', match: (p) => p.startsWith('/puzzles') },
  { href: '#/analytics', label: 'Analytics', icon: 'chart-bar', match: (p) => p.startsWith('/analytics') },
  { href: '#/team', label: 'Team', icon: 'users', owner: true, match: (p) => p.startsWith('/team') },
  { href: '#/settings', label: 'Settings', icon: 'cog-6-tooth', owner: true, match: (p) => p.startsWith('/settings') },
];
const FOOTER_NAV = [
  { href: '#/activity', label: 'Activity', icon: 'clock', match: (p) => p.startsWith('/activity') },
  { href: '#/account', label: 'Account', icon: 'user-circle', match: (p) => p.startsWith('/account') },
];

const navLinks = new Set();
const navItem = (item, onNavigate) => {
  const a = h('a', {
    href: item.href,
    class: 'group flex items-center gap-x-3 rounded-lg px-2 py-2 text-base/6 font-medium text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-950 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 data-current:bg-zinc-950/5 data-current:text-zinc-950 sm:py-1.5 sm:text-sm/5 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white dark:data-current:bg-white/5 dark:data-current:text-white',
    'on:click': () => onNavigate?.(),
  },
    iconEl(item.icon, 'size-4 shrink-0 fill-zinc-400 group-hover:fill-zinc-950 group-data-current:fill-zinc-950 dark:fill-zinc-500 dark:group-hover:fill-white dark:group-data-current:fill-white'),
    h('span', { class: 'truncate' }, item.label));
  a._match = item.match;
  navLinks.add(a);
  return a;
};

const syncNav = (path) => {
  for (const a of navLinks) {
    if (!a.isConnected) { navLinks.delete(a); continue; }
    const on = a._match(path);
    a.toggleAttribute('data-current', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  }
};

const wordmark = () => h('a', { href: '#/', 'aria-label': 'Dashboard', class: 'flex min-w-0 items-baseline gap-x-1.5 rounded-md text-base/7 tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600' },
  h('span', { class: 'font-semibold text-zinc-950 dark:text-white' }, 'Links'),
  h('span', { class: 'font-medium text-zinc-500 dark:text-zinc-400' }, 'Backroom'));

const signOut = async () => {
  try { await api('auth_logout'); } catch { /* already gone */ }
  session.clear();
  showLogin();
};

// The contents of the sidebar, used both on lg+ and inside the mobile sheet.
const navBody = (onNavigate) => {
  const { me, org } = state;
  const items = NAV.filter((n) => !n.owner || isOwner(me));
  return h('div', { class: 'flex min-h-full flex-col' },
    h('div', { class: 'flex flex-col gap-y-0.5 border-b border-zinc-950/5 p-4 dark:border-white/5' },
      wordmark(),
      org?.name ? h('p', { class: 'truncate text-base/6 text-zinc-500 sm:text-sm/5 dark:text-zinc-400' }, org.name) : null),
    h('nav', { 'aria-label': 'Main', class: 'flex-1 p-4' },
      h('ul', { role: 'list', class: 'grid gap-y-0.5' }, items.map((i) => h('li', {}, navItem(i, onNavigate))))),
    h('div', { class: 'grid gap-y-4 border-t border-zinc-950/5 p-4 dark:border-white/5' },
      h('ul', { role: 'list', class: 'grid gap-y-0.5' }, FOOTER_NAV.map((i) => h('li', {}, navItem(i, onNavigate)))),
      h('div', { class: 'flex items-center gap-x-3' },
        h('div', { class: 'min-w-0 flex-1' },
          h('p', { class: 'truncate text-base/6 font-medium text-zinc-950 sm:text-sm/5 dark:text-white' }, me?.name || me?.email || 'Signed in'),
          h('div', { class: 'mt-0.5 flex items-center gap-x-2' }, badge({ label: ROLE_LABEL[me?.role] || me?.role || 'Staff', tone: ROLE_TONE[me?.role] || 'neutral' }))),
        button({ icon: 'arrow-right-start-on-rectangle', variant: 'ghost', title: 'Sign out', 'aria-label': 'Sign out', onClick: signOut }))));
};

// ── Unpublished banner ───────────────────────────────────────────────────────
let bannerEl = null;
const renderBanner = () => {
  if (!bannerEl) return;
  const n = state.unpublished | 0;
  if (n <= 0) { bannerEl.hidden = true; bannerEl.replaceChildren(); return; }
  bannerEl.hidden = false;
  mount(bannerEl,
    h('div', { class: 'mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8' },
      h('div', { class: 'flex min-w-0 flex-1 items-start gap-x-2 text-base/6 sm:text-sm/6' },
        h('div', { class: 'flex h-lh shrink-0 items-center' }, iconEl('exclamation-triangle', 'size-4 shrink-0 fill-amber-500 dark:fill-amber-400')),
        h('p', { class: 'min-w-0 text-pretty text-amber-900 dark:text-amber-200' },
          h('span', { class: 'font-medium' }, n === 1 ? '1 unpublished change.' : `${fmt.num(n)} unpublished changes.`),
          ' Players see them after the next publish.')),
      canEdit() ? button({ label: 'Publish', icon: 'rocket-launch', size: 'sm', variant: 'secondary', onClick: (e) => publishNow(e.currentTarget) }) : null));
};

export const publishNow = async (btn) => {
  const ok = await confirmDialog({
    title: 'Publish changes?',
    body: 'The game rebuilds with the latest calendar and puzzles. It usually takes a minute or two.',
    confirmLabel: 'Publish',
  });
  if (!ok) return false;
  try {
    await busy(btn, () => api('publish'));
    toast('Publish started. The game updates in a minute or two.');
    return true;
  } catch (err) {
    toast(err.message, { tone: 'error' });
    return false;
  }
};

const MUTATING = new Set(['day_save', 'nod_save', 'puzzle_save', 'puzzle_archive', 'publish']);
let refreshTimer = null;
const refreshBuild = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { api('dashboard').catch(() => {}); }, 400);
};
window.addEventListener('br:api', (e) => {
  const { op, data } = e.detail || {};
  if (op === 'dashboard' && data?.build) { state.unpublished = data.build.unpublished | 0; renderBanner(); }
  else if (op === 'publish') { state.unpublished = 0; renderBanner(); }
  else if (MUTATING.has(op) && state.me) refreshBuild();
});

// ── Shell + routing ──────────────────────────────────────────────────────────
let mainEl = null;
let renderSeq = 0;

const renderShell = () => {
  navLinks.clear();
  const menuBtn = button({ icon: 'bars-3', variant: 'ghost', 'aria-label': 'Open navigation', title: 'Open navigation', onClick: () => {
    sheet({
      label: 'Navigation',
      body: ({ close }) => h('div', { class: 'relative flex min-h-full flex-col' },
        h('div', { class: 'absolute top-3 right-3' }, button({ icon: 'x-mark', variant: 'ghost', 'aria-label': 'Close navigation', title: 'Close navigation', onClick: close })),
        navBody(close)),
    });
    syncNav(location.hash.replace(/^#/, '').split('?')[0] || '/');
  } });

  bannerEl = h('div', { class: 'border-b border-amber-500/20 bg-amber-50 dark:border-amber-400/10 dark:bg-amber-400/5', hidden: true });
  mainEl = h('div', { class: 'mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10' });

  mount(appEl(),
    h('a', { href: '#main', class: 'sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-zinc-950 focus:ring-1 focus:ring-zinc-950/10 dark:focus:bg-zinc-900 dark:focus:text-white dark:focus:ring-white/10' }, 'Skip to content'),
    h('aside', { class: 'fixed inset-y-0 left-0 w-64 overflow-y-auto border-r border-zinc-950/5 bg-white max-lg:hidden dark:border-white/10 dark:bg-zinc-950' }, navBody()),
    h('header', { class: 'sticky top-0 z-30 flex items-center gap-x-3 border-b border-zinc-950/5 bg-white/90 px-4 py-2 backdrop-blur-sm sm:px-6 lg:hidden dark:border-white/10 dark:bg-zinc-950/90' },
      menuBtn, wordmark()),
    h('div', { class: 'lg:pl-64' },
      bannerEl,
      h('main', { id: 'main', tabindex: '-1', class: 'focus:outline-hidden' }, mainEl)));
  renderBanner();
};

const onRoute = async ({ path, query, params, viewFn }) => {
  syncNav(path);
  const seq = ++renderSeq;
  const ctx = { params, query, me: state.me, org: state.org, navigate, canEdit: canEdit(), isOwner: isOwner() };
  if (!viewFn) {
    mount(mainEl, errorState({ message: 'There is no page at this address.' }, () => navigate('/')));
    return;
  }
  if (OWNER_ONLY.has(path) && !isOwner()) {
    mount(mainEl, errorState({ message: 'Only the owner can open this page.' }, () => navigate('/')));
    return;
  }
  mount(mainEl, h('div', { class: 'pt-2' }, skeleton(6)));
  try {
    const node = await viewFn(ctx);
    if (seq !== renderSeq) return; // a newer navigation won
    mount(mainEl, node);
    window.scrollTo(0, 0);
  } catch (err) {
    if (seq !== renderSeq || err?.status === 401) return;
    console.error(err);
    mount(mainEl, errorState(err, () => onRoute({ path, query, params, viewFn })));
  }
};

const showLogin = () => {
  stop();
  state.me = null; state.org = null; state.unpublished = 0;
  bannerEl = null; mainEl = null;
  navLinks.clear();
  loginView({ onSignedIn: (data) => { session.set(data.token); boot(); } })
    .then((node) => mount(appEl(), node))
    .catch((err) => mount(appEl(), h('div', { class: 'p-6' }, errorState(err, showLogin))));
};

onUnauthorized(() => showLogin());

// Allow views (e.g. settings after a save) to refresh org/me in the shell.
export const reloadMe = async () => {
  const data = await api('me');
  state.me = data.me; state.org = data.org;
  if (mainEl) {
    const aside = appEl().querySelector('aside');
    if (aside) { mount(aside, navBody()); syncNav(location.hash.replace(/^#/, '').split('?')[0] || '/'); }
  }
  return data;
};

export const boot = async () => {
  if (!session.token) return showLogin();
  mount(appEl(), h('div', { class: 'mx-auto max-w-6xl p-8' }, skeleton(4)));
  try {
    const data = await api('me');
    state.me = data.me; state.org = data.org;
  } catch (err) {
    if (err.status === 401) return showLogin();
    return mount(appEl(), h('div', { class: 'mx-auto max-w-xl p-8' }, errorState(err, boot)));
  }
  renderShell();
  start(onRoute);
  // Prime the unpublished banner (the dashboard view's own call also feeds it).
  if (location.hash.replace(/^#/, '').split('?')[0] !== '/' && location.hash !== '') refreshBuild();
};

boot();
