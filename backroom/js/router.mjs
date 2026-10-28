// Hash router. Contract: spec §4 — route(pattern, viewFn); views are
// `async (ctx) → Node` with ctx = {params, query, me, org, navigate(path)}.
const routes = [];

const norm = (p) => {
  let s = String(p || '').replace(/^#/, '');
  if (!s.startsWith('/')) s = '/' + s;
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
};

export const route = (pattern, viewFn) => {
  const segs = norm(pattern).split('/').filter(Boolean);
  routes.push({ pattern: norm(pattern), segs, viewFn, statics: segs.filter((s) => !s.startsWith(':')).length });
};

// Parse the current location hash into {path, query}.
export const current = () => {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  return { path: norm(p), query: Object.fromEntries(new URLSearchParams(q)) };
};

// Most specific match wins ('/puzzles/new' beats '/puzzles/:id').
export const match = (path) => {
  const parts = norm(path).split('/').filter(Boolean);
  let best = null;
  for (const r of routes) {
    if (r.segs.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const s = r.segs[i];
      if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(parts[i]);
      else if (s !== parts[i]) { ok = false; break; }
    }
    if (ok && (!best || r.statics > best.route.statics)) best = { route: r, params };
  }
  return best;
};

export const navigate = (path, { replace = false } = {}) => {
  const target = '#' + (String(path).startsWith('#') ? String(path).slice(1) : (String(path).startsWith('/') ? path : '/' + path));
  if (replace) { history.replaceState(null, '', target); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
};

let handler = null;
const fire = () => {
  if (!handler) return;
  const { path, query } = current();
  const m = match(path);
  handler({ path, query, params: m?.params || {}, viewFn: m?.route.viewFn || null, pattern: m?.route.pattern || null });
};
window.addEventListener('hashchange', fire);

// start(onRoute) — calls onRoute({path, query, params, viewFn|null, pattern}) now and on every
// hash change. Calling it again swaps the handler; stop() detaches it (e.g. on sign-out).
export const start = (onRoute) => { handler = onRoute; fire(); return fire; };
export const stop = () => { handler = null; };
