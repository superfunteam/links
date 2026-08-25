// Adopt an account on a new device with email + code. The code is public, so the
// email is the only secret here — the owner accepted that deliberately. What we
// can do is throttle hard, answer identically on every kind of failure, and mint
// this device its own token so the code itself still never authorises a write.
import { db, json, bad, readJson, CODE_RE, cleanEmail, clubOf, newToken, attachDevice } from '../lib/db.mjs';

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 8;
const VAGUE = 'That email and code don’t match an account.';

export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const body = (await readJson(req)) || {};
  const code = String(body.code || '').toUpperCase().replace(/[\s-]/g, '');
  const email = cleanEmail(body.email);
  const sql = db();

  // Constant-ish delay so a throttled answer can't be told from a wrong one by timing.
  const settle = start => new Promise(r => setTimeout(r, Math.max(0, 180 - (Date.now() - start))));
  const started = Date.now();

  if (!email || !CODE_RE.test(code)) { await settle(started); return bad(VAGUE, 401); }

  try {
    const recent = await sql`
      select count(*)::int as n from signin_attempts
      where email = ${email} and ok = false
        and at > now() - (${WINDOW_MINUTES}::int * interval '1 minute')`;
    if (recent[0].n >= MAX_FAILURES) { await settle(started); return bad(VAGUE, 401); }

    const rows = await sql`
      select id, code, name from players where lower(email) = ${email} and code = ${code}`;
    await sql`insert into signin_attempts (email, ok) values (${email}, ${rows.length > 0})`;
    if (!rows.length) { await settle(started); return bad(VAGUE, 401); }

    const me = rows[0];
    const token = newToken();
    await attachDevice(sql, me.id, token);

    const club = await clubOf(sql, me.id, 400);
    const mine = club.find(p => p.code === me.code);
    return json({
      ok: true, token,
      player: { code: me.code, name: me.name, claimed: true },
      rounds: mine ? mine.rounds : [],
      club: club.map(p => ({ code: p.code, name: p.name, isMe: p.code === me.code, rounds: p.rounds }))
    });
  } catch (err) {
    return bad(err.message, 500);
  }
};

export const config = { path: '/api/signin' };
