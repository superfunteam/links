// First launch: the SERVER picks the code and mints the device token. The client
// never proposes a code, so nobody can squat the namespace or land on someone
// else's account by generating a code that already exists.
import { db, json, bad, readJson, cleanName, newToken, createPlayer, attachDevice, oops } from '../lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const sql = db();
  try {
    const me = await createPlayer(sql, cleanName(body.name));
    const token = newToken();
    await attachDevice(sql, me.id, token);
    return json({ ok: true, player: { code: me.code, name: me.name, claimed: false }, token });
  } catch (err) {
    return oops(sql, 'register', err);
  }
};

export const config = { path: '/api/register' };
