// Backroom staff: password hashing, sessions, roles and the audit trail.
// Sessions reuse the device-token scheme from db.mjs: a random 128-bit hex
// token goes to the browser, only its SHA-256 is stored.
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { newToken, hashToken } from './db.mjs';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_DAYS = 30;
export const ROLES = ['owner', 'editor', 'viewer'];
const RANK = { viewer: 1, editor: 2, owner: 3 };

const scrypt = (pw, salt, keylen, opts) => new Promise((resolve, reject) =>
  scryptCb(pw, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key)));

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(String(pw).normalize('NFKC'), salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  try {
    const [kind, N, r, p, saltB64, keyB64] = String(stored || '').split('$');
    if (kind !== 'scrypt') return false;
    const want = Buffer.from(keyB64, 'base64');
    if (!want.length) return false;
    const got = await scrypt(String(pw).normalize('NFKC'), Buffer.from(saltB64, 'base64'), want.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

// A real hash of nothing, so a login for an unknown email costs the same.
let dummy;
export async function burnPasswordCheck(pw) {
  if (!dummy) dummy = await hashPassword('not-a-real-password-' + newToken());
  await verifyPassword(pw, dummy);
  return false;
}

/** Constant-time string compare for shared secrets (setup key, build key). */
export function secretEquals(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  if (!x.length || !y.length || x.length !== y.length) {
    timingSafeEqual(x, x);              // spend comparable time either way
    return false;
  }
  return timingSafeEqual(x, y);
}

/** Readable one-time password: no 0/O/1/l/I. */
export function tempPassword(len = 14) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(len)].map(b => chars[b % chars.length]).join('');
}

export const settle = async (startedAt, ms = 200) => {
  const left = ms - (Date.now() - startedAt);
  if (left > 0) await new Promise(r => setTimeout(r, left));
};

export const hasRole = (staff, role) => !!staff && (RANK[staff.role] || 0) >= (RANK[role] || 99);
export const publicMe = s => ({ id: Number(s.id), email: s.email, name: s.name, role: s.role });

export async function createSession(sql, staffId) {
  const token = newToken();
  await sql`
    insert into staff_sessions (token_hash, staff_id, expires_at, last_seen)
    values (${await hashToken(token)}, ${staffId}::bigint, now() + (${SESSION_DAYS}::int * interval '1 day'), now())`;
  return token;
}

export function bearer(req) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return /^[0-9a-f]{32}$/.test(token) ? token : null;
}

/** Resolve the caller's staff row from the Authorization header, or null. */
export async function sessionStaff(sql, req) {
  const token = bearer(req);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const rows = await sql`
    update staff_sessions ss set last_seen = now()
    from staff s
    where ss.token_hash = ${tokenHash} and ss.expires_at > now()
      and s.id = ss.staff_id and not s.disabled
    returning s.id, s.email, s.name, s.role`;
  if (!rows.length) return null;
  await sql`update staff set last_seen = now() where id = ${rows[0].id}::bigint`;
  return { ...rows[0], id: Number(rows[0].id), tokenHash };
}

export async function revokeSession(sql, tokenHash) {
  await sql`delete from staff_sessions where token_hash = ${tokenHash}`;
}

/** Sign a member out everywhere, optionally keeping one session. */
export async function revokeAllFor(sql, staffId, keepHash = null) {
  if (keepHash) await sql`delete from staff_sessions where staff_id = ${staffId}::bigint and token_hash <> ${keepHash}`;
  else await sql`delete from staff_sessions where staff_id = ${staffId}::bigint`;
}

/** One row per change. Never throws: the audit must not be the second failure. */
export async function audit(sql, staff, action, target = null, detail = null) {
  try {
    await sql`
      insert into audit_log (staff_id, actor, action, target, detail)
      values (${staff?.id ?? null}::bigint, ${staff?.name ?? 'system'}, ${action},
              ${target == null ? null : String(target).slice(0, 200)},
              ${detail == null ? null : JSON.stringify(detail)}::jsonb)`;
  } catch (e) { /* swallow */ }
}
