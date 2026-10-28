// Puzzle library (#/puzzles) and the single-puzzle editor (#/puzzles/new, #/puzzles/:id).
// Nods are not edited here: they attach to scheduled days.
import { api } from '../api.mjs';
import { current } from '../router.mjs';
import { h, mount, pageHeader, button, badge, input, select, statGrid, table, emptyState, iconEl, toast, busy, confirmDialog, fmt } from '../ui.mjs';
import { holeEditor } from '../editor/hole-editor.mjs';

const STATUS = {
  approved: { label: 'Approved', tone: 'brand' },
  draft: { label: 'Draft', tone: 'amber' },
  reserve: { label: 'Reserve', tone: 'blue' },
  archived: { label: 'Archived', tone: 'neutral' },
};
const statusBadge = (s) => { const x = STATUS[s] || { label: s || 'Unknown', tone: 'neutral' }; return badge({ label: x.label, tone: x.tone }); };

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'draft', label: 'Drafts' },
  { key: 'reserve', label: 'Reserve' },
  { key: 'archived', label: 'Archived' },
];
const PAGE = 100;

const toHash = (path, query) => {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '' && v !== 'all'));
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ''}`;
};

// ── Runway ───────────────────────────────────────────────────────────────────
const runwayStats = (runway = {}) => {
  const by = runway.byLength || {};
  const weeks = runway.fiveWordWeeks;
  const low = weeks != null && weeks < 3;
  return statGrid([
    { label: '3-word chains', value: fmt.num(by[3] ?? 0), sub: 'Ready to schedule' },
    { label: '4-word chains', value: fmt.num(by[4] ?? 0), sub: 'Ready to schedule' },
    { label: '5-word chains', value: fmt.num(by[5] ?? 0), sub: 'Ready to schedule' },
    {
      label: 'Weeks of 5-word supply',
      value: h('span', { class: low ? 'text-amber-700 dark:text-amber-400' : null }, weeks == null ? '—' : weeks.toFixed(1)),
      sub: low ? 'Below 3 weeks. Approve more.' : 'A week uses 21.',
    },
  ]);
};

// ── Library ──────────────────────────────────────────────────────────────────
async function library({ query, navigate, canEdit }) {
  const data = await api('puzzles');
  const items = data.items || [];
  const state = {
    tab: TABS.some((t) => t.key === query.status) ? query.status : 'all',
    len: ['3', '4', '5'].includes(query.len) ? query.len : '',
    q: String(query.q || ''),
    shown: PAGE,
  };

  const persist = () => { try { history.replaceState(null, '', toHash('/puzzles', { status: state.tab, len: state.len, q: state.q.trim() })); } catch { /* */ } };

  const counts = () => {
    const base = items.filter(matchesText);
    const c = { all: base.length };
    for (const t of TABS) if (t.key !== 'all') c[t.key] = base.filter((i) => i.status === t.key).length;
    return c;
  };
  function matchesText(it) {
    if (state.len && it.words.length !== Number(state.len)) return false;
    const q = state.q.trim().toUpperCase().replace(/[^A-Z ]/g, '');
    if (!q) return true;
    return it.seed.includes(q) || it.words.join(' ').includes(q) || (it.createdBy || '').toUpperCase().includes(q);
  }
  const visible = () => items.filter((it) => matchesText(it) && (state.tab === 'all' || it.status === state.tab));

  // Toolbar
  const tabsEl = h('div', { class: 'flex gap-x-6 border-b border-zinc-950/10 whitespace-nowrap dark:border-white/10', role: 'group', 'aria-label': 'Filter by status' });
  const paintTabs = () => {
    const c = counts();
    mount(tabsEl, TABS.map((t) => h('button', {
      type: 'button', 'aria-pressed': String(state.tab === t.key),
      class: '-mb-px flex shrink-0 items-center gap-x-2 border-b-2 border-transparent py-2.5 text-base/6 font-medium text-zinc-500 hover:border-zinc-950/20 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-pressed:border-brand-600 aria-pressed:text-zinc-950 sm:text-sm/6 dark:text-zinc-400 dark:hover:border-white/20 dark:hover:text-zinc-200 dark:aria-pressed:border-brand-500 dark:aria-pressed:text-white',
      'on:click': () => { state.tab = t.key; state.shown = PAGE; paint(); },
    }, t.label, h('span', { class: 'text-zinc-400 tabular-nums dark:text-zinc-500' }, fmt.num(c[t.key] || 0)))));
  };

  const search = input({ name: 'puzzle-search', type: 'search', value: state.q, placeholder: 'Search seeds or words', 'aria-label': 'Search puzzles', autocomplete: 'off', class: 'pr-3 pl-9 sm:pl-8' });
  const searchWrap = h('div', { class: 'grid min-w-0 flex-1 grid-cols-1 sm:max-w-xs' },
    h('div', { class: 'col-start-1 row-start-1' }, search),
    h('div', { class: 'pointer-events-none col-start-1 row-start-1 flex items-center pl-3 sm:pl-2.5' }, iconEl('magnifying-glass', 'size-4 shrink-0 fill-zinc-400 dark:fill-zinc-500')));
  search.addEventListener('input', () => { state.q = search.value; state.shown = PAGE; paint(); });

  const lenSel = select({ name: 'puzzle-length', value: state.len, 'aria-label': 'Filter by length' }, [
    { value: '', label: 'All lengths' }, { value: '3', label: '3 words' }, { value: '4', label: '4 words' }, { value: '5', label: '5 words' },
  ]);
  lenSel.control.addEventListener('change', () => { state.len = lenSel.value; state.shown = PAGE; paint(); });

  const open = (it) => {
    if (it.id != null) return navigate(`/puzzles/${it.id}`);
    navigate(`/puzzles/new?seed=${encodeURIComponent(it.seed)}&words=${encodeURIComponent(it.words.join(','))}&from=reserve`);
  };

  const columns = [
    { key: 'seed', label: 'Seed', render: (r) => h('span', { class: 'font-mono font-semibold tracking-wider text-zinc-950 dark:text-white' }, r.seed) },
    { key: 'chain', label: 'Chain', render: (r) => h('span', { class: 'font-mono text-zinc-700 dark:text-zinc-300' }, r.words.join(' · ')) },
    { key: 'length', label: 'Length', render: (r) => h('span', { class: 'tabular-nums' }, `${r.words.length} words`) },
    { key: 'status', label: 'Status', render: (r) => statusBadge(r.status) },
    { key: 'updated', label: 'Updated', render: (r) => (r.updatedAt ? h('time', { datetime: r.updatedAt, title: fmt.dateTime(r.updatedAt) }, fmt.rel(r.updatedAt)) : '—') },
    { key: 'author', label: 'Author', render: (r) => r.createdBy || (r.status === 'reserve' ? 'Built-in' : '—') },
  ];

  const tableWrap = h('div', { class: 'grid gap-y-4' });
  const paintTable = () => {
    const rows = visible();
    if (!items.length) {
      mount(tableWrap, emptyState({
        title: 'No puzzles yet', body: 'Write a chain to start the pool. Approved chains fill auto days when you publish.',
        action: canEdit ? button({ label: 'New puzzle', icon: 'plus', href: '#/puzzles/new' }) : null,
      }));
      return;
    }
    if (!rows.length) {
      mount(tableWrap, emptyState({
        title: 'No matches', body: 'Nothing matches these filters.',
        action: button({ label: 'Clear filters', onClick: () => { state.tab = 'all'; state.len = ''; state.q = ''; search.value = ''; lenSel.value = ''; paint(); } }),
      }));
      return;
    }
    mount(tableWrap,
      table({ columns, rows: rows.slice(0, state.shown), onRow: open }),
      rows.length > state.shown
        ? h('div', { class: 'flex items-center justify-between gap-x-4' },
          h('p', { class: 'text-base/6 text-zinc-500 tabular-nums sm:text-sm/6 dark:text-zinc-400' }, `Showing ${fmt.num(state.shown)} of ${fmt.num(rows.length)}.`),
          button({ label: 'Show more', size: 'sm', onClick: () => { state.shown += PAGE; paintTable(); } }))
        : h('p', { class: 'text-base/6 text-zinc-500 tabular-nums sm:text-sm/6 dark:text-zinc-400' }, `${fmt.num(rows.length)} ${rows.length === 1 ? 'chain' : 'chains'}.`));
  };

  const paint = () => { persist(); paintTabs(); paintTable(); };
  paint();

  return h('div', { class: 'grid gap-y-10' },
    pageHeader({
      title: 'Puzzles',
      description: 'Every chain in the pool. Approved chains and the reserve fill auto days on the next publish.',
      actions: canEdit ? button({ label: 'New puzzle', icon: 'plus', variant: 'primary', href: '#/puzzles/new' }) : null,
    }),
    h('section', { class: 'grid gap-y-4', 'aria-label': 'Runway' }, runwayStats(data.runway)),
    h('section', { class: 'grid gap-y-6', 'aria-label': 'Library' },
      h('div', { class: '-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0' }, tabsEl),
      h('div', { class: 'flex flex-wrap items-center gap-3' },
        searchWrap,
        h('div', { class: 'w-40 shrink-0' }, lenSel)),
      tableWrap));
}

// ── Editor ───────────────────────────────────────────────────────────────────
async function editor({ id, query, navigate, canEdit }) {
  let item = null;
  if (id != null) {
    const data = await api('puzzles');
    item = (data.items || []).find((i) => i.id === id) || null;
    if (!item) {
      return emptyState({ title: 'Puzzle not found', body: 'It may have been removed, or the address is wrong.', action: button({ label: 'All puzzles', icon: 'chevron-left', href: '#/puzzles' }) });
    }
  }
  const fromReserve = !item && query.from === 'reserve';
  const hole = item
    ? { seed: item.seed, words: item.words }
    : { seed: String(query.seed || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5), words: String(query.words || '').split(',').map((w) => w.trim().toUpperCase()).filter(Boolean) };
  const status = item?.status || 'new';

  const errorMsg = h('p', { class: 'min-w-0 flex-1 text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' });
  let buttons = [];
  const ed = holeEditor({
    hole, showNod: false, poolCheck: true, puzzleId: id, disabled: !canEdit,
    onChange: () => paintActions(),
  });
  const orig = JSON.stringify({ seed: hole.seed, words: hole.words });
  const isDirty = () => JSON.stringify({ seed: ed.value().seed, words: ed.value().words }) !== orig;

  const save = (nextStatus, btn) => busy(btn, async () => {
    const v = ed.value();
    try {
      const res = await api('puzzle_save', { ...(id != null ? { id } : {}), seed: v.seed, words: v.words, status: nextStatus });
      toast(nextStatus === 'approved' ? `${v.seed} is approved and ready to schedule.` : `${v.seed} saved as a draft.`);
      navigate(`/puzzles/${res.id}`, { replace: id == null });
    } catch (err) {
      toast(err.ref ? `${err.message} Reference: ${err.ref}.` : err.message, { tone: 'error' });
    }
  });

  if (canEdit) {
    const draftBtn = button({ label: status === 'approved' ? 'Move to drafts' : 'Save as draft', variant: 'secondary' });
    const approveBtn = button({ label: status === 'approved' ? 'Save' : 'Approve', icon: 'check', variant: 'primary' });
    draftBtn.addEventListener('click', () => save('draft', draftBtn));
    approveBtn.addEventListener('click', () => save('approved', approveBtn));
    buttons = [draftBtn, approveBtn];
  }
  const archiveBtn = canEdit && item && status !== 'archived'
    ? button({
      label: 'Archive', icon: 'archive-box', variant: 'danger',
      onClick: async (e) => {
        const btn = e.currentTarget;
        const ok = await confirmDialog({ title: `Archive ${item.seed}?`, body: 'Archived chains leave the pool and never fill an auto day. You can restore it later by saving it again.', confirmLabel: 'Archive', danger: true });
        if (!ok) return;
        await busy(btn, async () => {
          try { await api('puzzle_archive', { id }); toast(`${item.seed} archived.`); navigate('/puzzles'); }
          catch (err) { toast(err.message, { tone: 'error' }); }
        });
      },
    })
    : null;

  function paintActions() {
    if (!buttons.length) return;
    const errs = ed.errors();
    const blocked = errs.length > 0;
    // An approved puzzle with no edits needs no "Save"; everything else may save as-is.
    buttons.forEach((b) => { b.disabled = blocked; });
    if (status === 'approved' && !isDirty()) buttons[1].disabled = true;
    errorMsg.className = `min-w-0 flex-1 text-base/6 sm:text-sm/6 ${blocked && isDirty() ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`;
    errorMsg.textContent = blocked
      ? (isDirty() || id != null ? `${errs.length} ${errs.length === 1 ? 'problem' : 'problems'} to fix before saving.` : 'Type a seed and its words to get started.')
      : status === 'approved' ? (isDirty() ? 'Unsaved changes.' : 'Approved and in the pool.') : 'Ready to save.';
  }
  paintActions();

  const meta = item
    ? [statusBadge(item.status), h('span', {}, item.createdBy ? `by ${item.createdBy}` : 'Author unknown'), item.updatedAt ? h('span', {}, `updated ${fmt.rel(item.updatedAt).toLowerCase()}`) : null]
    : [badge({ label: 'New', tone: 'neutral' })];

  const notes = [];
  if (fromReserve) notes.push('This copies a chain from the built-in reserve, which already counts toward the runway. Change it to save a new variant.');
  if (status === 'archived') notes.push('This chain is archived. Saving it as a draft or approving it puts it back in the pool.');
  if (!canEdit) notes.push('You have view access. Ask an editor or the owner to change puzzles.');

  const node = h('div', { class: 'grid gap-y-10' },
    h('div', { class: 'grid gap-y-4' },
      h('div', {}, button({ label: 'All puzzles', icon: 'chevron-left', variant: 'ghost', size: 'sm', class: '-ml-2', href: '#/puzzles' })),
      pageHeader({
        title: item ? `Puzzle ${item.seed}` : 'New puzzle',
        description: item ? null : 'Type a seed, then one word per letter. Each word must pair with the next as a familiar phrase.',
        actions: archiveBtn,
      })),
    item ? h('div', { class: 'flex flex-wrap items-center gap-x-3 gap-y-2 text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, meta) : null,
    notes.length ? h('div', { class: 'grid gap-y-2' }, notes.map((n) => h('p', { class: 'flex items-start gap-x-2 text-base/6 text-pretty text-zinc-600 sm:text-sm/6 dark:text-zinc-300' },
      h('span', { class: 'flex h-lh shrink-0 items-center' }, iconEl('information-circle', 'size-4 shrink-0 fill-zinc-400 dark:fill-zinc-500')), h('span', { class: 'min-w-0' }, n)))) : null,
    ed.el,
    h('p', { class: 'text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' },
      'Nods attach to scheduled days, not to puzzles. Add one from the day page once this chain is on the calendar.'),
    buttons.length
      ? h('div', { class: 'flex flex-col gap-4 border-t border-zinc-950/10 pt-6 sm:flex-row sm:items-center dark:border-white/10' },
        errorMsg,
        h('div', { class: 'flex flex-col-reverse gap-3 sm:flex-row' }, buttons))
      : null);

  requestAnimationFrame(() => { if (canEdit && id == null) ed.focus(); });
  return node;
}

export default async function view(ctx) {
  const path = current().path;
  if (path === '/puzzles/new') return editor({ id: null, query: ctx.query || {}, navigate: ctx.navigate, canEdit: ctx.canEdit });
  if (ctx.params?.id != null) {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) return emptyState({ title: 'Puzzle not found', body: 'That address does not point to a puzzle.', action: button({ label: 'All puzzles', icon: 'chevron-left', href: '#/puzzles' }) });
    return editor({ id, query: ctx.query || {}, navigate: ctx.navigate, canEdit: ctx.canEdit });
  }
  return library(ctx);
}
