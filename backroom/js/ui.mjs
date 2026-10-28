// DOM + component helpers shared by every Backroom view. Contract: spec §4.
// Every class string is written out in full so Tailwind's scanner can see it.
import { icon } from './icons.mjs';

// ── h(): tiny hyperscript ─────────────────────────────────────────────────────
// attrs: class, style (string|object), on:event, html (trusted SVG/markup only),
// value/checked/selected (set as properties), booleans (true → present, false/null → absent).
const PROPS = new Set(['value', 'checked', 'selected', 'indeterminate']);

const append = (el, kids) => {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
};

export const h = (tag, attrs = {}, ...children) => {
  if (attrs == null || attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs)) {
    children.unshift(attrs); attrs = {};
  }
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on:')) el.addEventListener(k.slice(3), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'ref') v(el);
    else if (k === 'style' && typeof v === 'object') for (const [p, pv] of Object.entries(v)) el.style.setProperty(p, pv);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
};

export const mount = (el, ...nodes) => { el.replaceChildren(); append(el, nodes); return el; };

// An icon as a DOM node (icons.mjs returns markup strings).
export const iconEl = (name, cls) => {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstElementChild || document.createTextNode('');
};

let uid = 0;
export const id = (prefix = 'br') => `${prefix}-${++uid}`;

const cx = (...c) => c.filter(Boolean).join(' ');

// ── Formatting ────────────────────────────────────────────────────────────────
const asDate = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  // Bare calendar dates are local days, not UTC midnights.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00`);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dtf = (o) => new Intl.DateTimeFormat(undefined, o);
const nf = new Intl.NumberFormat();
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const fmt = {
  date: (v) => { const d = asDate(v); return d ? dtf({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d) : '—'; },
  dateShort: (v) => { const d = asDate(v); return d ? dtf({ month: 'short', day: 'numeric' }).format(d) : '—'; },
  dateTime: (v) => { const d = asDate(v); return d ? dtf({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) : '—'; },
  num: (v) => (v == null || Number.isNaN(+v) ? '—' : nf.format(+v)),
  pct: (v, digits = 0) => (v == null || Number.isNaN(+v) ? '—' : `${(+v * 100).toFixed(digits)}%`),
  rel: (v) => {
    const d = asDate(v);
    if (!d) return 'Never';
    const s = Math.round((d.getTime() - Date.now()) / 1000);
    const a = Math.abs(s);
    if (a < 45) return 'Just now';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
    return rtf.format(Math.round(s / (86400 * 365)), 'year');
  },
};

// ── Buttons ───────────────────────────────────────────────────────────────────
// Two sizes only: md = 36px, sm = 28px. Focus ring is always brand-600.
const BTN_BASE = 'relative inline-flex shrink-0 items-center justify-center gap-x-1.5 rounded-lg font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-50';
const BTN_VARIANT = {
  primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 dark:bg-brand-500 dark:shadow-none dark:hover:bg-brand-600',
  secondary: 'bg-white text-zinc-950 shadow-xs ring-1 ring-zinc-950/10 ring-inset hover:bg-zinc-50 dark:bg-white/5 dark:text-white dark:shadow-none dark:ring-white/10 dark:hover:bg-white/10',
  ghost: 'text-zinc-700 hover:bg-zinc-950/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white',
  danger: 'bg-white text-red-700 shadow-xs ring-1 ring-zinc-950/10 ring-inset hover:bg-red-50 dark:bg-white/5 dark:text-red-400 dark:shadow-none dark:ring-white/10 dark:hover:bg-red-500/10',
  // Solid red: only for the primary action of a destructive confirm dialog.
  'danger-solid': 'bg-red-600 text-white shadow-xs hover:bg-red-700 dark:bg-red-500 dark:shadow-none dark:hover:bg-red-600',
};
const BTN_SIZE = {
  md: { text: 'px-3 py-1.5 text-sm/6', icon: 'py-1.5 pr-2.5 pl-1.5 text-sm/6', only: 'p-2.5' },
  sm: { text: 'px-2.5 py-1 text-sm/5', icon: 'py-1 pr-2 pl-1 text-sm/5', only: 'p-1.5' },
};
const ICON_FILL = {
  primary: 'size-4 shrink-0 fill-white/80',
  secondary: 'size-4 shrink-0 fill-zinc-500 dark:fill-zinc-400',
  ghost: 'size-4 shrink-0 fill-zinc-500 dark:fill-zinc-400',
  danger: 'size-4 shrink-0 fill-red-600 dark:fill-red-400',
  'danger-solid': 'size-4 shrink-0 fill-white/80',
};
const touchTarget = () => h('span', { class: 'absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden', 'aria-hidden': 'true' });

// button({label, variant, size, icon, onClick, type, href, title, disabled, 'aria-label'})
// href renders an <a>. An icon with no label renders an icon-only button (pass aria-label or title).
export const button = ({ label, variant = 'secondary', size = 'md', icon: ic, onClick, type = 'button', href, target, title, disabled, class: extra, ...rest } = {}) => {
  const v = BTN_VARIANT[variant] ? variant : 'secondary';
  const s = BTN_SIZE[size] || BTN_SIZE.md;
  const iconOnly = ic && !label;
  const cls = cx(BTN_BASE, BTN_VARIANT[v], iconOnly ? s.only : ic ? s.icon : s.text, extra);
  const kids = [ic ? iconEl(ic, ICON_FILL[v]) : null, label ? h('span', { class: 'truncate' }, label) : null, iconOnly ? touchTarget() : null];
  const attrs = { class: cls, title, 'aria-label': rest['aria-label'] || (iconOnly ? title : null), ...rest };
  if (href) {
    const a = h('a', { ...attrs, href, target, rel: target === '_blank' ? 'noopener' : null }, ...kids);
    if (onClick) a.addEventListener('click', onClick);
    return a;
  }
  const b = h('button', { ...attrs, type, disabled: !!disabled }, ...kids);
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

// Disable a button while an async action runs; resolves to the action's result.
export const busy = async (btn, fn) => {
  if (!btn) return fn();
  const was = btn.disabled;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally { btn.disabled = was; btn.removeAttribute('aria-busy'); }
};

// ── Badges ────────────────────────────────────────────────────────────────────
const BADGE_TONE = {
  neutral: 'bg-zinc-600/10 text-zinc-700 dark:bg-white/5 dark:text-zinc-400',
  brand: 'bg-brand-500/15 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300',
  amber: 'bg-amber-400/20 text-amber-800 dark:bg-amber-400/10 dark:text-amber-400',
  red: 'bg-red-500/15 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  blue: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
};
export const badge = ({ label, tone = 'neutral', title } = {}) =>
  h('span', { class: cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-sm/5 font-medium whitespace-nowrap sm:text-xs/5', BADGE_TONE[tone] || BADGE_TONE.neutral), title }, label);

// ── Form controls ─────────────────────────────────────────────────────────────
const CONTROL = 'block w-full rounded-lg bg-white py-2 text-base/6 text-zinc-950 ring-1 ring-zinc-950/10 ring-inset placeholder:text-zinc-400 focus:outline-2 focus:-outline-offset-1 focus:outline-brand-600 disabled:bg-zinc-950/5 disabled:text-zinc-500 aria-invalid:ring-red-500/60 sm:py-1.5 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:ring-white/10 dark:placeholder:text-zinc-500 dark:disabled:bg-white/2.5 dark:aria-invalid:ring-red-400/60';

const ensureName = (attrs) => {
  const a = { ...attrs };
  if (!a.id) a.id = id('f');
  if (!a.name) a.name = a.id;
  return a;
};

// Horizontal padding is added here, not in CONTROL, so a caller can supply its
// own (e.g. room for a leading icon) without two classes fighting over one property.
const ownsPadX = (c) => /(^|\s)(sm:)?p[xlr]-/.test(c || '');
export const input = (attrs = {}) => {
  const a = ensureName(attrs);
  return h('input', { type: 'text', ...a, class: cx(CONTROL, ownsPadX(a.class) ? null : 'px-3', a.class) });
};

export const textarea = (attrs = {}) => {
  const a = ensureName(attrs);
  const { value, ...rest } = a;
  const el = h('textarea', { rows: 3, ...rest, class: cx(CONTROL, ownsPadX(a.class) ? null : 'px-3', 'resize-y', a.class) });
  if (value != null) el.value = value;
  return el;
};

// Proxies common control properties from a wrapper to its inner control, so
// select()/toggle() can be used like the native element they wrap.
const proxy = (wrap, ctl, props) => {
  wrap.control = ctl;
  for (const p of props) Object.defineProperty(wrap, p, { get: () => ctl[p], set: (v) => { ctl[p] = v; } });
  return wrap;
};

// select(attrs, options) — options: ['a','b'] or [{value, label, disabled}]. Returns a wrapper
// with .value/.disabled/.control proxied to the inner <select>.
export const select = (attrs = {}, options = []) => {
  const a = ensureName(attrs);
  const { value, class: extra, ...rest } = a;
  const sel = h('select', { ...rest, class: cx(CONTROL, 'col-span-full row-start-1 appearance-none pr-8 pl-3', extra) },
    options.map((o) => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      return h('option', { value: String(opt.value), disabled: !!opt.disabled }, opt.label ?? String(opt.value));
    }));
  if (value != null) sel.value = String(value);
  const wrap = h('div', { class: 'inline-grid w-full grid-cols-[1fr_--spacing(8)]' }, sel,
    h('span', {
      class: 'pointer-events-none col-start-2 row-start-1 place-self-center text-zinc-500 dark:text-zinc-400',
      html: '<svg viewBox="0 0 8 5" width="8" height="5" fill="none" class="pointer-events-none"><path d="M.5.5 4 4 7.5.5" stroke="currentcolor" /></svg>',
    }));
  return proxy(wrap, sel, ['value', 'disabled', 'name', 'id', 'selectedIndex']);
};

// toggle(attrs) — native checkbox styled as a switch. Returns a wrapper with .checked proxied.
export const toggle = (attrs = {}) => {
  const a = ensureName(attrs);
  const { checked, class: extra, ...rest } = a;
  const cb = h('input', { type: 'checkbox', ...rest, class: 'absolute inset-0 size-full cursor-pointer appearance-none focus:outline-hidden disabled:cursor-not-allowed' });
  cb.checked = !!checked;
  const wrap = h('div', { class: cx('group relative inline-flex w-11 shrink-0 rounded-full bg-zinc-200 p-0.5 inset-ring inset-ring-zinc-900/5 outline-offset-2 outline-brand-600 transition-colors duration-200 ease-in-out has-checked:bg-brand-600 has-focus-visible:outline-2 has-disabled:opacity-50 sm:w-9 dark:bg-white/5 dark:inset-ring-white/10 dark:outline-brand-500 dark:has-checked:bg-brand-500', extra) },
    h('span', { class: 'aspect-square w-1/2 rounded-full bg-white shadow-xs ring-1 ring-zinc-900/5 transition-transform duration-200 ease-in-out group-has-checked:translate-x-full dark:shadow-none' }),
    cb);
  return proxy(wrap, cb, ['checked', 'disabled', 'name', 'id']);
};

const innerControl = (node) => {
  if (!node) return null;
  if (node.control) return node.control;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) return node;
  return node.querySelector?.('input, select, textarea') || null;
};

// field({label, input, hint, error}) — label + control + hint/error, wired up for a11y.
export const field = ({ label, input: ctlNode, hint, error, class: extra } = {}) => {
  const ctl = innerControl(ctlNode);
  if (ctl && !ctl.id) ctl.id = id('f');
  const describedBy = [];
  const hintEl = hint ? h('p', { id: id('hint'), class: 'text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, hint) : null;
  const errEl = h('p', { id: id('err'), class: 'text-base/6 text-red-600 sm:text-sm/6 dark:text-red-400', hidden: !error }, error || '');
  if (hintEl) describedBy.push(hintEl.id);
  describedBy.push(errEl.id);
  if (ctl) {
    ctl.setAttribute('aria-describedby', describedBy.join(' '));
    if (error) ctl.setAttribute('aria-invalid', 'true');
  }
  const wrap = h('div', { class: cx('grid gap-y-2', extra) },
    label ? h('label', { for: ctl?.id, class: 'text-base/6 font-medium text-zinc-950 select-none sm:text-sm/6 dark:text-white' }, label) : null,
    ctlNode, hintEl, errEl);
  // Let callers update the error later: wrap.setError('msg' | null)
  wrap.setError = (msg) => {
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
    if (ctl) msg ? ctl.setAttribute('aria-invalid', 'true') : ctl.removeAttribute('aria-invalid');
  };
  return wrap;
};

// ── Layout pieces ─────────────────────────────────────────────────────────────
export const pageHeader = ({ title, description, actions } = {}) =>
  h('div', { class: 'flex flex-wrap items-end justify-between gap-4 border-b border-zinc-950/5 pb-6 dark:border-white/10' },
    h('div', { class: 'min-w-0' },
      h('h1', { class: 'text-2xl font-semibold tracking-tight text-balance text-zinc-950 dark:text-white' }, title),
      description ? h('p', { class: 'mt-1 max-w-[65ch] text-base/7 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, description) : null),
    actions && [].concat(actions).filter(Boolean).length
      ? h('div', { class: 'flex shrink-0 flex-wrap items-center gap-3' }, [].concat(actions))
      : null);

// A titled section within a page: subheading, optional description and actions, then content.
export const section = ({ title, description, actions, class: extra } = {}, ...children) =>
  h('section', { class: cx('grid gap-y-4', extra) },
    (title || actions) ? h('div', { class: 'flex flex-wrap items-end justify-between gap-3' },
      h('div', { class: 'min-w-0' },
        title ? h('h2', { class: 'text-base font-semibold text-balance text-zinc-950 sm:text-sm dark:text-white' }, title) : null,
        description ? h('p', { class: 'max-w-[65ch] text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, description) : null),
      actions ? h('div', { class: 'flex shrink-0 items-center gap-2' }, [].concat(actions)) : null) : null,
    children);

export const emptyState = ({ title, body, action } = {}) =>
  h('div', { class: 'flex flex-col items-center gap-y-3 rounded-xl border border-dashed border-zinc-950/10 px-6 py-12 text-center dark:border-white/10' },
    h('div', { class: 'grid gap-y-1' },
      h('h3', { class: 'text-base font-semibold text-balance text-zinc-950 sm:text-sm dark:text-white' }, title),
      body ? h('p', { class: 'max-w-[50ch] text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, body) : null),
    action || null);

// statGrid — sibling stats separated by a subtle top rule; columns follow the container width.
const STAT_COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 @2xs:grid-cols-2',
  3: 'grid-cols-1 @2xs:grid-cols-2 @2xl:grid-cols-3',
  4: 'grid-cols-1 @2xs:grid-cols-2 @3xl:grid-cols-4',
  5: 'grid-cols-1 @2xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-5',
  6: 'grid-cols-1 @2xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-6',
};
export const statGrid = (stats = []) =>
  h('div', { class: '@container' },
    h('dl', { class: cx('grid gap-x-8 gap-y-6', STAT_COLS[Math.min(stats.length, 6)] || STAT_COLS[4]) },
      stats.map((s) => h('div', { class: 'grid min-w-0 content-start gap-y-1 border-t border-zinc-950/10 pt-4 dark:border-white/10' },
        h('dt', { class: 'truncate text-base/6 font-medium text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, s.label),
        h('dd', { class: 'text-3xl/9 font-semibold tracking-tight text-zinc-950 tabular-nums sm:text-2xl/8 dark:text-white' }, s.value ?? '—'),
        s.sub != null ? h('dd', { class: 'truncate text-base/6 text-zinc-500 tabular-nums sm:text-sm/6 dark:text-zinc-400' }, s.sub) : null))));

// table({columns:[{key,label,align,render,class}], rows, onRow, empty}) — sits directly on the page;
// the wrapper bleeds to the page gutters (px-4 sm:px-6 lg:px-8) so it can scroll horizontally.
export const table = ({ columns = [], rows = [], onRow, empty = 'Nothing to show yet.', dense = false } = {}) => {
  const alignCls = (c) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left');
  const cellPad = dense ? 'py-2' : 'py-3';
  const body = rows.length
    ? rows.map((r) => {
      const tr = h('tr', {
        class: onRow ? 'cursor-pointer hover:bg-zinc-950/2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 dark:hover:bg-white/2.5' : null,
        tabindex: onRow ? '0' : null,
      }, columns.map((c) => {
        const v = c.render ? c.render(r) : r[c.key];
        return h('td', { class: cx('border-b border-zinc-950/5 px-3 text-base/6 text-zinc-700 first:pl-0 last:pr-0 sm:text-sm/6 dark:border-white/5 dark:text-zinc-300', cellPad, alignCls(c), c.class) }, v ?? '—');
      }));
      if (onRow) {
        tr.addEventListener('click', (e) => { if (!e.target.closest('a,button,input,select,textarea,label')) onRow(r, e); });
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) onRow(r, e); });
      }
      return tr;
    })
    : [h('tr', {}, h('td', { colspan: String(columns.length || 1), class: 'py-6 text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, empty))];
  // contain:inline-size stops wide rows from stretching a parent grid/flex track (the page would scroll sideways).
  return h('div', { class: '-mx-4 -my-2 overflow-x-auto whitespace-nowrap [contain:inline-size] sm:-mx-6 lg:-mx-8' },
    h('div', { class: 'inline-block min-w-full px-4 py-2 align-middle sm:px-6 lg:px-8' },
      h('table', { class: 'w-full' },
        h('thead', {}, h('tr', {}, columns.map((c) =>
          h('th', { scope: 'col', class: cx('relative border-b border-zinc-950/10 px-3 py-2 text-base/6 font-medium whitespace-nowrap text-zinc-500 first:pl-0 last:pr-0 sm:text-sm/6 dark:border-white/10 dark:text-zinc-400', alignCls(c)) },
            c.label ? c.label : h('span', { class: 'sr-only' }, c.key))))),
        h('tbody', {}, body))));
};

export const skeleton = (lines = 3) =>
  h('div', { class: 'grid animate-pulse gap-y-3', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: Math.max(1, lines) }, (_, i) =>
      h('div', { class: i === 0 ? 'h-4 w-1/3 rounded-sm bg-zinc-950/5 dark:bg-white/10' : i % 3 === 2 ? 'h-4 w-2/3 rounded-sm bg-zinc-950/5 dark:bg-white/10' : 'h-4 w-full rounded-sm bg-zinc-950/5 dark:bg-white/10' })));

// Description list: [[term, detail], ...]
export const descriptionList = (pairs = []) =>
  h('dl', { class: 'grid grid-cols-1 text-base/6 sm:grid-cols-[minmax(--spacing(40),auto)_1fr] sm:text-sm/6' },
    pairs.filter(Boolean).map(([t, d]) => [
      h('dt', { class: 'border-t border-zinc-950/5 pt-3 font-medium text-zinc-950 first:border-none sm:py-3 dark:border-white/5 dark:text-white' }, t),
      h('dd', { class: 'min-w-0 pt-1 pb-3 text-zinc-500 sm:border-t sm:border-zinc-950/5 sm:py-3 sm:nth-2:border-none dark:text-zinc-400 sm:dark:border-white/5' }, d ?? '—'),
    ]));

// ── Overlays: dialogs, sheets, toasts ─────────────────────────────────────────
const overlayRoot = () => document.getElementById('overlays') || document.body;
const appRoot = () => document.getElementById('app');
let openCount = 0;
const lockApp = () => { if (openCount++ === 0) { const a = appRoot(); if (a) a.inert = true; document.documentElement.classList.add('overflow-hidden'); } };
const unlockApp = () => { if (--openCount <= 0) { openCount = 0; const a = appRoot(); if (a) a.inert = false; document.documentElement.classList.remove('overflow-hidden'); } };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared overlay mechanics: inert app, Escape to close, focus trap, focus restore.
const openLayer = (layer, panel, onClose) => {
  const prev = document.activeElement;
  lockApp();
  overlayRoot().append(layer);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    unlockApp();
    if (prev && document.contains(prev)) prev.focus?.();
    onClose?.();
  };
  const onKey = (e) => {
    if (!layer.isConnected || layer !== overlayRoot().lastElementChild) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') {
      const f = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!f.length) { e.preventDefault(); panel.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => {
    const target = panel.querySelector('[autofocus]') || panel.querySelector('input:not([type=hidden]), select, textarea') || panel.querySelector(FOCUSABLE) || panel;
    target.focus?.();
  });
  return close;
};

// dialog({title, description, body, actions, onClose}) → {close, panel}
// body: a Node, or a function ({close}) → Node. actions: Nodes, or specs
// {label, variant, onClick({close})} rendered as buttons (right-aligned, primary last).
export const dialog = ({ title, description, body, actions = [], onClose, size = 'md' } = {}) => {
  const titleId = id('dlg');
  const panel = h('div', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1',
    class: cx('relative w-full animate-pop rounded-2xl bg-white p-6 shadow-lg ring-1 ring-zinc-950/10 focus:outline-hidden dark:bg-zinc-900 dark:shadow-none dark:ring-white/10', size === 'lg' ? 'sm:max-w-xl' : 'sm:max-w-md'),
  });
  const layer = h('div', { class: 'fixed inset-0 z-40 flex items-end justify-center overflow-y-auto p-4 sm:items-center sm:p-6' },
    h('div', { class: 'fixed inset-0 bg-zinc-950/25 dark:bg-zinc-950/60', 'aria-hidden': 'true', 'on:click': () => close() }),
    panel);
  let close = () => {};
  const ctrl = { close: () => close(), panel };
  const bodyNode = typeof body === 'function' ? body(ctrl) : body;
  const actionNodes = [].concat(actions).filter(Boolean).map((a) => (a instanceof Node ? a : button({ ...a, onClick: (e) => a.onClick ? a.onClick({ close: ctrl.close, event: e }) : ctrl.close() })));
  mount(panel,
    h('h2', { id: titleId, class: 'text-lg font-semibold text-balance text-zinc-950 sm:text-base dark:text-white' }, title),
    description ? h('p', { class: 'mt-2 text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, description) : null,
    bodyNode ? h('div', { class: 'mt-4' }, bodyNode) : null,
    actionNodes.length ? h('div', { class: 'mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end' }, actionNodes) : null);
  close = openLayer(layer, panel, onClose);
  return ctrl;
};

// confirmDialog({title, body, confirmLabel, cancelLabel, danger}) → Promise<boolean>
export const confirmDialog = ({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) =>
  new Promise((resolve) => {
    let result = false;
    const ok = button({ label: confirmLabel, variant: danger ? 'danger-solid' : 'primary', autofocus: !danger ? true : null, onClick: () => { result = true; d.close(); } });
    const cancel = button({ label: cancelLabel, variant: 'secondary', autofocus: danger ? true : null, onClick: () => d.close() });
    const d = dialog({
      title,
      body: body == null ? null : body instanceof Node ? body : h('p', { class: 'text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, body),
      actions: [cancel, ok],
      onClose: () => resolve(result),
    });
  });

// sheet({label, body}) — a full-height panel from the left (mobile navigation).
export const sheet = ({ label = 'Menu', body } = {}) => {
  const panel = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1', class: 'relative flex h-full w-full max-w-80 flex-col overflow-y-auto bg-white shadow-lg ring-1 ring-zinc-950/10 focus:outline-hidden dark:bg-zinc-900 dark:shadow-none dark:ring-white/10' });
  const layer = h('div', { class: 'fixed inset-0 z-40 flex p-2 lg:hidden' },
    h('div', { class: 'fixed inset-0 bg-zinc-950/25 dark:bg-zinc-950/60', 'aria-hidden': 'true', 'on:click': () => close() }),
    panel);
  let close = () => {};
  const ctrl = { close: () => close(), panel };
  mount(panel, typeof body === 'function' ? body(ctrl) : body);
  panel.firstElementChild?.classList.add('rounded-lg');
  close = openLayer(layer, panel);
  return ctrl;
};

// toast(msg, {tone:'ok'|'error', timeout}) — announced via the aria-live #toasts region.
export const toast = (msg, { tone = 'ok', timeout } = {}) => {
  const root = document.getElementById('toasts') || document.body;
  const isErr = tone === 'error';
  const el = h('div', {
    role: isErr ? 'alert' : 'status',
    class: 'pointer-events-auto flex w-full max-w-sm animate-enter items-start gap-x-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-800 dark:shadow-none dark:ring-white/10',
  },
    h('div', { class: 'flex h-lh shrink-0 items-center text-base/6 sm:text-sm/6' },
      iconEl(isErr ? 'exclamation-circle' : 'check-circle', isErr ? 'size-4 shrink-0 fill-red-500' : 'size-4 shrink-0 fill-brand-600 dark:fill-brand-500')),
    h('p', { class: 'min-w-0 flex-1 text-base/6 text-pretty text-zinc-950 sm:text-sm/6 dark:text-white' }, msg),
    button({ icon: 'x-mark', variant: 'ghost', size: 'sm', 'aria-label': 'Dismiss', class: '-m-1', onClick: () => el.remove() }));
  root.append(el);
  setTimeout(() => el.remove(), timeout ?? (isErr ? 8000 : 4000));
  return el;
};

// Standard error rendering for a failed API call inside a view.
export const errorState = (err, retry) => emptyState({
  title: 'This page could not load',
  body: `${err?.message || 'Something went wrong.'}${err?.ref ? ` Reference: ${err.ref}.` : ''}`,
  action: retry ? button({ label: 'Try again', icon: 'arrow-path', onClick: retry }) : null,
});

// Copy text to clipboard with a toast.
export const copyText = async (text, label = 'Copied to clipboard.') => {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast('Could not copy. Select the text and copy it manually.', { tone: 'error' }); }
};
