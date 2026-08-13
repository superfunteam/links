#!/usr/bin/env node
// Injects puzzles.json into index.html as base64, so view-source doesn't spoil answers.
// Usage: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const puzzles = JSON.parse(readFileSync('puzzles.json', 'utf8'));

// ── validate before shipping ──────────────────────────────────────────
let errors = [];
puzzles.forEach((c, ci) => {
  if (!c.name) errors.push(`course ${ci}: missing name`);
  if (!Array.isArray(c.holes) || c.holes.length !== 3) errors.push(`${c.name}: needs exactly 3 holes`);
  (c.holes || []).forEach((h, hi) => {
    const where = `${c.name} hole ${hi + 1} (${h.seed})`;
    if (!/^[A-Z]{3,5}$/.test(h.seed)) errors.push(`${where}: seed must be 3-5 uppercase letters`);
    if (h.words.length !== h.seed.length) errors.push(`${where}: ${h.words.length} words for a ${h.seed.length}-letter seed`);
    h.words.forEach((w, i) => {
      if (!/^[A-Z]+$/.test(w)) errors.push(`${where}: "${w}" must be A-Z only`);
      if (w[0] !== h.seed[i]) errors.push(`${where}: "${w}" should start with "${h.seed[i]}"`);
    });
    if (h.links && h.links.length !== h.words.length - 1) errors.push(`${where}: expected ${h.words.length - 1} links, got ${h.links.length}`);
    (h.links || []).forEach((l, i) => {
      const expect = `${h.words[i]} ${h.words[i + 1]}`.toLowerCase();
      if (l.toLowerCase() !== expect) errors.push(`${where}: link "${l}" should read "${expect}"`);
    });
    if (new Set(h.words).size !== h.words.length) errors.push(`${where}: repeats a word within the chain`);
    Object.entries(h.alts || {}).forEach(([k, list]) => {
      const idx = Number(k);
      if (!(idx > 0 && idx < h.words.length)) errors.push(`${where}: alt index ${k} out of range`);
      list.forEach(a => {
        if (a[0] !== h.seed[idx]) errors.push(`${where}: alt "${a}" should start with "${h.seed[idx]}"`);
      });
    });
  });
});
// a link or a seed appearing twice across the set makes the game feel repetitive
const seenSeed = new Map(), seenLink = new Map();
puzzles.forEach(c => c.holes.forEach(h => {
  if (seenSeed.has(h.seed)) errors.push(`seed ${h.seed} reused (${seenSeed.get(h.seed)} and ${c.name})`);
  seenSeed.set(h.seed, c.name);
  h.words.slice(1).forEach((w, i) => {
    const pair = `${h.words[i]} ${w}`;
    if (seenLink.has(pair)) errors.push(`link "${pair.toLowerCase()}" reused (${seenLink.get(pair)} and ${c.name}/${h.seed})`);
    seenLink.set(pair, `${c.name}/${h.seed}`);
  });
}));

if (errors.length) { console.error('✗ puzzles.json failed validation:\n  ' + errors.join('\n  ')); process.exit(1); }

// ── inject ────────────────────────────────────────────────────────────
const b64 = Buffer.from(JSON.stringify(puzzles), 'utf8').toString('base64');
let html = readFileSync('index.html', 'utf8');
const slot = /const PUZZLE_B64 = "[^"]*";/;
// test for the slot rather than for a changed string — rebuilding unchanged data is a no-op, not a failure
if (!slot.test(html)) { console.error('✗ could not find PUZZLE_B64 in index.html'); process.exit(1); }
html = html.replace(slot, `const PUZZLE_B64 = "${b64}";`);

const holes = puzzles.flatMap(c => c.holes);
html = html.replace(/<p class="foot">[^<]*<\/p>/,
  `<p class="foot">${puzzles.length} courses, ${puzzles[0].holes.length} holes each.</p>`);

writeFileSync('index.html', html);
const totalPar = holes.reduce((s, h) => { const b = h.words.length - 1; return s + b + (b >= 4 ? 2 : 1); }, 0);
console.log(`✓ ${puzzles.length} courses · ${holes.length} holes · total par ${totalPar} · ${b64.length} bytes injected`);
