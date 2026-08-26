// Shared helpers for the Links API. Lives outside netlify/functions so Netlify
// doesn't try to publish it as an endpoint of its own.
import { getDatabase } from '@netlify/database';

let cached;
export function db() {
  if (!cached) cached = getDatabase();
  return cached.sql;
}

export const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;          // no I, O, 0 or 1
export const KEY_RE = /^[a-z0-9]{4,12}$/;

/** Fingerprint of a day's puzzle content. Client and server compute this
 *  identically, so a round is bound to the edition it was played on and can
 *  never silently attach to a different puzzle that later owns its date. */
export function courseKey(holes) {
  const text = holes.map(h => h.words.join(' ')).join('|');
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export const bad = (message, status = 400) => json({ ok: false, error: message }, status);

/** Today's course date in US Eastern — the server decides, never the device,
 *  so a wrong phone clock can't file a round against the wrong day. */
export function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

export async function readJson(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : null;
  } catch { return null; }
}

/** Clamp anything a client sends before it reaches the database. */
export const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/** A name is shown on other players' screens, so nothing dangerous or
 *  visually deceptive is allowed into the database in the first place. */
export const cleanName = v => {
  if (typeof v !== 'string') return null;
  const clean = v.normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')        // control characters
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')  // zero-width and bidi
    .replace(/[<>&"']/g, '')
    .trim().slice(0, 20);
  return clean || null;
};

export const cleanEmail = v => {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e) && e.length <= 160 ? e : null;
};

/** Marks drive only the share card's emoji, so they're bounded hard. */
export function cleanMarks(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).map(hole =>
    (Array.isArray(hole) ? hole : []).slice(0, 12).map(m => ({
      g: clampInt(m?.g, 0, 99) ?? 0,
      b: clampInt(m?.b, 0, 99) ?? 0
    })));
}

/* ── identity ──────────────────────────────────────────────────────────────
   The 4-character code is public: players read it aloud so friends can add
   them. It addresses a player, it never proves one. Writes carry a 128-bit
   device token instead, of which only the SHA-256 is stored. */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// strings that would be unpleasant or confusing to read out over the phone
const CODE_DENY = new Set(['ASS', 'FAG', 'FUK', 'SEX', 'TIT', 'WTF', 'DIE']);

export function newToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  const r = crypto.getRandomValues(new Uint8Array(4));
  return [...r].map(n => CODE_CHARS[n % CODE_CHARS.length]).join('');
}

/** Mint a player with a server-chosen code. The unique index is the only
 *  arbiter of collision, so two devices can never end up on one account. */
export async function createPlayer(sql, name) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    if (CODE_DENY.has(code.slice(0, 3))) continue;
    const rows = await sql`
      insert into players (code, name) values (${code}, ${name})
      on conflict (code) do nothing
      returning id, code, name, email`;
    if (rows.length) return rows[0];
  }
  throw new Error('could not allocate a code');
}

export async function attachDevice(sql, playerId, token) {
  await sql`
    insert into devices (token_hash, player_id) values (${await hashToken(token)}, ${playerId})
    on conflict (token_hash) do update set last_seen = now()`;
}

/** Resolve the caller from their Authorization header. Null means unauthenticated. */
export async function authed(sql, req) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const rows = await sql`
    update devices set last_seen = now() where token_hash = ${await hashToken(token)}
    returning player_id`;
  if (!rows.length) return null;
  const players = await sql`
    select id, code, name, email from players where id = ${rows[0].player_id}`;
  return players[0] || null;
}

/** Coarse budget keyed by whatever makes sense — usually player id or IP.
 *  Returns true when the caller is over the limit. */
export async function overLimit(sql, key, max, windowMinutes) {
  const rows = await sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      window_start = case when rate_limits.window_start < now() - (${windowMinutes}::int * interval '1 minute')
                          then now() else rate_limits.window_start end,
      count = case when rate_limits.window_start < now() - (${windowMinutes}::int * interval '1 minute')
                   then 1 else rate_limits.count + 1 end
    returning count`;
  return rows[0].count > max;
}

/** Every player in someone's club: themselves plus each mutual friend. */
export async function clubOf(sql, playerId, sinceDays = 14) {
  return sql`
    with club as (
      select ${playerId}::bigint as id
      union
      select case when low_id = ${playerId} then high_id else low_id end
      from friendships
      where low_id = ${playerId} or high_id = ${playerId}
    )
    select p.id, p.code, p.name,
           coalesce(
             json_agg(json_build_object('date', to_char(r.play_date,'YYYY-MM-DD'),
                                        'strokes', r.strokes, 'par', r.par,
                                        'marks', r.marks, 'key', r.course_key)
                      order by r.play_date desc)
               filter (where r.play_date is not null),
             '[]') as rounds
    from club c
    join players p on p.id = c.id
    left join rounds r
      on r.player_id = p.id
     and r.play_date > (current_date - ${sinceDays}::int)
    group by p.id, p.code, p.name
    order by p.id = ${playerId} desc, p.code`;
}
