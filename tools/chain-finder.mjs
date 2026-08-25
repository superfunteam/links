#!/usr/bin/env node
// Searches the compound-phrase graph in tools/pairs.txt for every valid Links
// chain — one whose initials spell a real dictionary word — then greedily picks
// a link-disjoint set. Candidates only; a human still throws out the duds.
//
//   node tools/chain-finder.mjs            report capacity
//   node tools/chain-finder.mjs --emit 5   print candidate 5-word chains as JSON
import { readFileSync } from 'node:fs';

const PAIRS = readFileSync(new URL('./pairs.txt', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim().toLowerCase())
  .filter(l => /^[a-z]+ [a-z]+$/.test(l))
  .map(l => l.split(' '));

const next = new Map();
for (const [a, b] of PAIRS) {
  const A = a.toUpperCase(), B = b.toUpperCase();
  if (!next.has(A)) next.set(A, new Set());
  next.get(A).add(B);
}

// web2 is a 1934 dictionary full of obscurities (HOWFF, SPOSH), so seeds come
// from a hand-checked allowlist of words people actually know instead.
const dict = new Set(
  readFileSync(new URL('./seeds.txt', import.meta.url), 'utf8')
    .split('\n').map(w => w.trim().toUpperCase()).filter(Boolean)
);

const chains = [];
for (const s of next.keys()) {
  const walk = path => {
    if (path.length >= 3 && path.length <= 5) {
      const seed = path.map(w => w[0]).join('');
      if (dict.has(seed) && new Set(path).size === path.length)
        chains.push({ seed, words: [...path] });
    }
    if (path.length === 5) return;
    for (const nx of (next.get(path[path.length - 1]) || []))
      if (!path.includes(nx)) walk([...path, nx]);
  };
  walk([s]);
}

const linksOf = w => w.slice(1).map((x, i) => `${w[i]} ${x}`.toLowerCase());

// Rank by how familiar the links are. The supplied word list carries 1-5
// familiarity ratings; anything not in it is assumed a solid 4.
const fam = new Map();
try {
  const raw = readFileSync('/Users/clark/Downloads/Source/links/files/before_after_1000_game_words.txt', 'utf8');
  for (const ln of raw.split('\n')) {
    const m = ln.match(/^\s*([a-zA-Z]+ [a-zA-Z]+)\s*\|\s*(\d)\/5/);
    if (m) fam.set(m[1].toLowerCase(), Number(m[2]));
  }
} catch (e) { /* file optional */ }
const score = w => linksOf(w).reduce((t, l) => t + (fam.get(l) ?? 4), 0) / (w.length - 1);

// keep the single best-scoring chain per seed
const best = new Map();
for (const c of chains) {
  const sc = score(c.words);
  const cur = best.get(c.seed);
  if (!cur || sc > cur.sc) best.set(c.seed, { ...c, sc });
}
const picked = [...best.values()].sort((a, b) => b.sc - a.sc || a.seed.localeCompare(b.seed));

const emit = process.argv.includes('--emit');
if (emit) {
  console.log(JSON.stringify(picked.map(c => ({
    seed: c.seed, words: c.words, links: linksOf(c.words)
  })), null, 2));
} else {
  const by = { 3: 0, 4: 0, 5: 0 };
  picked.forEach(c => by[c.words.length]++);
  console.log(`vocabulary: ${PAIRS.length} pairs, ${next.size} words that can start a link`);
  console.log(`chains found: ${chains.length}`);
  console.log(`best chain per common seed: ${picked.length}`);
  for (const n of [3, 4, 5]) console.log(`  ${n}-word: ${by[n]}`);
  const avg = picked.reduce((t, c) => t + c.sc, 0) / picked.length;
  console.log(`mean link familiarity: ${avg.toFixed(2)} / 5`);
}
