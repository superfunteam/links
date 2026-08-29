// Serves the app shell for join links (/AB12) with the OG and Twitter tags
// swapped so a shared friend code unfurls as a personal invite card. Crawlers
// read the meta; humans get the exact same app, which reads the code from the
// path. X and Slack prefer twitter:* over og:*, so both sets must change.
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;

export const inviteHTML = (html, code, origin) => {
  const title = `Join my Links club — code ${code}`;
  const desc = `Daily word-chain golf with your friends. Tap to join my club with code ${code}.`;
  const img = `${origin}/og/${code}`;
  const alt = `An invite to a Links club, code ${code}`;
  return html
    .replace(/(property="og:url" content=")[^"]*(")/, `$1${origin}/${code}$2`)
    .replace(/(property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
    .replace(/(property="og:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(property="og:image:alt" content=")[^"]*(")/, `$1${alt}$2`)
    .replace(/(name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`)
    .replace(/(name="twitter:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(name="twitter:image:alt" content=")[^"]*(")/, `$1${alt}$2`);
};

// the query substitution in netlify.toml is the primary channel; the original
// path survives the rewrite, so it doubles as a belt-and-braces fallback
export const codeFrom = (url) => {
  const q = (url.searchParams.get('code') || '').toUpperCase();
  if (CODE_RE.test(q)) return q;
  const seg = (url.pathname.split('/').filter(Boolean).pop() || '').toUpperCase();
  return CODE_RE.test(seg) ? seg : null;
};

export default async (req) => {
  const url = new URL(req.url);
  const code = codeFrom(url);
  // unfurl URLs always point at production; the HTML comes from THIS deploy
  const site = process.env.URL || url.origin;
  const shell = process.env.DEPLOY_PRIME_URL || site;

  let html;
  try {
    const res = await fetch(`${shell}/index.html`);
    if (!res.ok) return new Response('service unavailable', { status: 503 });
    html = await res.text();
  } catch (err) {
    return new Response('service unavailable', { status: 503 });
  }

  if (code) html = inviteHTML(html, code, site);

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, durable, max-age=3600',
    },
  });
};
