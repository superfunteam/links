// Add a friend by their public code. Authenticated, budgeted against misses, and
// capped — otherwise the code space is an oracle for enumerating every player.
import { db, json, bad, readJson, CODE_RE, authed, clubOf, overLimit } from '../lib/db.mjs';

const MAX_FRIENDS = 50;
const NOT_FOUND = 'No one is using that code.';

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const friendCode = String(body.friendCode || '').toUpperCase().replace(/[\s-]/g, '');
  const sql = db();
  try {
    const me = await authed(sql, req);
    if (!me) return bad('unknown device', 401);
    if (!CODE_RE.test(friendCode)) return bad("A code is 4 letters and numbers — no I, O, 0 or 1.");
    if (friendCode === me.code) return bad("That's your own code!");

    const count = await sql`
      select count(*)::int as n from friendships where low_id = ${me.id} or high_id = ${me.id}`;
    if (count[0].n >= MAX_FRIENDS) return bad('Your club is full.', 429);

    const found = await sql`select id, code, name from players where code = ${friendCode}`;
    if (!found.length) {
      // Budget the MISSES, not the requests: a real player mistypes twice, not thirty times.
      if (await overLimit(sql, `miss:${me.id}`, 10, 60)) return bad(NOT_FOUND, 404);
      return bad(NOT_FOUND, 404);
    }
    if (await overLimit(sql, `add:${me.id}`, 10, 1440))
      return bad('That is a lot of friends for one day — try again tomorrow.', 429);

    const them = found[0];
    const low = me.id < them.id ? me.id : them.id;
    const high = me.id < them.id ? them.id : me.id;
    await sql`
      insert into friendships (low_id, high_id, initiated_by) values (${low}, ${high}, ${me.id})
      on conflict do nothing`;

    const club = await clubOf(sql, me.id);
    return json({
      ok: true,
      added: { code: them.code, name: them.name },
      club: club.map(p => ({ code: p.code, name: p.name, isMe: p.code === me.code, rounds: p.rounds }))
    });
  } catch (err) {
    return bad(err.message, 500);
  }
};

export const config = { path: '/api/friend' };
