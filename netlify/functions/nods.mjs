// Public: the newsroom nods for one day, read by the game when a course starts.
// Nods for future days stay hidden so they can't hint at upcoming puzzles.
import { db, todayET, DATE_RE } from '../lib/db.mjs';

const reply = (body, status = 200, cache = 'public, max-age=60') =>
  Response.json(body, { status, headers: { 'cache-control': cache } });

export default async (req) => {
  if (req.method !== 'GET') return reply({ nods: {} }, 405, 'no-store');
  const day = new URL(req.url).searchParams.get('day') || '';
  if (!DATE_RE.test(day)) return reply({ nods: {} }, 400, 'no-store');
  if (day > todayET()) return reply({ nods: {} });
  try {
    const rows = await db()`
      select hole_idx, icon, text, label, url from hole_nods
      where day = ${day}::date order by hole_idx`;
    const nods = {};
    rows.forEach(r => { nods[String(r.hole_idx)] = { icon: r.icon, text: r.text, label: r.label, url: r.url }; });
    return reply({ nods });
  } catch (err) {
    return reply({ nods: {} }, 200, 'no-store');   // the game treats this as "no nods"
  }
};

export const config = { path: '/api/nods' };
