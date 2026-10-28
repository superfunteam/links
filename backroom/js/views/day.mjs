// Day editor (#/day/:date): course name, five holes, live checks against the
// neighbouring schedule, per-hole stats, and nods. Live and past days keep their
// words locked; their nods still save one hole at a time.
import { api } from '../api.mjs';
import { h, mount, pageHeader, button, badge, field, input, statGrid, emptyState, iconEl, toast, busy, confirmDialog, fmt } from '../ui.mjs';
import { checkDay, par as parOf, HOLES_PER_DAY } from '../validate.mjs';
import { holeEditor, debounce } from '../editor/hole-editor.mjs';

const STATUS = {
  live: { label: 'Live today', tone: 'brand' },
  past: { label: 'Played', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  auto: { label: 'Auto', tone: 'neutral' },
};

const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const signed = (n, digits = 1) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// A callout: soft tinted panel with a leading icon, title and body.
const TONES = {
  info: { wrap: 'bg-zinc-950/2.5 ring-zinc-950/5 dark:bg-white/2.5 dark:ring-white/10', icon: 'information-circle', fill: 'size-4 shrink-0 fill-zinc-500 dark:fill-zinc-400', title: 'text-zinc-950 dark:text-white' },
  amber: { wrap: 'bg-amber-50 ring-amber-600/15 dark:bg-amber-400/10 dark:ring-amber-400/20', icon: 'exclamation-triangle', fill: 'size-4 shrink-0 fill-amber-500 dark:fill-amber-400', title: 'text-amber-900 dark:text-amber-200' },
  red: { wrap: 'bg-red-50 ring-red-600/15 dark:bg-red-500/10 dark:ring-red-400/20', icon: 'x-circle', fill: 'size-4 shrink-0 fill-red-500 dark:fill-red-400', title: 'text-red-900 dark:text-red-200' },
};
const callout = (tone, title, body) => {
  const t = TONES[tone] || TONES.info;
  return h('div', { class: `flex items-start gap-x-3 rounded-xl p-4 ring-1 ring-inset ${t.wrap}` },
    h('div', { class: 'flex h-lh shrink-0 items-center text-base/6 sm:text-sm/6' }, iconEl(t.icon, t.fill)),
    h('div', { class: 'grid min-w-0 flex-1 gap-y-1' },
      h('p', { class: `text-base/6 font-medium sm:text-sm/6 ${t.title}` }, title),
      body ? (body instanceof Node ? body : h('p', { class: 'text-base/6 text-pretty text-zinc-600 sm:text-sm/6 dark:text-zinc-300' }, body)) : null));
};

export default async function view({ params, navigate, canEdit }) {
  const date = String(params.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return emptyState({ title: 'That is not a date', body: 'Day addresses look like #/day/2026-10-28.', action: button({ label: 'Open the calendar', href: '#/calendar' }) });
  }
  const d = await api('day', { date });
  const status = d.status;
  const editable = !!d.editable && canEdit;      // can change words + name
  const nodsEditable = canEdit;                  // nods save on any date
  const stats = d.stats || {};
  const plays = stats.plays || 0;

  const origHoles = d.holes && d.holes.length
    ? d.holes
    : (d.editable ? Array.from({ length: HOLES_PER_DAY }, () => ({ seed: '', words: [] })) : []);
  const origName = d.name || '';
  const origChain = { name: origName, holes: origHoles.map((x) => ({ seed: x.seed || '', words: (x.words || []).map((w) => String(w).toUpperCase()) })) };
  const origNods = origHoles.map((x) => x.nod || null);

  let dirtyGuard = null;
  const root = h('div', { class: 'grid gap-y-10' });

  // ── header ─────────────────────────────────────────────────────────────────
  const go = async (path) => {
    if (dirty() && !(await confirmDialog({ title: 'Leave without saving?', body: 'Your changes to this day will be lost.', confirmLabel: 'Leave', danger: true }))) return;
    navigate(path);
  };
  const st = STATUS[status] || { label: status || 'Unknown', tone: 'neutral' };
  const header = pageHeader({
    title: fmt.date(date),
    description: status === 'auto'
      ? 'Nothing is scheduled for this day yet.'
      : `${d.name || 'Untitled course'} · ${origHoles.length} holes${plays ? ` · ${fmt.num(plays)} ${plays === 1 ? 'round' : 'rounds'} played` : ''}.`,
    actions: [
      badge({ label: st.label, tone: st.tone }),
      h('div', { class: 'flex items-center gap-x-1' },
        button({ icon: 'chevron-left', variant: 'ghost', 'aria-label': 'Previous day', title: 'Previous day', onClick: () => go(`/day/${addDays(date, -1)}`) }),
        button({ label: 'Calendar', variant: 'ghost', onClick: () => go(`/calendar/${date.slice(0, 7)}`) }),
        button({ icon: 'chevron-right', variant: 'ghost', 'aria-label': 'Next day', title: 'Next day', onClick: () => go(`/day/${addDays(date, 1)}`) })),
    ],
  });

  // ── explanations ───────────────────────────────────────────────────────────
  const notes = [];
  if (status === 'live' || status === 'past') {
    notes.push(callout('info', status === 'live' ? 'This course is live, so its words are locked' : 'This course has been played, so its words are locked',
      `Changing a word now would split players’ scores between two different puzzles. ${nodsEditable ? 'Nods can still change: each hole’s nod saves on its own.' : ''}`.trim()));
  } else if (status === 'auto') {
    notes.push(callout('info', 'This day fills itself on the next publish',
      canEdit
        ? 'If you leave it empty, the next publish picks five holes from the approved pool and the reserve. To choose them yourself, fill in all five holes and save. Nods can be added once the course is saved.'
        : 'The next publish picks five holes from the approved pool and the reserve.'));
  } else if (!canEdit) {
    notes.push(callout('info', 'You have view access', 'Ask an editor or the owner to make changes to this day.'));
  }

  if (!origHoles.length) {
    mount(root, header, notes, emptyState({ title: 'No course on record', body: 'There is no saved course for this day.' }));
    return root;
  }

  // ── course name ────────────────────────────────────────────────────────────
  const nameIn = input({ name: 'course-name', value: origName, maxlength: '40', disabled: !editable, placeholder: 'Chain Reaction', autocomplete: 'off' });
  const nameField = field({ label: 'Course name', input: nameIn, hint: ' ' });
  const nameHint = nameField.querySelector('[id^="hint"]');
  const paintName = () => { nameHint.textContent = `Shown at the top of the scorecard. ${nameIn.value.trim().length} of 40 characters.`; };
  paintName();

  // ── overall stats ──────────────────────────────────────────────────────────
  const statsBlock = plays > 0 ? statGrid([
    { label: 'Rounds played', value: fmt.num(plays) },
    { label: 'Average vs par', value: signed(stats.avgVsPar, 2), sub: 'Per round, all five holes' },
    { label: 'Holes with a nod', value: `${origNods.filter(Boolean).length} of ${origHoles.length}` },
  ]) : null;

  // ── issues panel ───────────────────────────────────────────────────────────
  const issuesEl = h('div', { class: 'grid gap-y-3 empty:hidden', 'aria-live': 'polite' });
  let server = { errors: [], warnings: [] };
  let checking = false;
  let checkSeq = 0;
  let everTyped = !!(d.holes && d.holes.length);

  const holeSections = [];
  const scrollToHole = (i) => {
    const s = holeSections[i]; if (!s) return;
    s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => editors[i]?.focus(), 350);
  };
  const issueList = (items) => h('ul', { role: 'list', class: 'grid gap-y-1' },
    items.map((it) => h('li', { class: 'flex items-baseline gap-x-2 text-base/6 text-zinc-700 sm:text-sm/6 dark:text-zinc-300' },
      it.hole != null
        ? h('button', { type: 'button', class: 'shrink-0 font-medium text-zinc-950 underline decoration-zinc-950/20 underline-offset-2 hover:decoration-zinc-950/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-white dark:decoration-white/30 dark:hover:decoration-white/70', 'on:click': () => scrollToHole(it.hole) }, `Hole ${it.hole + 1}`)
        : h('span', { class: 'shrink-0 font-medium text-zinc-950 dark:text-white' }, 'Day'),
      h('span', { class: 'min-w-0' }, it.msg))));

  const paintIssues = () => {
    if (!editable || !everTyped) { mount(issuesEl); return; }
    const errs = server.errors || [];
    const warns = server.warnings || [];
    mount(issuesEl,
      errs.length ? callout('red', `${errs.length} ${errs.length === 1 ? 'problem blocks' : 'problems block'} saving`, issueList(errs)) : null,
      warns.length ? callout('amber', `${warns.length} ${warns.length === 1 ? 'thing' : 'things'} to double-check`,
        h('div', { class: 'grid gap-y-2' }, issueList(warns),
          h('p', { class: 'text-base/6 text-pretty text-zinc-600 sm:text-sm/6 dark:text-zinc-300' }, 'Warnings do not block saving. Regular players may notice repeats.'))) : null);
  };

  // ── holes ──────────────────────────────────────────────────────────────────
  const editors = [];
  const nodButtons = [];
  const changed = () => {
    everTyped = true;
    paintName();
    paintFooter();
    paintNodButtons();
    if (editable) runCheck();
  };
  nameIn.addEventListener('input', changed);

  origHoles.forEach((hole, i) => {
    const ed = holeEditor({
      // nods attach by hole index, so an auto day (holes not chosen yet) gets none until its course is saved
      hole, index: i, showNod: status !== 'auto',
      readOnlyWords: !editable, disabled: !nodsEditable,
      onChange: changed,
    });
    editors.push(ed);
    const p = parOf((hole.words || []).length || (hole.seed || '').length);
    const ph = (stats.perHole || [])[i];
    const statLine = plays > 0 && ph && ph.avg != null
      ? h('p', { class: 'text-base/6 text-zinc-500 tabular-nums sm:text-sm/6 dark:text-zinc-400' },
        `Average ${ph.avg.toFixed(1)} strokes (${signed(ph.avg - p)} vs par ${p}) · worst ${fmt.num(ph.worst)}`)
      : null;

    // Live/past days: each nod saves on its own.
    if (!editable && nodsEditable) {
      const saveNod = button({ label: 'Save nod', variant: 'secondary', size: 'sm', disabled: true });
      const note = h('p', { class: 'text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' });
      saveNod.addEventListener('click', async () => { await busy(saveNod, async () => {
        const nod = ed.value().nod;
        try {
          await api('nod_save', { date, hole: i, nod });
          origNods[i] = nod;
          toast(nod ? `Nod saved for hole ${i + 1}.` : `Nod removed from hole ${i + 1}.`);
        } catch (err) { toast(err.message, { tone: 'error' }); }
      }); paintNodButtons(); });
      nodButtons[i] = { btn: saveNod, note };
      mount(ed.nodSlot, saveNod, note);
    }

    const sec = h('section', { class: 'grid scroll-mt-24 gap-y-6 border-t border-zinc-950/10 pt-8 dark:border-white/10', 'aria-label': `Hole ${i + 1}` },
      h('div', { class: 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1' },
        h('h2', { class: 'text-lg font-semibold text-balance text-zinc-950 sm:text-base dark:text-white' }, `Hole ${i + 1}`),
        statLine),
      ed.el);
    holeSections.push(sec);
  });

  const paintNodButtons = () => {
    nodButtons.forEach((nb, i) => {
      if (!nb) return;
      const v = editors[i].value().nod;
      const errs = editors[i].nodErrors();
      const changedNod = !same(v, origNods[i]);
      nb.btn.disabled = !changedNod || errs.length > 0;
      nb.btn.querySelector('span.truncate').textContent = v == null && origNods[i] ? 'Save removal' : 'Save nod';
      nb.note.textContent = !changedNod ? '' : errs.length ? 'Fix the nod to save it.' : 'Unsaved changes.';
    });
  };

  // ── dirty tracking ─────────────────────────────────────────────────────────
  const chainNow = () => ({ name: nameIn.value.trim(), holes: editors.map((e) => { const v = e.value(); return { seed: v.seed, words: v.words }; }) });
  const chainDirty = () => editable && !same(chainNow(), { ...origChain, name: origChain.name.trim() });
  const nodsDirtyIdx = () => editors.map((e, i) => (!same(e.value().nod, origNods[i]) ? i : -1)).filter((i) => i >= 0);
  const dirty = () => chainDirty() || nodsDirtyIdx().length > 0;

  // ── server check ───────────────────────────────────────────────────────────
  const runCheckNow = async () => {
    const seq = ++checkSeq;
    checking = true; paintFooter();
    try {
      const res = await api('day_check', { date, name: nameIn.value.trim(), holes: chainNow().holes });
      if (seq !== checkSeq) return;
      server = { errors: res.errors || [], warnings: res.warnings || [] };
    } catch (err) {
      if (seq !== checkSeq) return;
      server = { errors: [], warnings: [], failed: err.message };
    }
    checking = false;
    paintIssues(); paintFooter();
  };
  const runCheck = debounce(runCheckNow, 600);

  // ── footer (sticky save bar) ───────────────────────────────────────────────
  const footerMsg = h('p', { class: 'min-w-0 flex-1 truncate text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' });
  const showBtn = button({
    label: 'Show me', variant: 'ghost', size: 'sm', hidden: true,
    onClick: () => {
      editors.forEach((e) => e.revealErrors());
      const first = blockers().find((b) => b.hole != null);
      if (first) scrollToHole(first.hole); else nameIn.focus();
    },
  });
  const saveBtn = button({ label: 'Save day', variant: 'primary', icon: 'check' });
  const footer = editable ? h('div', { class: 'sticky bottom-0 z-10 -mx-4 flex items-center gap-x-4 border-t border-zinc-950/5 bg-white/90 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-white/10 dark:bg-zinc-950/90' }, footerMsg, showBtn, saveBtn) : null;

  const blockers = () => {
    const chainChanged = chainDirty();
    const nodErrs = editors.flatMap((e, i) => e.nodErrors().map((x) => ({ hole: i, ...x })));
    if (!chainChanged) return nodErrs;
    const local = checkDay(chainNow().holes).errors;
    const nameErr = nameIn.value.trim() ? [] : [{ hole: null, msg: 'Give the course a name.' }];
    return [...nameErr, ...local, ...(server.errors || []), ...nodErrs];
  };

  const paintFooter = () => {
    if (!footer) return;
    const b = blockers();
    const isDirty = dirty();
    saveBtn.disabled = !isDirty || b.length > 0 || (checking && chainDirty());
    showBtn.hidden = !(isDirty && b.length);
    footerMsg.className = `min-w-0 flex-1 truncate text-base/6 sm:text-sm/6 ${b.length && isDirty ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`;
    footerMsg.textContent = !isDirty ? 'No unsaved changes.'
      : b.length ? `${b.length} ${b.length === 1 ? 'problem' : 'problems'} to fix before saving.`
        : checking && chainDirty() ? 'Checking against nearby days…'
          : server.failed ? 'Could not check nearby days. Saving will check again.'
            : (server.warnings || []).length ? `Ready to save, with ${server.warnings.length} ${server.warnings.length === 1 ? 'warning' : 'warnings'}.`
              : 'Ready to save.';
    if (isDirty && !dirtyGuard) { dirtyGuard = (e) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', dirtyGuard); }
    if (!isDirty && dirtyGuard) { window.removeEventListener('beforeunload', dirtyGuard); dirtyGuard = null; }
  };

  saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
    const holes = editors.map((e) => { const v = e.value(); const o = { seed: v.seed, words: v.words }; if (v.alts) o.alts = v.alts; return o; });
    try {
      let warnings = [];
      const savedChain = chainDirty();
      if (savedChain) {
        const res = await api('day_save', { date, name: nameIn.value.trim(), holes });
        warnings = res.warnings || [];
      }
      for (const i of nodsDirtyIdx()) await api('nod_save', { date, hole: i, nod: editors[i].value().nod });
      if (dirtyGuard) { window.removeEventListener('beforeunload', dirtyGuard); dirtyGuard = null; }
      toast(!savedChain ? 'Nods saved. Players see them when this day plays.'
        : warnings.length ? `Day saved, with ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}. It goes live on the next publish.`
          : 'Day saved. It goes live on the next publish.');
      navigate(`/day/${date}`);
    } catch (err) {
      toast(err.ref ? `${err.message} Reference: ${err.ref}.` : err.message, { tone: 'error' });
      runCheckNow();
    }
  }));

  // Stop guarding once this view is gone.
  const onHash = () => {
    if (root.isConnected) return;
    if (dirtyGuard) { window.removeEventListener('beforeunload', dirtyGuard); dirtyGuard = null; }
    window.removeEventListener('hashchange', onHash);
  };
  window.addEventListener('hashchange', onHash);

  mount(root,
    header,
    notes.length ? h('div', { class: 'grid gap-y-3' }, notes) : null,
    statsBlock,
    editable ? h('div', { class: 'grid max-w-md gap-y-6' }, nameField) : null,
    issuesEl,
    h('div', { class: 'grid gap-y-10' }, holeSections),
    footer);

  paintFooter();
  paintNodButtons();
  if (editable && everTyped) runCheckNow();
  return root;
}
