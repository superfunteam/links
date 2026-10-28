// Chain, day and nod rules for the backroom — pure functions, no imports, so
// the server (netlify/functions/backroom.mjs), the smoke test and the client
// mirror (backroom/js/validate.mjs) all agree on exactly one definition.

export const HOLES_PER_DAY = 5;
export const SEED_RE = /^[A-Z]{3,5}$/;
export const WORD_RE = /^[A-Z]{2,10}$/;
export const NOD_ICONS = ['listen', 'read', 'watch'];

// warning windows, in days (mirrors build.mjs)
export const LINK_COOLDOWN = 3;
export const SEED_COOLDOWN = 28;
export const ECHO_WINDOW = 10;
export const ECHO_SHARE = 3;
export const NAME_COOLDOWN = 45;

export const norm = v => String(v ?? '').toUpperCase().trim();
export const linksOf = words => words.slice(1).map((w, i) => `${words[i]} ${w}`.toLowerCase());
/** blanks = words - 1; par = blanks + (blanks >= 4 ? 2 : 1) */
export const parOf = words => { const b = words.length - 1; return b + (b >= 4 ? 2 : 1); };

/** Whole days from a to b (YYYY-MM-DD strings). */
export const daysBetween = (a, b) =>
  Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/** Normalise one hole as sent by a client. Never throws. */
export function normHole(h) {
  const seed = norm(h?.seed);
  const words = Array.isArray(h?.words) ? h.words.slice(0, 12).map(norm) : [];
  const out = { seed, words, links: linksOf(words) };
  if (Array.isArray(h?.alts) && h.alts.length === words.length) {
    const alts = h.alts.map(a => (Array.isArray(a) ? a : []).slice(0, 6).map(norm).filter(w => WORD_RE.test(w)));
    if (alts.some(a => a.length)) out.alts = alts;
  }
  return out;
}

/** Structural rules for one chain. Returns [{word?, msg}] (word = index). */
export function checkChain(seedIn, wordsIn) {
  const seed = norm(seedIn);
  const words = Array.isArray(wordsIn) ? wordsIn.map(norm) : [];
  const errors = [];
  if (!SEED_RE.test(seed)) { errors.push({ msg: 'Seed must be 3 to 5 letters, A to Z.' }); return errors; }
  if (words.length !== seed.length)
    errors.push({ msg: `A ${seed.length}-letter seed needs ${seed.length} words, not ${words.length}.` });
  words.forEach((w, k) => {
    if (!WORD_RE.test(w)) errors.push({ word: k, msg: `Word ${k + 1} must be 2 to 10 letters, A to Z.` });
    else if (k < seed.length && w[0] !== seed[k]) errors.push({ word: k, msg: `"${w}" should start with "${seed[k]}".` });
  });
  const seen = new Set();
  words.forEach((w, k) => {
    if (w && seen.has(w)) errors.push({ word: k, msg: `"${w}" is used twice in this chain.` });
    seen.add(w);
  });
  return errors;
}

/** Rules for a whole day. Returns [{hole, word?, msg}]; hole null = the day itself. */
export function checkDay({ name, holes }) {
  const errors = [];
  const nm = String(name ?? '').trim();
  if (!nm) errors.push({ hole: null, msg: 'Give the course a name.' });
  else if (nm.length > 40) errors.push({ hole: null, msg: 'Course names are 40 characters at most.' });
  const list = Array.isArray(holes) ? holes : [];
  if (list.length !== HOLES_PER_DAY)
    errors.push({ hole: null, msg: `A course has exactly ${HOLES_PER_DAY} holes, not ${list.length}.` });
  const norms = list.slice(0, 12).map(normHole);
  norms.forEach((h, i) => checkChain(h.seed, h.words).forEach(e => errors.push({ hole: i, ...e })));

  const seeds = new Map(), words = new Map(), links = new Map();
  norms.forEach((h, i) => {
    if (h.seed && seeds.has(h.seed))
      errors.push({ hole: i, msg: `Seed ${h.seed} is already hole ${seeds.get(h.seed) + 1}.` });
    else if (h.seed) seeds.set(h.seed, i);
    h.words.forEach((w, k) => {
      if (!w) return;
      if (words.has(w) && words.get(w) !== i)
        errors.push({ hole: i, word: k, msg: `"${w}" already appears in hole ${words.get(w) + 1}.` });
      else if (!words.has(w)) words.set(w, i);
    });
    h.links.forEach(l => {
      if (links.has(l) && links.get(l) !== i)
        errors.push({ hole: i, msg: `The link "${l}" already appears in hole ${links.get(l) + 1}.` });
      else if (!links.has(l)) links.set(l, i);
    });
  });
  return errors;
}

/** Soft rules against neighbouring days: others = [{date, name, holes}].
 *  Returns [{hole, msg}]; hole null = the day itself. */
export function dayWarnings(date, name, holes, others) {
  const warnings = [];
  const mine = (Array.isArray(holes) ? holes : []).map(normHole);
  const nm = String(name ?? '').trim().toLowerCase();
  const near = (others || [])
    .filter(o => o && o.date && o.date !== date)
    .map(o => ({ date: o.date, name: o.name, gap: Math.abs(daysBetween(date, o.date)),
                 holes: (Array.isArray(o.holes) ? o.holes : []).map(normHole) }))
    .sort((a, b) => a.gap - b.gap);

  mine.forEach((h, i) => {
    let flagged = false;
    for (const o of near) {
      if (o.gap > LINK_COOLDOWN || flagged) break;
      const theirs = new Set(o.holes.flatMap(x => x.links));
      const hit = h.links.find(l => theirs.has(l));
      if (hit) { warnings.push({ hole: i, msg: `The link "${hit}" is also used on ${o.date}, within ${LINK_COOLDOWN} days.` }); flagged = true; }
    }
    for (const o of near) {
      if (o.gap > SEED_COOLDOWN) break;
      if (o.holes.some(x => x.seed === h.seed)) {
        warnings.push({ hole: i, msg: `Seed ${h.seed} also plays on ${o.date}, within ${SEED_COOLDOWN} days.` });
        break;
      }
    }
    const mineSet = new Set(h.words);
    outer: for (const o of near) {
      if (o.gap > ECHO_WINDOW) break;
      for (const x of o.holes) {
        const shared = x.words.filter(w => mineSet.has(w)).length;
        if (shared >= ECHO_SHARE) {
          warnings.push({ hole: i, msg: `This chain shares ${shared} words with ${x.seed} on ${o.date}.` });
          break outer;
        }
      }
    }
  });

  if (nm) {
    const twin = near.find(o => o.gap <= NAME_COOLDOWN && String(o.name || '').trim().toLowerCase() === nm);
    if (twin) warnings.push({ hole: null, msg: `The name "${String(name).trim()}" was also used on ${twin.date}.` });
  }
  return warnings;
}

const cleanLine = v => String(v ?? '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Validate and clean a nod. Returns {errors:[msg], nod} — nod is only safe to
 *  store when errors is empty. */
export function checkNod(input) {
  const errors = [];
  const nod = {
    icon: String(input?.icon ?? ''),
    text: cleanLine(input?.text),
    label: cleanLine(input?.label),
    url: String(input?.url ?? '').trim(),
  };
  if (!NOD_ICONS.includes(nod.icon)) errors.push('Pick listen, read or watch.');
  if (nod.text.length < 1 || nod.text.length > 140) errors.push('The headline must be 1 to 140 characters.');
  if (nod.label.length < 1 || nod.label.length > 140) errors.push('The label must be 1 to 140 characters.');
  let urlOk = nod.url.startsWith('https://') && nod.url.length <= 600 && !/\s/.test(nod.url);
  if (urlOk) { try { urlOk = new URL(nod.url).protocol === 'https:'; } catch { urlOk = false; } }
  if (!urlOk) errors.push('The link must be a full https:// address, 600 characters at most.');
  return { errors, nod };
}
