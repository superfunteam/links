// API client for POST /api/backroom. Contract: spec §3/§4.
const KEY = 'br.session';
const ENDPOINT = '/api/backroom';

const read = () => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };

export const session = {
  token: read(),
  set(t) {
    this.token = t || null;
    try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private mode */ }
  },
  clear() { this.set(null); },
};

export class ApiError extends Error {
  constructor(message, status = 0, ref = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.ref = ref;
  }
}

// Listeners notified when any call comes back 401 (app.mjs routes to login).
const unauthorized = new Set();
export const onUnauthorized = (fn) => { unauthorized.add(fn); return () => unauthorized.delete(fn); };

export const api = async (op, params = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ ...params, op }) });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (res.status === 401) {
    const hadSession = !!session.token;
    session.clear();
    if (hadSession) for (const fn of unauthorized) { try { fn(); } catch { /* ignore */ } }
    throw new ApiError(data?.error || 'Your session has ended. Sign in again.', 401, data?.ref ?? null);
  }
  if (!res.ok || !data || data.error) {
    const msg = data?.error || `Something went wrong (${res.status}).`;
    throw new ApiError(msg, res.status, data?.ref ?? null);
  }
  // Broadcast successes so the shell can react (e.g. refresh the unpublished banner)
  // without views having to know about it.
  try { window.dispatchEvent(new CustomEvent('br:api', { detail: { op, params, data } })); } catch { /* non-browser */ }
  return data;
};
