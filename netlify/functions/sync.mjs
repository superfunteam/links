// The workhorse: hand over any rounds the device is holding and get the club
// board back. Authenticated by device token — the public code proves nothing.
import { db, json, bad, readJson, DATE_RE, clampInt, cleanName, cleanMarks,
         authed, clubOf, todayET } from '../lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const sql = db();
  try {
    const me = await authed(sql, req);
    if (!me) return bad('unknown device', 401);

    const name = cleanName(body.name);
    if (name && name !== me.name) await sql`update players set name = ${name} where id = ${me.id}`;

    let stored = 0;
    const incoming = Array.isArray(body.rounds) ? body.rounds.slice(0, 60) : [];
    const today = todayET();
    for (const r of incoming) {
      const date = String(r?.date || '');
      const strokes = clampInt(r?.strokes, 0, 999);
      const par = clampInt(r?.par, 1, 999);
      if (!DATE_RE.test(date) || strokes === null || par === null) continue;
      if (date > today) continue;                        // tomorrow's course is already in the bundle
      if (strokes > par * 6) continue;                   // nonsense can't reach the table
      // First-write-wins is enforced by the primary key, not by application code,
      // so a retry and a concurrent submit both resolve the same way.
      const res = await sql`
        insert into rounds (player_id, play_date, strokes, par, marks)
        values (${me.id}, ${date}::date, ${strokes}, ${par}, ${JSON.stringify(cleanMarks(r?.marks))}::jsonb)
        on conflict (player_id, play_date) do nothing
        returning player_id`;
      if (res.length) stored++;
    }

    const club = await clubOf(sql, me.id);
    return json({
      ok: true, today, stored,
      player: { code: me.code, name: name || me.name, claimed: !!me.email },
      club: club.map(p => ({ code: p.code, name: p.name, isMe: p.code === me.code, rounds: p.rounds }))
    });
  } catch (err) {
    return bad(err.message, 500);
  }
};

export const config = { path: '/api/sync' };
