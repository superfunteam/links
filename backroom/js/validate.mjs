// Client mirror of the chain rules (spec §5) for live feedback. The server is the
// authority; `known` link status and neighbouring-day warnings are server only.

export const NOD_ICONS = ['listen', 'read', 'watch'];
export const HOLES_PER_DAY = 5;

const up = (s) => String(s ?? '').trim().toUpperCase();

// par: blanks = words.length - 1; par = blanks + (blanks >= 4 ? 2 : 1)
export const par = (wordCount) => {
  const blanks = Math.max(0, (wordCount | 0) - 1);
  return blanks + (blanks >= 4 ? 2 : 1);
};

// links: `${words[k]} ${words[k+1]}` lowercased
export const links = (words = []) => {
  const w = words.map((x) => String(x ?? '').trim().toLowerCase());
  const out = [];
  for (let k = 0; k < w.length - 1; k++) out.push(`${w[k]} ${w[k + 1]}`);
  return out;
};

// checkChain(seed, words) → {errors:[{word?, msg}], links:[text], par}
// word = index into words when the error belongs to one word.
export const checkChain = (seed, words = []) => {
  const errors = [];
  const S = up(seed);
  const W = (words || []).map(up);

  if (!/^[A-Z]{3,5}$/.test(S)) errors.push({ msg: 'Seed must be 3 to 5 letters, A to Z.' });
  if (W.length !== S.length) errors.push({ msg: `Seed ${S || '(empty)'} needs ${S.length || '3 to 5'} words; this chain has ${W.length}.` });

  const seen = new Map();
  W.forEach((w, k) => {
    if (!/^[A-Z]+$/.test(w)) errors.push({ word: k, msg: w ? `${w} must use letters A to Z only.` : `Word ${k + 1} is empty.` });
    else if (w.length < 2 || w.length > 10) errors.push({ word: k, msg: `${w} must be 2 to 10 letters.` });
    if (w && S[k] && w[0] !== S[k]) errors.push({ word: k, msg: `${w} must start with ${S[k]}.` });
    if (w) {
      if (seen.has(w)) errors.push({ word: k, msg: `${w} is used twice.` });
      else seen.set(w, k);
    }
  });

  return { errors, links: links(W), par: par(W.length) };
};

// checkDay(holes) → {errors:[{hole, word?, msg}]}
// holes: [{seed, words}] — exactly 5; no seed, word or link repeated within the day.
export const checkDay = (holes = []) => {
  const errors = [];
  if (!Array.isArray(holes) || holes.length !== HOLES_PER_DAY) {
    errors.push({ hole: null, msg: `A day needs exactly ${HOLES_PER_DAY} holes.` });
  }
  const seeds = new Map(), words = new Map(), linkSeen = new Map();
  (holes || []).forEach((hole, i) => {
    const r = checkChain(hole?.seed, hole?.words || []);
    for (const e of r.errors) errors.push({ hole: i, ...e });
    const S = up(hole?.seed);
    if (S) {
      if (seeds.has(S)) errors.push({ hole: i, msg: `Seed ${S} is already used on hole ${seeds.get(S) + 1}.` });
      else seeds.set(S, i);
    }
    (hole?.words || []).map(up).forEach((w, k) => {
      if (!w) return;
      if (words.has(w) && words.get(w) !== i) errors.push({ hole: i, word: k, msg: `${w} is already used on hole ${words.get(w) + 1}.` });
      else if (!words.has(w)) words.set(w, i);
    });
    for (const l of r.links) {
      if (linkSeen.has(l) && linkSeen.get(l) !== i) errors.push({ hole: i, msg: `The link "${l}" is already used on hole ${linkSeen.get(l) + 1}.` });
      else if (!linkSeen.has(l)) linkSeen.set(l, i);
    }
  });
  return { errors };
};

// Same cleaning the server applies (netlify/lib/chain.mjs) before it checks lengths.
const cleanLine = (v) => String(v ?? '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// checkNod(nod) → [{field, msg}] (empty = valid)
export const checkNod = (nod) => {
  const errs = [];
  if (!nod || typeof nod !== 'object') return [{ field: null, msg: 'Nod is missing.' }];
  if (!NOD_ICONS.includes(nod.icon)) errs.push({ field: 'icon', msg: 'Pick Listen, Read or Watch.' });
  const text = cleanLine(nod.text);
  const label = cleanLine(nod.label);
  const url = String(nod.url ?? '').trim();
  if (text.length < 1 || text.length > 140) errs.push({ field: 'text', msg: 'Text must be 1 to 140 characters.' });
  if (label.length < 1 || label.length > 140) errs.push({ field: 'label', msg: 'Link label must be 1 to 140 characters.' });
  let urlOk = url.startsWith('https://') && url.length <= 600 && !/\s/.test(url);
  if (urlOk) { try { urlOk = new URL(url).protocol === 'https:'; } catch { urlOk = false; } }
  if (!urlOk) errs.push({ field: 'url', msg: 'Link must start with https:// and be at most 600 characters.' });
  return errs;
};
