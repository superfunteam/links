#!/usr/bin/env node
// Validates the hole pool, schedules it into daily 5-hole courses, and injects
// the result into index.html as base64 so view-source doesn't spoil answers.
// Usage: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const HOLES_PER_DAY = 5;
const COOLDOWN_DAYS = 4;          // a link may not return inside this window
const MAX_DAYS = 62;               // two months of daily courses
const SEED_COOLDOWN = 28;          // a seed may return, but never inside a month
// How many of the day's 5 holes are full-length (5-word) chains, by weekday.
// The week still climbs to a heavier weekend, but the numbers are scaled to the
// supply of five-word chains — those need four strong links in a row with every
// initial fixed, so they are and will remain the scarce resource.
const LONG_BY_WEEKDAY = { Mon: 1, Tue: 1, Wed: 1, Thu: 2, Fri: 2, Sat: 2, Sun: 2 };
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const data = JSON.parse(readFileSync('puzzles.json', 'utf8'));
const { startDate, courseNames, holes } = data;

// ── validate the pool ─────────────────────────────────────────────────────
const errors = [];
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) errors.push('startDate must be YYYY-MM-DD');
const seen = new Map();
holes.forEach((h, i) => {
  const where = `hole ${i} (${h.seed})`;
  if (!/^[A-Z]{3,5}$/.test(h.seed)) errors.push(`${where}: seed must be 3-5 uppercase letters`);
  if (h.words.length !== h.seed.length) errors.push(`${where}: ${h.words.length} words for a ${h.seed.length}-letter seed`);
  h.words.forEach((w, k) => {
    if (!/^[A-Z]+$/.test(w)) errors.push(`${where}: "${w}" must be A-Z only`);
    if (w[0] !== h.seed[k]) errors.push(`${where}: "${w}" should start with "${h.seed[k]}"`);
  });
  if (new Set(h.words).size !== h.words.length) errors.push(`${where}: repeats a word within the chain`);
  (h.links || []).forEach((l, k) => {
    const expect = `${h.words[k]} ${h.words[k + 1]}`.toLowerCase();
    if (l.toLowerCase() !== expect) errors.push(`${where}: link "${l}" should read "${expect}"`);
  });
  if (h.links && h.links.length !== h.words.length - 1) errors.push(`${where}: expected ${h.words.length - 1} links`);
    // A seed may offer several chains. The chain-finder already guarantees any
    // two share at most one word, so only an outright identical chain is a bug.
    const key = h.words.join(' ');
    if (seen.has(key)) errors.push(`${where}: identical chain already in the pool`);
    seen.set(key, i);
});
if (errors.length) { console.error('✗ puzzles.json failed validation:\n  ' + errors.join('\n  ')); process.exit(1); }

// ── schedule the pool into days ───────────────────────────────────────────
const linkOf = (h, i) => `${h.words[i]} ${h.words[i + 1]}`.toLowerCase();
const linksOf = h => h.words.slice(1).map((_, i) => linkOf(h, i));

const pool = { 3: [], 4: [], 5: [] };
holes.forEach(h => pool[h.words.length].push(h));
// Sorting by seed would hand out ADEPT, ADOBE, ALLOT on day one and walk the
// alphabet from there. Shuffle deterministically instead, so a build is
// reproducible but a week's seeds don't look sorted.
const hash = str => { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
Object.values(pool).forEach(list =>
  list.sort((a, b) => hash(a.seed + a.words[1]) - hash(b.seed + b.words[1])));

const lastUsed = new Map();        // link -> day index it last appeared on
const seedUsed = new Map();        // seed -> day index it last appeared on
const days = [];
let dayIdx = 0, exhausted = false;

const weekdayOf = n => {
  const d = new Date(startDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return WD[d.getUTCDay()];
};
const dateOf = n => {
  const d = new Date(startDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

while (!exhausted && dayIdx < MAX_DAYS) {
  const wd = weekdayOf(dayIdx);
  const wantLong = LONG_BY_WEEKDAY[wd];
  const picked = [], usedToday = new Set(), usedSeedToday = new Set();

  const take = (len) => {
    for (let i = 0; i < pool[len].length; i++) {
      const h = pool[len][i];
      const ls = linksOf(h);
      if (ls.some(l => usedToday.has(l))) continue;
      if (ls.some(l => lastUsed.has(l) && dayIdx - lastUsed.get(l) < COOLDOWN_DAYS)) continue;
      if (seedUsed.has(h.seed) && dayIdx - seedUsed.get(h.seed) < SEED_COOLDOWN) continue;
      if (usedSeedToday.has(h.seed)) continue;
      pool[len].splice(i, 1);
      ls.forEach(l => { usedToday.add(l); lastUsed.set(l, dayIdx); });
      seedUsed.set(h.seed, dayIdx); usedSeedToday.add(h.seed);
      return h;
    }
    return null;
  };

  for (let i = 0; i < wantLong; i++) { const h = take(5); if (h) picked.push(h); }
  // fill the rest with shorter chains, preferring 3s early in the week
  const shortOrder = wantLong >= 4 ? [4, 3] : [3, 4];
  while (picked.length < HOLES_PER_DAY) {
    let h = null;
    for (const len of shortOrder) { h = take(len); if (h) break; }
    if (!h) h = take(5);
    if (!h) break;
    picked.push(h);
  }

  if (picked.length < HOLES_PER_DAY) {           // pool spent — stop cleanly
    picked.forEach(h => pool[h.words.length].push(h));
    exhausted = true;
    break;
  }
  picked.sort((a, b) => a.words.length - b.words.length);   // ramp within the day
  days.push({
    date: dateOf(dayIdx),
    name: courseNames[dayIdx % courseNames.length],
    holes: picked
  });
  dayIdx++;
}

// ── report + inject ───────────────────────────────────────────────────────
const parOf = h => { const b = h.words.length - 1; return b + (b >= 4 ? 2 : 1); };
const payload = { startDate, days };
const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

let html = readFileSync('index.html', 'utf8');
const slot = /const PUZZLE_B64 = "[^"]*";/;
if (!slot.test(html)) { console.error('✗ could not find PUZZLE_B64 in index.html'); process.exit(1); }
writeFileSync('index.html', html.replace(slot, `const PUZZLE_B64 = "${b64}";`));

const leftover = pool[3].length + pool[4].length + pool[5].length;
console.log(`✓ ${days.length} days scheduled from ${holes.length} holes (${leftover} left over: ${pool[3].length}×3 ${pool[4].length}×4 ${pool[5].length}×5)`);
days.forEach((d, i) => {
  const wd = weekdayOf(i), want = LONG_BY_WEEKDAY[wd];
  const got = d.holes.filter(h => h.words.length === 5).length;
  const flag = got === want ? ' ' : '!';
  console.log(`  ${flag} ${d.date} ${wd}  ${d.name.padEnd(16)} par ${String(d.holes.reduce((s,h)=>s+parOf(h),0)).padStart(3)}  long ${got}/${want}  ${d.holes.map(h=>h.seed).join(' ')}`);
});
const short = days.filter((d,i)=>d.holes.filter(h=>h.words.length===5).length !== LONG_BY_WEEKDAY[weekdayOf(i)]).length;
if (short) console.log(`\n⚠ ${short} day(s) marked ! could not meet the weekday long-chain quota — pool needs more 5-word chains`);
console.log(`\n${b64.length} bytes injected`);
