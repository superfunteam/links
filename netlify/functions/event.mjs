// Fire-and-forget analytics beacon. The client never waits on it and a failure
// is invisible — losing an event is always better than slowing the game.
import { db, json, bad, readJson, DATE_RE, authed, overLimit } from '../lib/db.mjs';

const KINDS = new Set(['open','round_start','practice_start','share_card','share_code','nudge','drill_down']);

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const kind = String(body.kind || '');
  if (!KINDS.has(kind)) return bad('unknown kind');
  const day = DATE_RE.test(String(body.day || '')) ? String(body.day) : null;

  const sql = db();
  try {
    const me = await authed(sql, req);          // optional — anonymous is fine
    const who = me ? `p${me.id}` : (req.headers.get('x-nf-client-connection-ip') || 'anon');
    if (await overLimit(sql, `evt:${who}`, 300, 1440)) return json({ ok: true });   // silently drop floods
    await sql`insert into events (kind, player_id, day)
              values (${kind}, ${me ? me.id : null}, ${day}::date)`;
    return json({ ok: true });
  } catch (err) {
    return json({ ok: true });                  // never let analytics surface an error
  }
};

export const config = { path: '/api/event' };
