// Attach an email so the account can be recovered elsewhere. Requires the device
// token: without it, anyone holding the public code could claim someone's account.
import { db, json, bad, readJson, cleanEmail, cleanName, authed, overLimit } from '../lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const email = cleanEmail(body.email);
  const sql = db();
  try {
    const me = await authed(sql, req);
    if (!me) return bad('unknown device', 401);
    if (!email) return bad("That email doesn't look right.");
    if (await overLimit(sql, `claim:${me.id}`, 5, 1440))
      return bad('Too many changes today. Try again tomorrow.', 429);

    const name = cleanName(body.name);
    const taken = await sql`select 1 from players where lower(email) = ${email} and id <> ${me.id}`;
    if (taken.length) return bad('That email is already used by another player.', 409);

    const rows = await sql`
      update players set email = ${email}, name = coalesce(${name}, name)
      where id = ${me.id} returning code, name`;
    return json({ ok: true, player: { code: rows[0].code, name: rows[0].name, claimed: true } });
  } catch (err) {
    return bad(err.message, 500);
  }
};

export const config = { path: '/api/claim' };
