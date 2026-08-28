// The single switch behind "Remind me to play daily": on stores the device's
// push subscription and timezone, off deletes it. The subscription endpoint is
// the identity, so flipping the box twice can never make two rows.
import { db, json, bad, readJson, authed, oops } from '../lib/db.mjs';

const TZ_RE = /^[A-Za-z_]+\/[A-Za-z_+-]+(\/[A-Za-z_+-]+)?$/;

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const sql = db();
  try {
    if (body.action === 'off') {
      const endpoint = String(body.endpoint || '');
      if (!endpoint.startsWith('https://')) return bad('bad endpoint');
      await sql`delete from push_subs where endpoint = ${endpoint}`;
      return json({ ok: true, on: false });
    }
    if (body.action === 'on') {
      const sub = body.sub || {};
      const endpoint = String(sub.endpoint || '');
      if (!endpoint.startsWith('https://') || endpoint.length > 1000) return bad('bad subscription');
      if (!sub.keys || !sub.keys.p256dh || !sub.keys.auth) return bad('bad subscription');
      const tz = TZ_RE.test(String(body.tz || '')) ? body.tz : 'America/New_York';
      const me = await authed(sql, req);          // optional — ties cleanup to delete_player
      await sql`
        insert into push_subs (endpoint, keys, tz, player_id)
        values (${endpoint}, ${JSON.stringify(sub.keys)}::jsonb, ${tz}, ${me ? me.id : null})
        on conflict (endpoint) do update set keys = excluded.keys, tz = excluded.tz,
          player_id = coalesce(excluded.player_id, push_subs.player_id)`;
      return json({ ok: true, on: true });
    }
    return bad('unknown action');
  } catch (err) {
    return oops(sql, 'push', err);
  }
};

export const config = { path: '/api/push' };
