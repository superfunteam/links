#!/usr/bin/env node
// Validates the hole pool, schedules it into daily 5-hole courses, and injects
// the result into index.html as base64 so view-source doesn't spoil answers.
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const HOLES_PER_DAY = 5;
const COOLDOWN_DAYS = 3;          // a link may not return inside this window
// The calendar rolls: it always reaches 24 days past today (US Eastern), so a
// rebuild — including one triggered from the backroom — keeps the horizon full.
const HORIZON_AHEAD = 24;
const SEED_COOLDOWN = 28;          // a seed may return, but never inside a month
const ECHO_WINDOW = 10;            // days within which two chains may not rhyme
const ECHO_SHARE = 3;              // ...meaning share this many words or more
// How many of the day's 5 holes are full-length (5-word) chains, by weekday.
// The week still climbs to a heavier weekend, but the numbers are scaled to the
// supply of five-word chains — those need four strong links in a row with every
// initial fixed, so they are and will remain the scarce resource.
const LONG_BY_WEEKDAY = { Mon: 1, Tue: 2, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 5 };
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

// ── outside data: approved drafts join the pool, frozen days pin history ──
// Three tiers: a direct database connection (local dev), then the live site's
// own backroom API (Netlify builds, which have no database credentials), then
// the repo pool alone. Whichever answers first wins.
let sql = null;
let writeFreeze = null;            // async (newDays) => how many were saved
let dbStatus = 'repo-only';
const frozen = new Map();          // date -> {name, holes}
const DB_URL = process.env.NETLIFY_DB_URL || process.env.NETLIFY_DATABASE_URL || null;
const SITE = process.env.URL || 'https://links.superfun.games';
const BR_KEY = process.env.BACKROOM_KEY || 'superfunlinks';

const absorb = (draftRows, frozenRows) => {
  let added = 0;
  for (const d of draftRows) {
    const key = d.words.join(' ');
    if (seen.has(key)) continue;
    seen.set(key, -1);
    holes.push({ seed: d.seed, words: d.words, links: d.links });
    added++;
  }
  frozenRows.forEach(r => frozen.set(r.day, { name: r.name, holes: r.holes }));
  console.log(`db: ${added} draft(s) joined the pool · ${frozenRows.length} day(s) frozen (${dbStatus})`);
};

if (DB_URL) {
  try {
    const { getDatabase } = await import('@netlify/database');
    sql = getDatabase({ connectionString: DB_URL }).sql;
    const drafts = await sql`select seed, words, links from drafts where status = 'approved'`;
    const rows = await sql`select day::text as day, name, holes from schedule_days order by day`;
    dbStatus = 'direct';
    absorb(drafts, rows);
    writeFreeze = async newDays => {
      let saved = 0;
      for (const d of newDays) {
        const res = await sql`
          insert into schedule_days (day, name, holes)
          values (${d.date}::date, ${d.name}, ${JSON.stringify(d.holes)}::jsonb)
          on conflict (day) do nothing returning day`;
        if (res.length) saved++;
      }
      return saved;
    };
  } catch (err) {
    console.log(`db: direct connection failed (${err.message.slice(0, 60)})`);
    sql = null;
  }
}
if (!sql) {
  try {
    const api = async payload => {
      const res = await fetch(`${SITE}/api/backroom`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-key': BR_KEY },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(`api ${res.status}: ${data?.error || 'no body'}`);
      return data;
    };
    const data = await api({ op: 'build_data' });
    dbStatus = 'via-site-api';
    absorb(data.drafts || [], data.frozenDays || []);
    writeFreeze = async newDays => {
      let saved = 0;
      for (let i = 0; i < newDays.length; i += 40) {
        const r = await api({ op: 'freeze', days: newDays.slice(i, i + 40)
          .map(d => ({ date: d.date, name: d.name, holes: d.holes })) });
        saved += r.saved || 0;
      }
      return saved;
    };
  } catch (err) {
    console.log(`db: site api unreachable (${err.message.slice(0, 70)}) — building from the repo pool alone`);
  }
}

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
const recent = [];                 // {day, words:Set} for the echo check
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

const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const end = new Date(todayET + 'T12:00:00Z');
end.setUTCDate(end.getUTCDate() + HORIZON_AHEAD);
const endDate = end.toISOString().slice(0, 10);

// remember which pool entry each chain key points at, so frozen days can
// reclaim their holes from the pool and feed the cooldown state
const byKey = new Map();
holes.forEach(h => byKey.set(h.words.join(' '), h));

const nameUsed = new Map();        // course name -> last day index it appeared

// Pre-pass: register every frozen day's state and reclaim its holes BEFORE
// scheduling anything. A gap being filled earlier in the calendar must see
// the frozen days around it, or it can duplicate a chain a frozen day owns.
for (let idx = 0; dateOf(idx) <= endDate; idx++) {
  const f = frozen.get(dateOf(idx));
  if (!f) continue;
  f.holes.forEach(h => {
    linksOf(h).forEach(l => lastUsed.set(l, idx));
    seedUsed.set(h.seed, idx);
    recent.push({ day: idx, words: new Set(h.words) });
    const live = byKey.get(h.words.join(' '));
    if (live) { const list = pool[h.words.length]; const at = list.indexOf(live); if (at >= 0) list.splice(at, 1); }
  });
  nameUsed.set(f.name, idx);
}

while (!exhausted && dateOf(dayIdx) <= endDate) {
  const date = dateOf(dayIdx);

  // a day that already shipped is replayed into the schedule verbatim
  if (frozen.has(date)) {
    const f = frozen.get(date);
    days.push({ date, name: f.name, holes: f.holes, frozen: true });
    dayIdx++;
    continue;
  }

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
      // Two chains that share most of their words read as the same puzzle even
      // under different seeds — MOUTH OFF LINE AGE RANGE beside PLAY OFF LINE
      // AGE RANGE is the sort of thing a daily player notices immediately.
      const wordSet = new Set(h.words);
      const echoes = recent.some(r => dayIdx - r.day < ECHO_WINDOW &&
        [...r.words].filter(w => wordSet.has(w)).length >= ECHO_SHARE);
      if (echoes) continue;
      pool[len].splice(i, 1);
      ls.forEach(l => { usedToday.add(l); lastUsed.set(l, dayIdx); });
      seedUsed.set(h.seed, dayIdx); usedSeedToday.add(h.seed);
      recent.push({ day: dayIdx, words: wordSet });
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
  // A course name mustn't reappear while anyone would remember it — frozen
  // days included, or a backfill day echoes a name the week already used.
  let name = courseNames[dayIdx % courseNames.length];
  for (let off = 0; off < courseNames.length; off++) {
    const cand = courseNames[(dayIdx + off) % courseNames.length];
    if (!nameUsed.has(cand) || Math.abs(dayIdx - nameUsed.get(cand)) >= 45) { name = cand; break; }
  }
  nameUsed.set(name, dayIdx);
  days.push({ date: dateOf(dayIdx), name, holes: picked });
  dayIdx++;
}

// ── report + inject ───────────────────────────────────────────────────────
const parOf = h => { const b = h.words.length - 1; return b + (b >= 4 ? 2 : 1); };
const payload = { startDate, days: days.map(d => ({ date: d.date, name: d.name, holes: d.holes })) };
const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

let html = readFileSync('index.html', 'utf8');
const slot = /const PUZZLE_B64 = "[^"]*";/;
if (!slot.test(html)) { console.error('✗ could not find PUZZLE_B64 in index.html'); process.exit(1); }
writeFileSync('index.html', html.replace(slot, `const PUZZLE_B64 = "${b64}";`));

// freeze every newly scheduled day so the next build can't move it
if (writeFreeze) {
  try {
    const saved = await writeFreeze(days.filter(d => !d.frozen));
    console.log(`db: froze ${saved} new day(s) (${dbStatus})`);
  } catch (err) { console.log(`db: could not freeze days (${err.message.slice(0, 60)})`); }
} else {
  console.log('db: NOT FROZEN — a later build with a changed pool could reshuffle these days');
}

// modules the backroom function imports — generated, never hand-edited
mkdirSync('netlify/lib', { recursive: true });
const leftovers = [...pool[3], ...pool[4], ...pool[5]];
writeFileSync('netlify/lib/scheduledata.mjs',
  '// generated by build.mjs — do not edit\n' +
  'export const SCHEDULE = ' + JSON.stringify({ builtAt: new Date().toISOString(), dbStatus, days, leftovers }) + ';\n');
writeFileSync('netlify/lib/pairsdata.mjs',
  '// generated by build.mjs — do not edit\n' +
  'export const PAIRS_TEXT = ' + JSON.stringify(readFileSync('tools/pairs.txt', 'utf8')) + ';\n');

const leftover = pool[3].length + pool[4].length + pool[5].length;
console.log(`✓ ${days.length} days scheduled from ${holes.length} holes (${leftover} left over: ${pool[3].length}×3 ${pool[4].length}×4 ${pool[5].length}×5)`);
days.forEach((d, i) => {
  const wd = weekdayOf(i), want = LONG_BY_WEEKDAY[wd];
  const got = d.holes.filter(h => h.words.length === 5).length;
  const flag = d.frozen ? '❄' : got === want ? ' ' : '!';
  console.log(`  ${flag} ${d.date} ${wd}  ${d.name.padEnd(16)} par ${String(d.holes.reduce((s,h)=>s+parOf(h),0)).padStart(3)}  long ${got}/${want}  ${d.holes.map(h=>h.seed).join(' ')}`);
});
const short = days.filter((d,i)=>!d.frozen && d.holes.filter(h=>h.words.length===5).length !== LONG_BY_WEEKDAY[weekdayOf(i)]).length;
if (short) console.log(`\n⚠ ${short} day(s) marked ! could not meet the weekday long-chain quota — pool needs more 5-word chains`);
console.log(`\n${b64.length} bytes injected`);
