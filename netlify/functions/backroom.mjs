// The backroom: stats, calendar, pool, editor and publish — one function, one
// op switch, everything behind the shared key. The schedule and phrase list
// are baked in at build time so no request ever recomputes them.
import { db, json, bad, readJson, todayET } from '../lib/db.mjs';
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
        return json({ ok: true, players, rounds, series, events, daily, builtAt: SCHEDULE.builtAt });
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
          select p.name, p.code, r.strokes, r.par, r.marks, r.created_at
          from rounds r join players p on p.id = r.player_id
          where r.play_date = ${body.date}::date
          order by r.strokes - r.par`;
        const holes = d.holes.map((h, i) => {
          const per = rounds.map(r => (r.marks || [])[i]).filter(Boolean).map(holeStrokes);
          return { seed: h.seed, words: h.words, links: h.links, par: parOf(h),
                   avg: per.length ? +(per.reduce((a, b) => a + b, 0) / per.length).toFixed(2) : null,
                   worst: per.length ? Math.max(...per) : null };
        });
        return json({ ok: true, date: d.date, name: d.name, par: dayPar(d), holes,
          rounds: rounds.map(r => ({ name: r.name || r.code, strokes: r.strokes, par: r.par, at: r.created_at })) });
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
