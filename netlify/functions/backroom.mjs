// The backroom API: named staff with roles, one op switch, every change in the
// audit log. The live schedule comes from schedule_days in the database; the
// baked SCHEDULE is only consulted for the reserve pool (leftovers) and the
// build stamp. Build-machine ops (build_data / freeze / refreeze) sit behind a
// separate x-build-key header and keep their original semantics exactly.
import { db, json, bad, oops, readJson, todayET, courseKey, cleanEmail, overLimit, DATE_RE } from '../lib/db.mjs';
import { SCHEDULE } from '../lib/scheduledata.mjs';
import { PAIRS_TEXT } from '../lib/pairsdata.mjs';
import {
  hashPassword, verifyPassword, burnPasswordCheck, secretEquals, tempPassword, settle,
  hasRole, publicMe, createSession, sessionStaff, revokeSession, revokeAllFor, audit, ROLES
} from '../lib/staff.mjs';
import {
  norm, linksOf, parOf, normHole, checkChain, checkDay, dayWarnings, checkNod, daysBetween
} from '../lib/chain.mjs';

const KNOWN = new Set(PAIRS_TEXT.split('\n').map(l => l.trim()).filter(Boolean));
const LONG_BY_WEEKDAY = [5, 1, 2, 2, 3, 4, 5];        // Sun..Sat five-word holes per day
const DEFAULT_ORG = { name: 'Links', accent: '#22A070', sponsorLabel: '' };
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const READ_OPS = new Set(['auth_logout', 'me', 'account_password', 'dashboard', 'calendar', 'day', 'day_check',
  'puzzles', 'puzzle_check', 'analytics', 'activity', 'errors']);
const EDITOR_OPS = new Set(['day_save', 'nod_save', 'puzzle_save', 'puzzle_archive', 'publish']);
const OWNER_OPS = new Set(['team', 'team_invite', 'team_update', 'team_remove', 'settings', 'settings_save', 'delete_player']);
const BUILD_OPS = new Set(['build_data', 'freeze', 'refreeze']);

const holeStrokes = m => (m || []).reduce((t, x) => t + (x.g || 0) + (x.b || 0), 0);
const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const validDate = v => DATE_RE.test(String(v || '')) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'))
  && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
const statusOf = (date, today, hasRow) =>
  date < today ? 'past' : date === today ? 'live' : hasRow ? 'scheduled' : 'auto';
const staffName = v => {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFKC').replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || null;
};
const cleanText = (v, max) => String(v ?? '').normalize('NFKC').replace(/[\u0000-\u001F\u007F<>]/g, '')
  .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const passwordOk = p => typeof p === 'string' && p.length >= 10 && p.length <= 200;

async function getSetting(sql, key) {
  const rows = await sql`select value from org_settings where key = ${key}`;
  return rows.length ? rows[0].value : null;
}
async function setSetting(sql, key, value) {
  await sql`
    insert into org_settings (key, value, updated_at) values (${key}, ${JSON.stringify(value)}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
const orgOf = async sql => ({ ...DEFAULT_ORG, ...((await getSetting(sql, 'org')) || {}) });
const lastPublishAt = async sql => (await getSetting(sql, 'last_publish'))?.at || null;

/** Reserve + approved chains never scheduled (past or future), counted by length. */
async function runwayOf(sql) {
  const [approved, scheduled] = await Promise.all([
    sql`select words from drafts where status = 'approved'`,
    sql`select holes from schedule_days`,   // past days too: build.mjs never reuses a served chain
  ]);
  const used = new Set();
  scheduled.forEach(r => (r.holes || []).forEach(h => used.add((h.words || []).join(' '))));
  const pool = new Map();
  for (const h of SCHEDULE.leftovers || []) pool.set(h.words.join(' '), h.words.length);
  for (const d of approved) if (Array.isArray(d.words)) pool.set(d.words.join(' '), d.words.length);
  const byLength = { 3: 0, 4: 0, 5: 0 };
  for (const [key, len] of pool) if (!used.has(key) && byLength[len] != null) byLength[len]++;
  // walk forward from tomorrow, consuming five-word chains at the weekday rate
  let five = byLength[5], days = 0;
  let wd = new Date(todayET() + 'T12:00:00Z').getUTCDay();
  while (days < 3650) {
    wd = (wd + 1) % 7;
    if (five < LONG_BY_WEEKDAY[wd]) break;
    five -= LONG_BY_WEEKDAY[wd]; days++;
  }
  return { byLength, fiveWordWeeks: +(byLength[5] / 21).toFixed(1), fiveWordDays: days };
}

const nodRowsToMap = rows => {
  const out = {};
  rows.forEach(r => { out[r.hole_idx] = { icon: r.icon, text: r.text, label: r.label, url: r.url }; });
  return out;
};

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const op = String(body.op || '');
  const sql = db();
  const today = todayET();

  try {
    // ── build machine ───────────────────────────────────────────────────────
    // Netlify's build environment has no database credentials, but it can
    // reach this very function on the live site — which does.
    if (BUILD_OPS.has(op)) {
      const key = process.env.BACKROOM_KEY;
      if (!key || !secretEquals(req.headers.get('x-build-key') || '', key)) return bad('Not authorised.', 401);
      return await buildOp(sql, op, body);
    }

    // ── signed out ──────────────────────────────────────────────────────────
    if (op === 'auth_status') {
      const [{ n }] = await sql`select count(*)::int as n from staff`;
      return json({ ok: true, needsSetup: n === 0 });
    }

    if (op === 'auth_setup') {
      const key = process.env.BACKROOM_KEY;
      const ip = req.headers.get('x-nf-client-connection-ip') || 'anon';
      if (await overLimit(sql, `brsetup:${ip}`, 20, 60)) return bad('Too many attempts. Try again later.', 429);
      if (!key) return bad('Setup is not available on this site.', 403);
      if (!secretEquals(body.setupKey || '', key)) return bad('That setup key is not right.', 403);
      const email = cleanEmail(body.email), name = staffName(body.name);
      if (!email) return bad('Enter a valid email address.');
      if (!name) return bad('Enter your name.');
      if (!passwordOk(body.password)) return bad('Passwords need at least 10 characters.');
      // Claim a short-lived lock row first: the primary key admits one winner, so two
      // simultaneous setups cannot both pass the "staff is empty" check below.
      const claim = await sql`
        insert into org_settings (key, value, updated_at) values ('setup_lock', '{}'::jsonb, now())
        on conflict (key) do update set updated_at = now()
          where org_settings.updated_at < now() - interval '30 seconds'
        returning key`;
      if (!claim.length) return bad('Setup is already in progress. Try again in a minute.', 409);
      const pw = await hashPassword(body.password);
      const rows = await sql`
        insert into staff (email, name, role, pw_hash)
        select ${email}, ${name}, 'owner', ${pw}
        where not exists (select 1 from staff)
        returning id, email, name, role`;
      if (!rows.length) return bad('This backroom is already set up. Sign in instead.', 409);
      const me = { ...rows[0], id: Number(rows[0].id) };
      const token = await createSession(sql, me.id);
      await audit(sql, me, 'auth.setup', email);
      return json({ ok: true, token, me: publicMe(me) });
    }

    if (op === 'auth_login') {
      const started = Date.now();
      const email = cleanEmail(body.email);
      const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
      const vague = async () => { await settle(started); return bad('That email and password do not match.', 401); };
      if (!email || !password) { await burnPasswordCheck(password); return vague(); }
      // Atomic counters first (one upsert each), so a burst of parallel guesses
      // cannot all slip past the failure count below before any is recorded.
      const ip = req.headers.get('x-nf-client-connection-ip') || 'anon';
      if (await overLimit(sql, `brlogin:${email}`, 8, 15) || await overLimit(sql, `brlogin-ip:${ip}`, 40, 15)) {
        await settle(started); return bad('Too many attempts. Try again in 15 minutes.', 429);
      }
      const [{ fails }] = await sql`
        select count(*)::int as fails from staff_login_attempts
        where email = ${email} and not ok and at > now() - interval '15 minutes'`;
      if (fails >= 8) { await settle(started); return bad('Too many attempts. Try again in 15 minutes.', 429); }
      const rows = await sql`select id, email, name, role, pw_hash, disabled from staff where email = ${email}`;
      const s = rows[0];
      const ok = s ? await verifyPassword(password, s.pw_hash) : await burnPasswordCheck(password);
      await sql`insert into staff_login_attempts (email, ok) values (${email}, ${!!(ok && s && !s.disabled)})`;
      if (!ok || !s || s.disabled) return vague();
      const me = { id: Number(s.id), email: s.email, name: s.name, role: s.role };
      await sql`delete from rate_limits where key = ${'brlogin:' + email}`;   // a success clears the email budget
      const token = await createSession(sql, me.id);
      await sql`update staff set last_seen = now() where id = ${me.id}::bigint`;
      await audit(sql, me, 'auth.login', me.email);
      await settle(started);
      return json({ ok: true, token, me: publicMe(me) });
    }

    // ── signed in ───────────────────────────────────────────────────────────
    const known = READ_OPS.has(op) || EDITOR_OPS.has(op) || OWNER_OPS.has(op);
    if (!known) return bad('Unknown request.');
    const me = await sessionStaff(sql, req);
    if (!me) return bad('Your session has ended. Sign in again.', 401);
    if (EDITOR_OPS.has(op) && !hasRole(me, 'editor')) return bad('Your role can view but not edit.', 403);
    if (OWNER_OPS.has(op) && !hasRole(me, 'owner')) return bad('Only an owner can do that.', 403);

    switch (op) {

      case 'auth_logout': {
        await revokeSession(sql, me.tokenHash);
        await audit(sql, me, 'auth.logout', me.email);
        return json({ ok: true });
      }

      case 'me':
        return json({ ok: true, me: publicMe(me), org: await orgOf(sql) });

      case 'account_password': {
        if (!passwordOk(body.next)) return bad('New passwords need at least 10 characters.');
        const [row] = await sql`select pw_hash from staff where id = ${me.id}::bigint`;
        if (!row || !(await verifyPassword(String(body.current || '').slice(0, 200), row.pw_hash)))
          return bad('Your current password is not right.', 403);
        await sql`update staff set pw_hash = ${await hashPassword(body.next)} where id = ${me.id}::bigint`;
        await revokeAllFor(sql, me.id, me.tokenHash);
        await audit(sql, me, 'account.password', me.email);
        return json({ ok: true });
      }

      case 'dashboard': {
        const since14 = addDays(today, -13), since7 = addDays(today, -6);
        const [[k], plays, upcomingRows, nodCounts, recent, runway, lastPub] = await Promise.all([
          sql`select
                (select count(*)::int from players) as players,
                (select count(*)::int from players where seen_at > now() - interval '7 days') as active7,
                (select count(*)::int from rounds where play_date = ${today}::date) as rounds_today,
                (select count(*)::int from rounds where play_date >= ${since7}::date) as rounds7,
                (select count(*)::int from events where kind = 'round_start' and day >= ${since7}::date) as starts7,
                (select count(*)::int from events where kind = 'nod_click' and created_at > now() - interval '7 days') as nod_clicks7`,
          sql`select g.d::date::text as date, count(r.player_id)::int as rounds
              from generate_series(${since14}::date, ${today}::date, interval '1 day') g(d)
              left join rounds r on r.play_date = g.d::date
              group by g.d order by g.d`,
          sql`select day::text as date, name, holes from schedule_days
              where day between ${today}::date and ${addDays(today, 6)}::date order by day`,
          sql`select day::text as date, count(*)::int as n from hole_nods
              where day between ${today}::date and ${addDays(today, 6)}::date group by day`,
          sql`select id, at, actor, action, target, detail from audit_log order by id desc limit 8`,
          runwayOf(sql),
          lastPublishAt(sql),
        ]);
        const [{ unpublished }] = await sql`
          select count(*)::int as unpublished from schedule_days
          where updated_by is not null and (${lastPub}::timestamptz is null or updated_at > ${lastPub}::timestamptz)`;
        const rowBy = Object.fromEntries(upcomingRows.map(r => [r.date, r]));
        const nodsBy = Object.fromEntries(nodCounts.map(r => [r.date, r.n]));
        const upcoming = [];
        for (let i = 0; i < 7; i++) {
          const date = addDays(today, i), r = rowBy[date];
          upcoming.push({ date, name: r?.name || null, seeds: r ? (r.holes || []).map(h => h.seed) : [],
                          status: statusOf(date, today, !!r), nods: nodsBy[date] || 0 });
        }
        return json({ ok: true,
          kpis: { players: k.players, active7: k.active7, roundsToday: k.rounds_today, rounds7: k.rounds7,
                  completion7: k.starts7 ? Math.min(1, +(k.rounds7 / k.starts7).toFixed(3)) : null,
                  nodClicks7: k.nod_clicks7 },
          plays14: plays, runway, upcoming, recent: recent.map(auditRow),
          build: { builtAt: SCHEDULE.builtAt || null, dbStatus: SCHEDULE.dbStatus || 'unknown',
                   lastPublishAt: lastPub, unpublished } });
      }

      case 'calendar': {
        const month = MONTH_RE.test(String(body.month || '')) ? body.month : today.slice(0, 7);
        const first = month + '-01';
        const next = addDays(first, 40).slice(0, 7) + '-01';
        const last = addDays(next, -1);
        const [rows, plays, nods, lastPub] = await Promise.all([
          sql`select day::text as date, name, holes, updated_at, updated_by from schedule_days
              where day between ${first}::date and ${last}::date`,
          sql`select play_date::text as date, count(*)::int as n from rounds
              where play_date between ${first}::date and ${last}::date group by play_date`,
          sql`select day::text as date, count(*)::int as n from hole_nods
              where day between ${first}::date and ${last}::date group by day`,
          lastPublishAt(sql),
        ]);
        const rowBy = Object.fromEntries(rows.map(r => [r.date, r]));
        const playsBy = Object.fromEntries(plays.map(r => [r.date, r.n]));
        const nodsBy = Object.fromEntries(nods.map(r => [r.date, r.n]));
        const pub = lastPub ? Date.parse(lastPub) : null;
        const days = [];
        for (let date = first; date <= last; date = addDays(date, 1)) {
          const r = rowBy[date], holes = r?.holes || [];
          days.push({ date, name: r?.name || null, status: statusOf(date, today, !!r),
            seeds: holes.map(h => h.seed), lengths: holes.map(h => (h.words || []).length),
            nods: nodsBy[date] || 0, plays: playsBy[date] || 0,
            unpublished: !!(r && r.updated_by != null && (pub == null || new Date(r.updated_at).getTime() > pub)) });
        }
        return json({ ok: true, month, today, days });
      }

      case 'day': {
        if (!validDate(body.date)) return bad('That is not a date.');
        const date = body.date;
        const [rows, nodRows, rounds] = await Promise.all([
          sql`select name, holes from schedule_days where day = ${date}::date`,
          sql`select hole_idx, icon, text, label, url from hole_nods where day = ${date}::date order by hole_idx`,
          sql`select strokes, par, marks from rounds where play_date = ${date}::date`,
        ]);
        const row = rows[0];
        const nods = nodRowsToMap(nodRows);
        const holes = (row?.holes || []).map((h, i) => ({
          seed: h.seed, words: h.words, links: h.links || linksOf(h.words || []),
          ...(h.alts ? { alts: h.alts } : {}), ...(nods[i] ? { nod: nods[i] } : {}) }));
        const perHole = holes.map((_, i) => {
          const per = rounds.map(r => (r.marks || [])[i]).filter(Boolean).map(holeStrokes);
          return { avg: per.length ? +(per.reduce((a, b) => a + b, 0) / per.length).toFixed(2) : null,
                   worst: per.length ? Math.max(...per) : null };
        });
        const avgVsPar = rounds.length
          ? +(rounds.reduce((t, r) => t + (r.strokes - r.par), 0) / rounds.length).toFixed(2) : null;
        return json({ ok: true, date, name: row?.name || null, status: statusOf(date, today, !!row),
          editable: date > today, holes,
          stats: { plays: rounds.length, avgVsPar, perHole },
          courseKey: holes.length ? courseKey(holes) : null });
      }

      case 'day_check': {
        if (!validDate(body.date)) return bad('That is not a date.');
        return json({ ok: true, ...(await checkDayFull(sql, body.date, cleanText(body.name, 40), body.holes)) });
      }

      case 'day_save': {
        if (!validDate(body.date)) return bad('That is not a date.');
        const date = body.date;
        if (!(date > today)) return bad('Only future days can be edited.', 409);
        // validate the cleaned name, so '<>' or zero-width-only names cannot pass and store as ''
        const name = cleanText(body.name, 40);
        const { errors, warnings } = await checkDayFull(sql, date, name, body.holes);
        if (errors.length) return json({ ok: false, error: 'Fix the highlighted problems first.', errors, warnings }, 422);
        const holes = body.holes.map(normHole);
        const prev = await sql`select name, holes from schedule_days where day = ${date}::date`;
        await sql`
          insert into schedule_days (day, name, holes, updated_at, updated_by)
          values (${date}::date, ${name}, ${JSON.stringify(holes)}::jsonb, now(), ${me.id}::bigint)
          on conflict (day) do update set name = excluded.name, holes = excluded.holes,
            updated_at = now(), updated_by = excluded.updated_by`;
        await audit(sql, me, 'day.save', date, {
          name, seeds: holes.map(h => h.seed),
          before: prev[0] ? { name: prev[0].name, seeds: (prev[0].holes || []).map(h => h.seed) } : null });
        return json({ ok: true, warnings });
      }

      case 'nod_save': {
        if (!validDate(body.date)) return bad('That is not a date.');
        const hole = Number(body.hole);
        if (!Number.isInteger(hole) || hole < 0 || hole > 11) return bad('That hole does not exist.');
        const [row] = await sql`select holes from schedule_days where day = ${body.date}::date`;
        if (!row) return bad('Save this day\'s course before adding nods.', 409);
        if (hole >= (row.holes || []).length) return bad('That hole does not exist.');
        if (body.nod == null) {
          await sql`delete from hole_nods where day = ${body.date}::date and hole_idx = ${hole}::smallint`;
          await audit(sql, me, 'nod.delete', `${body.date}#${hole + 1}`);
          return json({ ok: true, nod: null });
        }
        const { errors, nod } = checkNod(body.nod);
        if (errors.length) return json({ ok: false, error: errors[0], errors }, 422);
        await sql`
          insert into hole_nods (day, hole_idx, icon, text, label, url, updated_by, updated_at)
          values (${body.date}::date, ${hole}::smallint, ${nod.icon}, ${nod.text}, ${nod.label}, ${nod.url}, ${me.id}::bigint, now())
          on conflict (day, hole_idx) do update set icon = excluded.icon, text = excluded.text,
            label = excluded.label, url = excluded.url, updated_by = excluded.updated_by, updated_at = now()`;
        await audit(sql, me, 'nod.save', `${body.date}#${hole + 1}`, nod);
        return json({ ok: true, nod });
      }

      case 'puzzles': {
        const q = norm(body.q).replace(/[^A-Z ]/g, '').slice(0, 20);
        const len = [3, 4, 5].includes(Number(body.len)) ? Number(body.len) : null;
        const status = ['draft', 'approved', 'archived', 'reserve'].includes(body.status) ? body.status : null;
        const [drafts, scheduled, runway] = await Promise.all([
          sql`select d.id, d.seed, d.words, d.links, d.status, d.updated_at, d.created_at, s.name as created_by
              from drafts d left join staff s on s.id = d.created_by order by d.id desc limit 1000`,
          sql`select holes from schedule_days`,
          runwayOf(sql),
        ]);
        const taken = new Set();
        scheduled.forEach(r => (r.holes || []).forEach(h => taken.add((h.words || []).join(' '))));
        const items = [];
        const inDrafts = new Set();
        for (const d of drafts) {
          inDrafts.add((d.words || []).join(' '));
          items.push({ id: Number(d.id), seed: d.seed, words: d.words, links: d.links, status: d.status,
                       createdBy: d.created_by || null, updatedAt: d.updated_at || d.created_at });
        }
        for (const h of SCHEDULE.leftovers || []) {
          const key = h.words.join(' ');
          if (inDrafts.has(key) || taken.has(key)) continue;
          items.push({ id: null, seed: h.seed, words: h.words, links: h.links || linksOf(h.words),
                       status: 'reserve', createdBy: null, updatedAt: null });
        }
        const filtered = items.filter(it =>
          (!len || it.words.length === len) && (!status || it.status === status) &&
          (!q || it.seed.includes(q) || it.words.join(' ').includes(q)));
        return json({ ok: true, items: filtered.slice(0, 1000), runway });
      }

      case 'puzzle_check': {
        return json({ ok: true, ...(await checkPuzzle(sql, body)) });
      }

      case 'puzzle_save': {
        const status = body.status === 'approved' ? 'approved' : body.status === 'draft' ? 'draft' : null;
        if (!status) return bad('Status must be draft or approved.');
        const res = await checkPuzzle(sql, body);
        if (res.errors.length) return json({ ok: false, error: res.errors[0].msg, ...res }, 422);
        const seed = norm(body.seed), words = body.words.map(norm), links = linksOf(words);
        let id = body.id != null ? Number(body.id) : null;
        if (id != null) {
          if (!Number.isInteger(id) || id <= 0) return bad('That puzzle does not exist.', 404);
          const rows = await sql`
            update drafts set seed = ${seed}, words = ${JSON.stringify(words)}::jsonb,
              links = ${JSON.stringify(links)}::jsonb, status = ${status}, updated_at = now()
            where id = ${id}::bigint returning id`;
          if (!rows.length) return bad('That puzzle does not exist.', 404);
        } else {
          const [row] = await sql`
            insert into drafts (seed, words, links, status, created_by, updated_at)
            values (${seed}, ${JSON.stringify(words)}::jsonb, ${JSON.stringify(links)}::jsonb, ${status}, ${me.id}::bigint, now())
            returning id`;
          id = Number(row.id);
        }
        await audit(sql, me, body.id != null ? 'puzzle.update' : 'puzzle.create', `${seed} #${id}`, { words, status });
        return json({ ok: true, id, links: res.links, par: res.par });
      }

      case 'puzzle_archive': {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) return bad('That puzzle does not exist.', 404);
        const rows = await sql`update drafts set status = 'archived', updated_at = now()
                               where id = ${id}::bigint returning seed`;
        if (!rows.length) return bad('That puzzle does not exist.', 404);
        await audit(sql, me, 'puzzle.archive', `${rows[0].seed} #${id}`);
        return json({ ok: true });
      }

      case 'analytics': {
        let to = validDate(body.to) ? body.to : today;
        let from = validDate(body.from) ? body.from : addDays(to, -29);
        if (from > to) [from, to] = [to, from];
        if (daysBetween(from, to) > 365) from = addDays(to, -365);
        const [names, rounds, ev, [players]] = await Promise.all([
          sql`select day::text as date, name from schedule_days where day between ${from}::date and ${to}::date`,
          sql`select play_date::text as date, count(*)::int as plays,
                     round(avg(strokes - par), 2)::float as avg_vs_par,
                     count(*) filter (where strokes < par)::int as under_par,
                     sum(strokes - par)::int as diff_sum
              from rounds where play_date between ${from}::date and ${to}::date group by play_date`,
          sql`select day::text as date,
                     count(*) filter (where kind = 'round_start')::int as starts,
                     count(*) filter (where kind = 'nod_click')::int as nod_clicks
              from events where day between ${from}::date and ${to}::date
                and kind in ('round_start', 'nod_click') group by day`,
          sql`select count(distinct player_id)::int as n from rounds
              where play_date between ${from}::date and ${to}::date`,
        ]);
        const nameBy = Object.fromEntries(names.map(r => [r.date, r.name]));
        const rBy = Object.fromEntries(rounds.map(r => [r.date, r]));
        const eBy = Object.fromEntries(ev.map(r => [r.date, r]));
        const days = [];
        const t = { plays: 0, starts: 0, underPar: 0, nodClicks: 0, diffSum: 0 };
        for (let date = from; date <= to; date = addDays(date, 1)) {
          const r = rBy[date], e = eBy[date];
          const plays = r?.plays || 0, starts = e?.starts || 0;
          days.push({ date, name: nameBy[date] || null, plays, starts,
            completion: starts ? Math.min(1, +(plays / starts).toFixed(3)) : null,
            avgVsPar: r ? r.avg_vs_par : null, underPar: r?.under_par || 0, nodClicks: e?.nod_clicks || 0 });
          t.plays += plays; t.starts += starts; t.underPar += r?.under_par || 0;
          t.nodClicks += e?.nod_clicks || 0; t.diffSum += r?.diff_sum || 0;
        }
        return json({ ok: true, from, to, days, totals: {
          plays: t.plays, starts: t.starts, players: players.n,
          completion: t.starts ? Math.min(1, +(t.plays / t.starts).toFixed(3)) : null,
          avgVsPar: t.plays ? +(t.diffSum / t.plays).toFixed(2) : null,
          underPar: t.underPar, nodClicks: t.nodClicks } });
      }

      case 'activity': {
        const before = Number.isInteger(Number(body.before)) && Number(body.before) > 0 ? Number(body.before) : null;
        const rows = await sql`
          select id, at, actor, action, target, detail from audit_log
          where (${before}::bigint is null or id < ${before}::bigint)
          order by id desc limit 51`;
        const page = rows.slice(0, 50).map(auditRow);
        return json({ ok: true, items: page, next: rows.length > 50 ? page[page.length - 1].id : null });
      }

      case 'errors': {
        const rows = await sql`select ref, op, message, at from error_log order by at desc limit 50`;
        return json({ ok: true, items: rows, errors: rows });
      }

      case 'publish': {
        const hook = process.env.BUILD_HOOK_URL;
        if (!hook) return bad('Publishing is not configured on this site yet.', 503);
        const res = await fetch(hook, { method: 'POST' });
        if (!res.ok) {
          await audit(sql, me, 'publish.failed', null, { status: res.status });
          return bad('The build service did not accept the publish. Try again in a minute.', 502);
        }
        const at = new Date().toISOString();
        await setSetting(sql, 'last_publish', { at, by: me.name });
        await audit(sql, me, 'publish', null, { at });
        return json({ ok: true, lastPublishAt: at });
      }

      // ── owner ─────────────────────────────────────────────────────────────
      case 'team': {
        const rows = await sql`select id, email, name, role, last_seen, created_at, disabled from staff order by created_at, id`;
        return json({ ok: true, members: rows.map(memberRow) });
      }

      case 'team_invite': {
        const email = cleanEmail(body.email), name = staffName(body.name);
        if (!email) return bad('Enter a valid email address.');
        if (!name) return bad('Enter their name.');
        if (!ROLES.includes(body.role)) return bad('Pick a role.');
        const temp = tempPassword();
        const rows = await sql`
          insert into staff (email, name, role, pw_hash)
          values (${email}, ${name}, ${body.role}, ${await hashPassword(temp)})
          on conflict (email) do nothing
          returning id, email, name, role, last_seen, created_at, disabled`;
        if (!rows.length) return bad('That email is already on the team.', 409);
        await audit(sql, me, 'team.invite', email, { role: body.role });
        return json({ ok: true, member: memberRow(rows[0]), tempPassword: temp });
      }

      case 'team_update': {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) return bad('That member does not exist.', 404);
        const [target] = await sql`select id, email, role, disabled from staff where id = ${id}::bigint`;
        if (!target) return bad('That member does not exist.', 404);
        const role = body.role !== undefined ? body.role : target.role;
        const disabled = body.disabled !== undefined ? !!body.disabled : target.disabled;
        if (!ROLES.includes(role)) return bad('Pick a role.');
        if (id === me.id && (role !== target.role || disabled !== target.disabled))
          return bad('You cannot change your own role or access.', 409);
        // Demoting or disabling an active owner: lock every active owner row (in id
        // order) inside the same statement and require another one to remain, so two
        // owners demoting each other at once cannot leave zero.
        const demotesOwner = target.role === 'owner' && !target.disabled && (role !== 'owner' || disabled);
        const [row] = demotesOwner
          ? await sql`
              with owners as (select id from staff where role = 'owner' and not disabled order by id for update)
              update staff set role = ${role}, disabled = ${disabled}
              where id = ${id}::bigint and (select count(*) from owners where id <> ${id}::bigint) >= 1
              returning id, email, name, role, last_seen, created_at, disabled`
          : await sql`
              update staff set role = ${role}, disabled = ${disabled} where id = ${id}::bigint
              returning id, email, name, role, last_seen, created_at, disabled`;
        if (!row && demotesOwner) return bad('A backroom needs at least one active owner.', 409);
        if (!row) return bad('That member does not exist.', 404);
        if (disabled || role !== target.role) await revokeAllFor(sql, id);
        await audit(sql, me, 'team.update', target.email,
          { role: role !== target.role ? { from: target.role, to: role } : undefined,
            disabled: disabled !== target.disabled ? disabled : undefined });
        return json({ ok: true, member: memberRow(row) });
      }

      case 'team_remove': {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) return bad('That member does not exist.', 404);
        if (id === me.id) return bad('You cannot remove yourself.', 409);
        const [target] = await sql`select id, email, role, disabled from staff where id = ${id}::bigint`;
        if (!target) return bad('That member does not exist.', 404);
        const activeOwner = target.role === 'owner' && !target.disabled;
        const gone = activeOwner
          ? await sql`
              with owners as (select id from staff where role = 'owner' and not disabled order by id for update)
              delete from staff
              where id = ${id}::bigint and (select count(*) from owners where id <> ${id}::bigint) >= 1
              returning id`
          : await sql`delete from staff where id = ${id}::bigint returning id`;
        if (!gone.length) return activeOwner ? bad('A backroom needs at least one active owner.', 409)
                                             : bad('That member does not exist.', 404);
        await audit(sql, me, 'team.remove', target.email, { role: target.role });
        return json({ ok: true });
      }

      case 'settings':
        return json({ ok: true, org: await orgOf(sql) });

      case 'settings_save': {
        const name = cleanText(body.name, 60);
        const accent = String(body.accent || '').trim();
        const sponsorLabel = cleanText(body.sponsorLabel, 60);
        if (!name) return bad('Enter an organisation name.');
        if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return bad('Accent must be a hex colour like #22A070.');
        const org = { name, accent: accent.toUpperCase(), sponsorLabel };
        await setSetting(sql, 'org', org);
        await audit(sql, me, 'settings.save', null, org);
        return json({ ok: true, org });
      }

      case 'delete_player': {
        // Remove one player outright — a throwaway test account, usually.
        // Every FK cascades, so rounds, devices and friendships go with them.
        const code = String(body.code || '').toUpperCase().replace(/[\s-]/g, '');
        if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) return bad('That is not a player code.');
        const who = await sql`
          select p.id, p.name, p.email,
                 (select count(*)::int from rounds r where r.player_id = p.id) as rounds,
                 (select count(*)::int from friendships f where f.low_id = p.id or f.high_id = p.id) as friends
          from players p where p.code = ${code}`;
        if (!who.length) return bad('No player has that code.', 404);
        const w = who[0];
        if (w.email) await sql`delete from signin_attempts where email = ${w.email}`;
        await sql`delete from players where id = ${w.id}`;
        const removed = { code, name: w.name, claimed: !!w.email, rounds: w.rounds, friendships: w.friends };
        await audit(sql, me, 'player.delete', code, removed);
        return json({ ok: true, removed });
      }

      default: return bad('Unknown request.');
    }
  } catch (err) {
    return oops(sql, 'backroom:' + op.slice(0, 30), err);
  }
};

function auditRow(r) {
  return { id: Number(r.id), at: r.at, actor: r.actor, action: r.action, target: r.target, detail: r.detail };
}
function memberRow(r) {
  return { id: Number(r.id), email: r.email, name: r.name, role: r.role,
           lastSeen: r.last_seen, createdAt: r.created_at, disabled: !!r.disabled };
}

/** Structural errors plus soft warnings against neighbouring schedule_days. */
async function checkDayFull(sql, date, name, holes) {
  const errors = checkDay({ name, holes });
  const list = Array.isArray(holes) ? holes.slice(0, 12) : [];
  const neighbours = await sql`
    select day::text as date, name, holes from schedule_days
    where day between ${addDays(date, -45)}::date and ${addDays(date, 45)}::date and day <> ${date}::date`;
  const warnings = dayWarnings(date, name, list, neighbours);
  return { errors, warnings };
}

/** One chain: structure, link familiarity, par, and pool duplicates. */
async function checkPuzzle(sql, body) {
  const seed = norm(body.seed);
  const words = Array.isArray(body.words) ? body.words.slice(0, 12).map(norm) : [];
  const errors = checkChain(seed, words);
  const links = linksOf(words).map(text => ({ text, known: KNOWN.has(text) }));
  if (!errors.length) {
    const key = words.join(' ');
    const selfId = body.id != null ? Number(body.id) || 0 : 0;
    // An existing draft whose chain is unchanged is never its own duplicate — even
    // after a publish froze it into schedule_days (else it could never be re-saved).
    if (selfId > 0 && Number.isInteger(selfId)) {
      const [self] = await sql`select words from drafts where id = ${selfId}::bigint`;
      if (self && JSON.stringify(self.words) === JSON.stringify(words))
        return { errors, links, par: parOf(words) };
    }
    const [{ n }] = await sql`
      select count(*)::int as n from drafts
      where words = ${JSON.stringify(words)}::jsonb and id <> ${selfId}::bigint and status <> 'archived'`;
    const reserve = (SCHEDULE.leftovers || []).some(h => h.words.join(' ') === key);
    const [{ s }] = await sql`
      select count(*)::int as s from schedule_days, jsonb_array_elements(holes) h
      where h->'words' = ${JSON.stringify(words)}::jsonb`;
    if (n || s || (reserve && !selfId)) errors.push({ msg: 'That exact chain is already in the pool.' });
  }
  return { errors, links, par: words.length >= 2 ? parOf(words) : null };
}

/** Build-machine ops: identical semantics to the original backroom. */
async function buildOp(sql, op, body) {
  if (op === 'build_data') {
    const frozenDays = await sql`select day::text as day, name, holes from schedule_days order by day`;
    const drafts = await sql`select seed, words, links from drafts where status = 'approved'`;
    return json({ ok: true, frozenDays, drafts });
  }
  const list = Array.isArray(body.days) ? body.days.slice(0, 100) : [];
  if (op === 'refreeze') {
    // Replace the frozen schedule outright with a supplied ground truth.
    // Exists for exactly one situation: the frozen record is wrong.
    if (!list.length) return bad('no days supplied');
    await sql`delete from schedule_days`;
  }
  let saved = 0;
  for (const d of list) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ''))) continue;
    if (!Array.isArray(d.holes) || !d.holes.length || d.holes.length > 8) continue;
    const res = await sql`
      insert into schedule_days (day, name, holes)
      values (${d.date}::date, ${String(d.name || '').slice(0, 40)}, ${JSON.stringify(d.holes)}::jsonb)
      on conflict (day) do nothing returning day`;
    if (res.length) saved++;
  }
  return json({ ok: true, saved });
}

export const config = { path: '/api/backroom' };
