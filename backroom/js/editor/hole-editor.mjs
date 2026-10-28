// Shared hole editor (spec §1/§4): seed → one word field per letter with the first
// letter locked, live per-word validation, link chips checked against the pairs list,
// par, a player preview drawn the way the game draws a hole, and an optional nod
// editor with a live, game-styled nod card.
//
// holeEditor({hole, onChange, readOnlyWords, showNod}) → {el, value(), errors()}
// Extra options (all optional): index (0-based, for labels), disabled (viewer: nothing
// editable), poolCheck (show "already in the pool" from puzzle_check), puzzleId (exclude
// self from that check). Extra methods: chainErrors(), nodErrors(), nodSlot (an element
// the caller can mount nod actions into), focus().
import { api } from '../api.mjs';
import { h, mount, iconEl, id as uid, button, field, input } from '../ui.mjs';
import { checkChain, checkNod, par as parOf } from '../validate.mjs';

const clean = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
const cx = (...c) => c.filter(Boolean).join(' ');

export const debounce = (fn, ms) => {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
};

// Link text → known (in the pairs list). Shared by every editor on the page.
const knownCache = new Map();

// The game's own nod glyphs (index.html NOD_ICONS), used only inside the player-facing
// nod preview so editors see exactly what players get. UI controls use Heroicons.
const GAME_NOD_ICON = {
  listen: '<svg viewBox="0 -960 960 960" aria-hidden="true" class="size-4.5 fill-current"><path d="M320-200v-560l440 280-440 280Z"/></svg>',
  read: '<svg viewBox="0 -960 960 960" aria-hidden="true" class="size-4.5 fill-current"><path d="M320-440h320v-80H320v80Zm0 120h320v-80H320v80Zm0 120h200v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520Z"/></svg>',
  watch: '<svg viewBox="0 0 16 16" aria-hidden="true" class="size-4.5 fill-current"><path fill-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm-.847-9.766A.75.75 0 0 0 6 5.866v4.268a.75.75 0 0 0 1.153.633l3.353-2.134a.75.75 0 0 0 0-1.266L7.153 5.234Z" clip-rule="evenodd"/></svg>',
};
const NOD_TYPES = [
  { value: 'listen', label: 'Listen', icon: 'speaker-wave' },
  { value: 'read', label: 'Read', icon: 'newspaper' },
  { value: 'watch', label: 'Watch', icon: 'play-circle' },
];

const urlOk = (u) => {
  const s = String(u || '').trim();
  if (!s.startsWith('https://') || s.length > 600 || /\s/.test(s)) return false;
  try { return new URL(s).protocol === 'https:'; } catch { return false; }
};

const subheading = (text) => h('h3', { class: 'text-base font-semibold text-balance text-zinc-950 sm:text-sm dark:text-white' }, text);
const muted = (text, extra) => h('p', { class: cx('text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400', extra) }, text);

// ── Player preview: tiles sized to the longest word, first word given in green,
// later words show their first letter (a freebie tile) and blanks. Colours are the
// game's own (index.html :root), so the panel stays light in both themes.
const previewBoard = (seed, words, reveal) => {
  const W = words.map(clean);
  if (!seed || !W.length) {
    return h('p', { class: 'py-6 text-center text-base/6 text-[#6E7772] sm:text-sm/6' }, 'Type a seed to see the hole.');
  }
  const cols = Math.max(3, ...W.map((w, k) => Math.max(w.length, seed[k] ? 1 : 0)));
  return h('div', { class: 'mx-auto grid w-full max-w-[calc(var(--cols)*--spacing(11))] gap-1.5', style: { '--cols': String(cols) } },
    W.map((w, k) => {
      const len = Math.max(w.length, 1);
      const tiles = Array.from({ length: len }, (_, i) => {
        const ch = w[i] || (i === 0 ? seed[k] || '' : '');
        if (k === 0) return h('div', { class: 'grid aspect-square place-items-center rounded-md border-2 border-[#17845A] bg-[#17845A] text-sm font-black text-white' }, ch);
        if (i === 0) return h('div', { class: 'grid aspect-square place-items-center rounded-md border-2 border-[#D8D2C5] bg-[#EEEBE3] text-sm font-black text-[#151A17]' }, ch);
        return h('div', { class: 'grid aspect-square place-items-center rounded-md border-2 border-[#E7E3D9] bg-white text-sm font-black text-[#7FC3A5]' }, reveal ? ch : '');
      });
      return h('div', {
        class: 'grid grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-1',
        'aria-label': k === 0 ? `Given word ${w || seed[0]}` : `Word ${k + 1}: ${reveal ? w : `${seed[k] || ''} then ${Math.max(0, len - 1)} blanks`}`,
      }, tiles);
    }));
};

// ── Nod card preview, matching the game's .nod (light green card, dark green stroke,
// square icon chip).
const nodCard = (nod) => {
  const text = String(nod.text || '').trim();
  const label = String(nod.label || '').trim();
  const href = urlOk(nod.url) ? nod.url.trim() : null;
  return h(href ? 'a' : 'div', {
    href, target: href ? '_blank' : null, rel: href ? 'noopener' : null,
    class: 'flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#17845A] bg-[#F1F7F3] px-3.25 py-2.75 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
  },
    h('span', { class: 'flex size-8.5 shrink-0 items-center justify-center rounded-[10px] bg-[#17845A] text-white', html: GAME_NOD_ICON[nod.icon] || GAME_NOD_ICON.listen }),
    h('div', { class: 'grid min-w-0 gap-0.5 text-[0.75rem]/[1.4]' },
      h('p', { class: cx('text-[0.78125rem] font-bold break-words', text ? 'text-[#151A17]' : 'text-[#6E7772]/70') }, text || 'Your headline goes here'),
      h('p', { class: cx('font-semibold break-words', label ? 'text-[#6E7772]' : 'text-[#6E7772]/70') }, label || 'Attribution')));
};

export function holeEditor({
  hole = {}, onChange, readOnlyWords = false, showNod = false,
  index = null, disabled = false, poolCheck = false, puzzleId = null,
} = {}) {
  const lockWords = readOnlyWords || disabled;
  const origWords = (hole.words || []).map(clean);
  const origAlts = Array.isArray(hole.alts) ? hole.alts : null;
  const label = (s) => (index != null ? `Hole ${index + 1} ${s}` : s);

  // ── state ──────────────────────────────────────────────────────────────────
  let seed = clean(hole.seed).slice(0, 5);
  // rest[k] = the word minus its locked first letter
  let rest = origWords.map((w, k) => (w[0] === seed[k] ? w.slice(1) : w));
  const parked = new Map(); // `${index}:${letter}` → remainder typed for that letter
  const touched = new Set(origWords.map((w, k) => (w ? k : -1)).filter((k) => k >= 0));
  let reveal = false;
  let serverErrors = [];
  let checkSeq = 0;

  const words = () => [...seed].map((ch, k) => (rest[k] || rest[k] === '' ? ch + rest[k] : ch));
  const chainErrors = () => checkChain(seed, words()).errors.concat(poolCheck ? serverErrors : []);

  // ── seed + par ─────────────────────────────────────────────────────────────
  const seedInput = input({
    name: uid('seed'), value: seed, maxlength: '5', autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', disabled: lockWords, placeholder: 'LINK',
    class: 'font-mono font-semibold tracking-[0.2em] uppercase',
    'aria-label': label('seed'),
  });
  const seedField = field({ label: 'Seed', input: seedInput, hint: lockWords ? null : 'Three to five letters. Each letter starts one word.' });
  const parValue = h('dd', { class: 'text-2xl/8 font-semibold tracking-tight text-zinc-950 tabular-nums sm:text-xl/7 dark:text-white' });
  const parSub = h('dd', { class: 'text-base/6 text-zinc-500 tabular-nums sm:text-sm/6 dark:text-zinc-400' });
  const parBlock = h('dl', { class: 'grid shrink-0 content-start gap-y-0.5 text-right' },
    h('dt', { class: 'text-base/6 font-medium text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, 'Par'), parValue, parSub);

  // ── words ──────────────────────────────────────────────────────────────────
  const wordsList = h('ol', { role: 'list', class: 'grid' });
  const poolErrEl = h('p', { class: 'text-base/6 text-red-600 sm:text-sm/6 dark:text-red-400', hidden: true });
  let rows = []; // [{input, err, count, chip, chipNote}]

  const focusWord = (k, atEnd = true) => {
    const r = rows[k]; if (!r) return;
    r.input.focus();
    if (atEnd) { const n = r.input.value.length; r.input.setSelectionRange(n, n); }
  };

  const buildRows = () => {
    rows = [];
    const items = [];
    [...seed].forEach((ch, k) => {
      if (k > 0) {
        const chip = h('span', { class: 'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-sm/5 font-medium whitespace-nowrap sm:text-xs/5' });
        const chipNote = h('span', { class: 'min-w-0 truncate text-zinc-500 dark:text-zinc-400' });
        const linkRow = h('li', { class: 'flex items-center gap-x-3 text-base/6 sm:text-sm/6', 'aria-live': 'polite' },
          h('span', { class: 'ml-4.25 h-7 w-px shrink-0 bg-zinc-950/10 dark:bg-white/15', 'aria-hidden': 'true' }),
          chip, chipNote);
        rows[k - 1].linkRow = linkRow; rows[k - 1].chip = chip; rows[k - 1].chipNote = chipNote;
        items.push(linkRow);
      }
      const wi = h('input', {
        type: 'text', name: uid('word'), value: rest[k] || '', maxlength: '9', autocomplete: 'off',
        autocapitalize: 'characters', spellcheck: 'false', readonly: lockWords, disabled: disabled,
        'aria-label': label(`word ${k + 1}, starting with ${ch}`),
        class: 'min-w-0 flex-1 bg-transparent py-2 pr-3 pl-px font-mono text-base/6 font-semibold tracking-[0.12em] text-zinc-950 uppercase placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400 focus:outline-hidden sm:py-1.5 sm:text-sm/6 dark:text-white dark:placeholder:text-zinc-500',
        placeholder: k === 0 ? 'given to players' : '',
      });
      const count = h('span', { class: 'shrink-0 pr-3 text-zinc-400 tabular-nums dark:text-zinc-500', 'aria-hidden': 'true' });
      const err = h('p', { id: uid('werr'), class: 'pl-1 text-base/6 text-red-600 sm:text-sm/6 dark:text-red-400', hidden: true });
      wi.setAttribute('aria-describedby', err.id);
      const box = h('div', {
        class: cx('flex items-center rounded-lg ring-1 ring-zinc-950/10 ring-inset focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-brand-600 has-aria-invalid:ring-red-500/60 dark:ring-white/10 dark:has-aria-invalid:ring-red-400/60',
          lockWords ? 'bg-zinc-950/2.5 dark:bg-white/2.5' : 'bg-white dark:bg-white/5'),
        'on:click': () => wi.focus(),
      },
        h('span', { class: 'shrink-0 py-2 pl-3 font-mono text-base/6 font-semibold tracking-[0.12em] text-brand-700 select-none sm:py-1.5 sm:text-sm/6 dark:text-brand-300', title: `Locked to the seed letter ${ch}` }, ch),
        wi, count);
      wi.addEventListener('input', () => {
        const pos = wi.selectionStart;
        const v = clean(wi.value).slice(0, 9);
        if (v !== wi.value) { wi.value = v; try { wi.setSelectionRange(pos, pos); } catch { /* */ } }
        rest[k] = v; touched.add(k);
        changed();
      });
      wi.addEventListener('blur', () => { touched.add(k); paintWords(); });
      wi.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
        const parts = text.trim().split(/[\s,·/>-]+/).map(clean).filter(Boolean);
        if (!parts.length) return;
        e.preventDefault();
        // Pasting several words fills the following fields too; a pasted word that
        // starts with the locked letter drops it.
        parts.forEach((p, j) => {
          const t = k + j; if (t >= seed.length) return;
          rest[t] = (p[0] === seed[t] && p.length > 1 ? p.slice(1) : p).slice(0, 9);
          touched.add(t);
          if (rows[t]) rows[t].input.value = rest[t];
        });
        changed();
        focusWord(Math.min(k + parts.length - 1, seed.length - 1));
      });
      wi.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.isComposing) {
          e.preventDefault();
          if (k + 1 < seed.length) focusWord(k + 1);
        } else if (e.key === 'Backspace' && wi.selectionStart === 0 && wi.selectionEnd === 0 && k > 0) {
          e.preventDefault(); focusWord(k - 1);
        } else if (e.key === 'ArrowUp' && k > 0) { e.preventDefault(); focusWord(k - 1); }
        else if (e.key === 'ArrowDown' && k + 1 < seed.length) { e.preventDefault(); focusWord(k + 1); }
      });
      rows.push({ input: wi, err, count });
      items.push(h('li', { class: 'grid gap-y-1' }, box, err));
    });
    if (!items.length) items.push(h('li', { class: 'text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, 'One word field appears for each seed letter. Tip: paste a whole chain, like “snake oil rig”, into the seed.'));
    mount(wordsList, items);
  };

  // ── link chips ─────────────────────────────────────────────────────────────
  const CHIP = {
    known: 'bg-brand-500/15 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300',
    unknown: 'bg-amber-400/20 text-amber-800 dark:bg-amber-400/10 dark:text-amber-400',
    pending: 'bg-zinc-600/10 text-zinc-700 dark:bg-white/5 dark:text-zinc-400',
  };
  const CHIP_BASE = 'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-sm/5 font-medium whitespace-nowrap sm:text-xs/5';
  let checkFailed = false;
  const paintLinks = () => {
    const W = words();
    rows.forEach((r, k) => {
      if (!r.chip) return;
      const a = W[k] || '', b = W[k + 1] || '';
      if (a.length < 2 || b.length < 2) {
        r.chip.hidden = true;
        r.chipNote.textContent = '';
        return;
      }
      const text = `${a} ${b}`.toLowerCase();
      const known = knownCache.get(text);
      r.chip.hidden = false;
      r.chip.textContent = text;
      r.chip.className = cx(CHIP_BASE, known === true ? CHIP.known : known === false ? CHIP.unknown : CHIP.pending);
      r.chipNote.textContent = known === true ? 'Known pair'
        : known === false ? 'New pair. Check it is a real phrase.'
          : checkFailed ? 'Not checked' : 'Checking';
    });
  };

  const serverCheck = debounce(async () => {
    const W = words();
    const anyLink = W.some((w, k) => k > 0 && w.length >= 2 && W[k - 1].length >= 2);
    const needLinks = W.some((w, k) => k > 0 && w.length >= 2 && W[k - 1].length >= 2 && !knownCache.has(`${W[k - 1]} ${w}`.toLowerCase()));
    const structurallyOk = !checkChain(seed, W).errors.length;
    if (!anyLink && !(poolCheck && structurallyOk)) return;
    if (!needLinks && !(poolCheck && structurallyOk)) { if (serverErrors.length) { serverErrors = []; paintAll(); } return; }
    const seq = ++checkSeq;
    try {
      const res = await api('puzzle_check', { seed, words: W, ...(puzzleId != null ? { id: puzzleId } : {}) });
      if (seq !== checkSeq) return;
      checkFailed = false;
      for (const l of res.links || []) {
        const [x, y] = String(l.text).split(' ');
        if ((x || '').length >= 2 && (y || '').length >= 2) knownCache.set(l.text, !!l.known);
      }
      serverErrors = structurallyOk ? (res.errors || []).filter((e) => e.word == null).map((e) => ({ msg: e.msg, server: true })) : [];
    } catch {
      if (seq !== checkSeq) return;
      checkFailed = true;
    }
    paintAll();
    onChange?.(value());
  }, 450);

  // ── painting ───────────────────────────────────────────────────────────────
  const paintWords = () => {
    const errs = checkChain(seed, words()).errors;
    const W = words();
    rows.forEach((r, k) => {
      let mine = errs.find((e) => e.word === k);
      if (mine && !(rest[k] || '').length) mine = { msg: `Finish word ${k + 1}.` };
      const show = mine && touched.has(k) && !lockWords;
      r.err.textContent = show ? mine.msg : '';
      r.err.hidden = !show;
      if (show) r.input.setAttribute('aria-invalid', 'true'); else r.input.removeAttribute('aria-invalid');
      r.count.textContent = (rest[k] || '').length ? String(W[k].length) : '';
    });
    // Seed-level error (length / letters), only once the seed has something in it.
    const seedErr = seed && !/^[A-Z]{3,5}$/.test(seed) ? 'Seed must be 3 to 5 letters.' : null;
    seedField.setError(lockWords ? null : seedErr);
    const pe = poolCheck ? serverErrors[0] : null;
    poolErrEl.textContent = pe ? pe.msg : '';
    poolErrEl.hidden = !pe;
  };

  const paintPar = () => {
    if (seed.length >= 3) {
      parValue.textContent = String(parOf(seed.length));
      parSub.textContent = `${seed.length - 1} blanks`;
    } else { parValue.textContent = '—'; parSub.textContent = 'Needs a seed'; }
  };

  // preview
  const revealBtn = button({ label: 'Reveal answers', icon: 'eye', variant: 'ghost', size: 'sm', 'aria-pressed': 'false' });
  const boardWrap = h('div', { class: 'rounded-xl bg-[#F7F5EF] p-4 ring-1 ring-zinc-950/5 dark:ring-white/10' });
  const boardCaption = h('p', { class: 'text-base/6 text-zinc-500 tabular-nums sm:text-sm/6 dark:text-zinc-400' });
  revealBtn.addEventListener('click', () => {
    reveal = !reveal;
    revealBtn.setAttribute('aria-pressed', String(reveal));
    mount(revealBtn, iconEl(reveal ? 'eye-slash' : 'eye', 'size-4 shrink-0 fill-zinc-500 dark:fill-zinc-400'), h('span', { class: 'truncate' }, reveal ? 'Hide answers' : 'Reveal answers'));
    paintPreview();
  });
  const paintPreview = () => {
    mount(boardWrap, previewBoard(seed, seed ? words() : [], reveal));
    boardCaption.textContent = seed.length >= 3
      ? `${index != null ? `Hole ${index + 1} · ` : ''}Par ${parOf(seed.length)} · players fill ${seed.length - 1} ${seed.length - 1 === 1 ? 'word' : 'words'}`
      : 'Players see the first word in full and the first letter of each word after it.';
  };

  const paintAll = () => { paintWords(); paintLinks(); paintPar(); paintPreview(); };

  const changed = () => {
    paintAll();
    serverCheck();
    onChange?.(value());
  };

  seedInput.addEventListener('input', () => {
    const raw = seedInput.value;
    const v = clean(raw).slice(0, 5);
    if (v !== raw) seedInput.value = v;
    const before = seed;
    seed = v;
    // Keep each word's typed remainder; the locked letter follows the new seed.
    // A word belongs to its seed letter: when a letter changes, park that word and
    // bring back whatever was typed for the new letter (so a typo costs nothing).
    for (let k = 0; k < Math.max(before.length, seed.length); k++) {
      if (before[k] === seed[k]) continue;
      if (before[k] && rest[k]) parked.set(`${k}:${before[k]}`, rest[k]);
      rest[k] = seed[k] ? parked.get(`${k}:${seed[k]}`) ?? '' : rest[k];
      if (seed[k] && !rest[k]) touched.delete(k);
    }
    if (before.length !== seed.length || before !== seed) buildRows();
    changed();
  });
  // Paste a whole chain into the seed ("snake oil rig") to fill everything at once.
  seedInput.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const parts = text.trim().split(/[\s,·/>-]+/).map(clean).filter(Boolean);
    if (parts.length < 3 || parts.length > 5) return;
    e.preventDefault();
    seed = parts.map((p) => p[0]).join('');
    seedInput.value = seed;
    rest = parts.map((p) => p.slice(1, 10));
    parts.forEach((_, k) => touched.add(k));
    buildRows();
    changed();
  });
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && seed.length >= 3) { e.preventDefault(); focusWord(0); }
  });

  // ── nod ────────────────────────────────────────────────────────────────────
  const origNod = hole.nod && typeof hole.nod === 'object' ? { ...hole.nod } : null;
  let nodOn = !!origNod;
  const nodTouched = new Set(origNod ? ['icon', 'text', 'label', 'url'] : []);
  const nodSlot = h('div', { class: 'flex flex-wrap items-center gap-3 empty:hidden' });
  let nodEls = null;

  const radioName = uid('nodicon');
  const iconRadios = NOD_TYPES.map((t) => h('input', {
    type: 'radio', name: radioName, value: t.value, class: 'sr-only', disabled, 'aria-label': t.label,
    checked: (origNod?.icon || 'read') === t.value,
  }));
  const nodIcon = () => iconRadios.find((r) => r.checked)?.value || 'read';

  const textIn = input({ name: uid('nodtext'), value: origNod?.text || '', maxlength: '140', disabled, placeholder: 'Hear the reporter who broke the story' });
  const labelIn = input({ name: uid('nodlabel'), value: origNod?.label || '', maxlength: '140', disabled, placeholder: 'The Daily, 24 minutes' });
  const urlIn = input({ name: uid('nodurl'), type: 'url', value: origNod?.url || '', maxlength: '600', disabled, placeholder: 'https://', inputmode: 'url', spellcheck: 'false', autocomplete: 'off' });
  const fText = field({ label: 'Headline', input: textIn, hint: ' ' });
  const fLabel = field({ label: 'Attribution', input: labelIn, hint: ' ' });
  const openLink = button({ label: 'Open link', icon: 'arrow-top-right-on-square', variant: 'ghost', size: 'sm', href: '#', target: '_blank' });
  const fUrl = field({ label: 'Link', input: h('div', { class: 'flex items-center gap-x-2' }, h('div', { class: 'min-w-0 flex-1' }, urlIn), openLink), hint: 'Must start with https://. Opens in a new tab for players.' });
  const counterOf = (f) => f.querySelector('[id^="hint"]');

  const nodValue = () => (nodOn ? { icon: nodIcon(), text: textIn.value.trim(), label: labelIn.value.trim(), url: urlIn.value.trim() } : null);
  const nodErrors = () => {
    if (!showNod || !nodOn) return [];
    const v = nodValue();
    const errs = checkNod(v).map((e) => ({ ...e, scope: 'nod' }));
    if (!errs.some((e) => e.field === 'url') && !urlOk(v.url)) errs.push({ field: 'url', msg: 'Link must be a full https:// address.', scope: 'nod' });
    return errs;
  };

  const nodPreviewWrap = h('div', { class: 'rounded-xl bg-white p-4 ring-1 ring-zinc-950/5 dark:ring-white/10' });
  const paintNod = () => {
    if (!nodEls) return;
    nodEls.on.hidden = !nodOn;
    nodEls.off.hidden = nodOn;
    if (!nodOn) return;
    const v = nodValue();
    counterOf(fText).textContent = `Shown in bold. ${v.text.length} of 140 characters.`;
    counterOf(fLabel).textContent = `Who made it, and how long it takes. ${v.label.length} of 140 characters.`;
    const errs = nodErrors();
    const msg = (f) => (nodTouched.has(f) ? errs.find((e) => e.field === f)?.msg || null : null);
    fText.setError(msg('text')); fLabel.setError(msg('label')); fUrl.setError(msg('url'));
    const ok = urlOk(v.url);
    openLink.classList.toggle('pointer-events-none', !ok);
    openLink.classList.toggle('opacity-50', !ok);
    if (ok) { openLink.href = v.url; openLink.removeAttribute('aria-disabled'); } else { openLink.removeAttribute('href'); openLink.setAttribute('aria-disabled', 'true'); }
    mount(nodPreviewWrap, nodCard(v));
  };
  const nodChanged = (f) => { if (f) nodTouched.add(f); paintNod(); onChange?.(value()); };

  const buildNod = () => {
    const segmented = h('div', { class: 'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-zinc-950/5 p-0.5 dark:bg-white/5', role: 'radiogroup', 'aria-label': label('nod type') },
      NOD_TYPES.map((t, i) => h('label', {
        class: 'relative flex shrink-0 cursor-pointer items-center gap-x-1.5 rounded-md py-1.5 pr-3 pl-1.5 text-base/6 font-medium text-zinc-600 has-checked:bg-white has-checked:text-zinc-950 has-checked:shadow-xs has-checked:ring-1 has-checked:ring-zinc-950/10 has-focus-visible:outline-2 has-focus-visible:outline-brand-600 has-disabled:cursor-not-allowed sm:py-1 sm:pl-1 sm:text-sm/5 dark:text-zinc-400 dark:has-checked:bg-white/10 dark:has-checked:text-white dark:has-checked:shadow-none dark:has-checked:ring-white/10',
      }, iconRadios[i], iconEl(t.icon, 'size-4 shrink-0 fill-zinc-500 dark:fill-zinc-400'), t.label)));
    iconRadios.forEach((r) => r.addEventListener('change', () => nodChanged('icon')));
    textIn.addEventListener('input', () => nodChanged('text'));
    labelIn.addEventListener('input', () => nodChanged('label'));
    urlIn.addEventListener('input', () => nodChanged());
    urlIn.addEventListener('blur', () => nodChanged('url'));
    textIn.addEventListener('blur', () => nodChanged('text'));
    labelIn.addEventListener('blur', () => nodChanged('label'));

    const removeBtn = disabled ? null : button({
      label: 'Remove nod', icon: 'trash', variant: 'ghost', size: 'sm',
      onClick: () => { nodOn = false; nodTouched.clear(); paintNod(); onChange?.(value()); },
    });
    const addBtn = disabled ? null : button({
      label: 'Add a nod', icon: 'plus', variant: 'secondary', size: 'sm',
      onClick: () => { nodOn = true; paintNod(); onChange?.(value()); requestAnimationFrame(() => textIn.focus()); },
    });

    const on = h('div', { class: '@container' },
      h('div', { class: 'grid gap-x-10 gap-y-6 @2xl:grid-cols-2' },
        h('div', { class: 'grid content-start gap-y-5' },
          h('div', { class: 'grid gap-y-2' },
            h('p', { class: 'text-base/6 font-medium text-zinc-950 select-none sm:text-sm/6 dark:text-white' }, 'Type'),
            h('div', {}, segmented)),
          fText, fLabel, fUrl),
        h('div', { class: 'grid content-start gap-y-3' },
          h('div', { class: 'flex items-center justify-between gap-x-3' },
            h('p', { class: 'text-base/6 font-medium text-zinc-950 sm:text-sm/6 dark:text-white' }, 'What players see'),
            removeBtn),
          nodPreviewWrap,
          muted('The card appears under the solved chain, after the player finishes this hole.'))));
    const off = h('div', { class: 'flex flex-wrap items-center gap-x-4 gap-y-3' },
      addBtn,
      muted(disabled ? 'No nod on this hole.' : 'No nod yet. Point players to a story, podcast or video that fits this hole.', 'min-w-0 flex-1'));
    nodEls = { on, off };
    return h('section', { class: 'grid gap-y-4 border-t border-zinc-950/5 pt-6 dark:border-white/10' },
      h('div', { class: 'grid gap-y-1' },
        subheading('Nod'),
        muted('An optional link to your newsroom’s work, shown to players after this hole.')),
      on, off, nodSlot);
  };

  // ── assemble ───────────────────────────────────────────────────────────────
  const lockedNote = readOnlyWords && !disabled
    ? h('p', { class: 'flex items-start gap-x-2 text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' },
      h('span', { class: 'flex h-lh shrink-0 items-center' }, iconEl('lock-closed', 'size-4 shrink-0 fill-zinc-400 dark:fill-zinc-500')),
      h('span', { class: 'min-w-0' }, 'Words are locked for this day.'))
    : null;

  const el = h('div', { class: 'grid gap-y-8' },
    h('div', { class: '@container' },
      h('div', { class: 'grid gap-x-10 gap-y-8 @3xl:grid-cols-[7fr_5fr]' },
        h('div', { class: 'grid content-start gap-y-5' },
          h('div', { class: 'flex items-start justify-between gap-x-6' },
            h('div', { class: 'min-w-0 flex-1 sm:max-w-56' }, seedField), parBlock),
          h('div', { class: 'grid gap-y-2' },
            h('p', { class: 'text-base/6 font-medium text-zinc-950 select-none sm:text-sm/6 dark:text-white' }, 'Chain'),
            wordsList, poolErrEl, lockedNote)),
        h('div', { class: 'grid content-start gap-y-3' },
          h('div', { class: 'flex items-center justify-between gap-x-3' },
            h('p', { class: 'text-base/6 font-medium text-zinc-950 sm:text-sm/6 dark:text-white' }, 'Player preview'),
            revealBtn),
          boardWrap, boardCaption))),
    showNod ? buildNod() : null);

  buildRows();
  paintAll();
  paintNod();
  serverCheck();

  const value = () => {
    const W = words();
    const v = { seed, words: W };
    if (origAlts && W.length === origWords.length && W.every((w, k) => w === origWords[k])) v.alts = origAlts;
    if (showNod) v.nod = nodValue();
    return v;
  };

  return {
    el,
    value,
    errors: () => chainErrors().concat(nodErrors()),
    chainErrors,
    nodErrors,
    nodSlot,
    // Show every word's problem, including fields nobody has typed in yet.
    revealErrors: () => { [...seed].forEach((_, k) => touched.add(k)); paintWords(); },
    focus: () => (lockWords ? (showNod ? textIn.focus() : null) : seedInput.focus()),
  };
}

export default holeEditor;
