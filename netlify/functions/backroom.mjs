// The backroom: stats, calendar, pool, editor and publish — one function, one
// op switch, everything behind the shared key. The schedule and phrase list
// are baked in at build time so no request ever recomputes them.
import { db, json, bad, readJson, todayET, courseKey } from '../lib/db.mjs';
import { SCHEDULE } from '../lib/scheduledata.mjs';
import { PAIRS_TEXT } from '../lib/pairsdata.mjs';

const KEY = process.env.BACKROOM_KEY || 'superfunlinks';
const KNOWN = new Set(PAIRS_TEXT.split('\n').map(l => l.trim()).filter(Boolean));
const parOf = h => { const b = h.words.length - 1; return b + (b >= 4 ? 2 : 1); };
const dayPar = d => d.holes.reduce((t, h) => t + parOf(h), 0);
const holeStrokes = m => (m || []).reduce((t, x) => t + (x.g || 0) + (x.b || 0), 0);

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  if ((req.headers.get('x-key') || '') !== KEY) return bad('wrong key', 401);
  const body = (await readJson(req)) || {};
  const sql = db();
  const today = todayET();

  try {
    switch (body.op) {

      case 'overview': {
        const [players] = await sql`
          select count(*)::int as total,
                 count(email)::int as claimed,
                 count(*) filter (where seen_at > now() - interval '7 days')::int as seen7
          from players`;
        const [rounds] = await sql`
          select count(*)::int as total,
                 count(*) filter (where created_at > now() - interval '7 days')::int as last7
          from rounds`;
        const series = await sql`
          select play_date::text as day, count(*)::int as plays,
                 round(avg(strokes - par), 2)::float as avg_diff
          from rounds where play_date > (${today}::date - 14)
          group by play_date order by play_date`;
        const events = await sql`
          select kind, count(*)::int as n,
                 count(*) filter (where created_at > now() - interval '7 days')::int as last7
          from events group by kind order by n desc`;
        const daily = await sql`
          select created_at::date::text as day, kind, count(*)::int as n
          from events where created_at > now() - interval '14 days'
          group by 1, 2 order by 1`;
        return json({ ok: true, players, rounds, series, events, daily, builtAt: SCHEDULE.builtAt, dbStatus: SCHEDULE.dbStatus || 'unknown' });
      }

      case 'days': {
        const stats = await sql`
          select play_date::text as day, count(*)::int as plays,
                 round(avg(strokes - par), 2)::float as avg_diff,
                 min(strokes - par)::int as best,
                 count(*) filter (where strokes < par)::int as under
          from rounds group by play_date`;
        const byDay = Object.fromEntries(stats.map(r => [r.day, r]));
        return json({ ok: true, today,
          days: SCHEDULE.days.map(d => ({
            date: d.date, name: d.name, par: dayPar(d),
            seeds: d.holes.map(h => h.seed),
            frozen: !!d.frozen,
            stats: byDay[d.date] || null
          })) });
      }

      case 'day': {
        const d = SCHEDULE.days.find(x => x.date === body.date);
        if (!d) return bad('no such day', 404);
        const rounds = await sql`
          select p.name, p.code, r.strokes, r.par, r.marks, r.course_key, r.created_at
          from rounds r join players p on p.id = r.player_id
          where r.play_date = ${body.date}::date
          order by r.strokes - r.par`;
        const thisKey = courseKey(d.holes);
        const holes = d.holes.map((h, i) => {
          const per = rounds.map(r => (r.marks || [])[i]).filter(Boolean).map(holeStrokes);
          return { seed: h.seed, words: h.words, links: h.links, par: parOf(h),
                   avg: per.length ? +(per.reduce((a, b) => a + b, 0) / per.length).toFixed(2) : null,
                   worst: per.length ? Math.max(...per) : null };
        });
        return json({ ok: true, date: d.date, name: d.name, par: dayPar(d), holes,
          courseKey: thisKey,
          rounds: rounds.map(r => ({ name: r.name || r.code, strokes: r.strokes, par: r.par, at: r.created_at,
                                     edition: !r.course_key ? 'legacy' : r.course_key === thisKey ? 'current' : 'other' })) });
      }

      case 'pool': {
        const drafts = await sql`
          select id, seed, words, links, status, created_at from drafts order by id desc limit 200`;
        return json({ ok: true, today,
          upcoming: SCHEDULE.days.filter(d => d.date > today)
            .map(d => ({ date: d.date, name: d.name, par: dayPar(d), holes: d.holes })),
          leftovers: SCHEDULE.leftovers,
          drafts });
      }

      case 'draft_save': {
        const seed = String(body.seed || '').toUpperCase().trim();
        const words = Array.isArray(body.words) ? body.words.map(w => String(w || '').toUpperCase().trim()) : [];
        const errs = [];
        if (!/^[A-Z]{3,5}$/.test(seed)) errs.push('Seed must be 3–5 letters.');
        else {
          if (words.length !== seed.length) errs.push(`${seed.length}-letter seed needs ${seed.length} words.`);
          words.forEach((w, i) => {
            if (!/^[A-Z]{2,12}$/.test(w)) errs.push(`Word ${i + 1} must be 2–12 letters.`);
            else if (w[0] !== seed[i]) errs.push(`"${w}" should start with "${seed[i]}".`);
          });
          if (new Set(words).size !== words.length) errs.push('A word repeats.');
        }
        if (errs.length) return json({ ok: false, errors: errs });
        const links = words.slice(1).map((w, i) => `${words[i]} ${w}`.toLowerCase());
        const linkInfo = links.map(l => ({ link: l, known: KNOWN.has(l) }));
        const dupe = SCHEDULE.days.some(d => d.holes.some(h => h.words.join(' ') === words.join(' ')))
          || SCHEDULE.leftovers.some(h => h.words.join(' ') === words.join(' '));
        if (dupe) return json({ ok: false, errors: ['That exact chain is already in the pool.'] });
        if (body.check) return json({ ok: true, checked: true, links: linkInfo });
        const [row] = await sql`
          insert into drafts (seed, words, links)
          values (${seed}, ${JSON.stringify(words)}::jsonb, ${JSON.stringify(links)}::jsonb)
          returning id`;
        return json({ ok: true, id: row.id, links: linkInfo });
      }

      case 'draft_archive': {
        await sql`update drafts set status = 'archived' where id = ${Number(body.id) || 0}`;
        return json({ ok: true });
      }

      // ── build-time endpoints ─────────────────────────────────────────────
      // Netlify's build environment has no database credentials, but it can
      // reach this very function on the live site — which does. The build uses
      // these two ops instead of a direct connection.
      case 'delete_player': {
        // Remove one player outright — a throwaway test account, usually.
        // Every FK cascades, so rounds, devices and friendships go with them.
        const code = String(body.code || '').toUpperCase().replace(/[\s-]/g, '');
        if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) return bad('bad code');
        const who = await sql`
          select p.id, p.name, p.email,
                 (select count(*)::int from rounds r where r.player_id = p.id) as rounds,
                 (select count(*)::int from friendships f where f.low_id = p.id or f.high_id = p.id) as friends
          from players p where p.code = ${code}`;
        if (!who.length) return bad('no player with that code', 404);
        const w = who[0];
        if (w.email) await sql`delete from signin_attempts where email = ${w.email}`;
        await sql`delete from players where id = ${w.id}`;
        return json({ ok: true, removed: {
          code, name: w.name, claimed: !!w.email, rounds: w.rounds, friendships: w.friends } });
      }

      case 'errors': {
        const rows = await sql`
          select ref, op, message, at from error_log order by at desc limit 30`;
        return json({ ok: true, errors: rows });
      }

      case 'build_data': {
        const frozenDays = await sql`select day::text as day, name, holes from schedule_days order by day`;
        const drafts = await sql`select seed, words, links from drafts where status = 'approved'`;
        return json({ ok: true, frozenDays, drafts });
      }

      case 'refreeze': {
        // Replace the frozen schedule outright with a supplied ground truth.
        // Exists for exactly one situation: the frozen record is wrong — as it
        // was when a startDate change reshuffled dates people had played.
        const list = Array.isArray(body.days) ? body.days.slice(0, 100) : [];
        if (!list.length) return bad('no days supplied');
        await sql`delete from schedule_days`;
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

      case 'freeze': {
        const list = Array.isArray(body.days) ? body.days.slice(0, 100) : [];
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

      case 'publish': {
        const hook = process.env.BUILD_HOOK_URL;
        if (!hook) return bad('BUILD_HOOK_URL is not set on the site', 500);
        const res = await fetch(hook, { method: 'POST' });
        return json({ ok: res.ok, status: res.status });
      }

      default: return bad('unknown op');
    }
  } catch (err) {
    return bad(err.message, 500);
  }
};

export const config = { path: '/api/backroom' };
