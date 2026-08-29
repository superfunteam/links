// The invite card image: the base OG art with a friend code stamped onto its
// green plate. Crawlers fetch this from /og/<CODE>, so it has to be a real PNG
// — pngjs keeps it pure JS, no native image libraries to break a deploy.
import { PNG } from 'pngjs';
import { OG_BASE, GLYPHS, CELLS } from '../lib/ogassets.mjs';

const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;

const decode = b64 => PNG.sync.read(Buffer.from(b64, 'base64'));

// alpha-blend src (white glyph on transparent) onto dst at (ox, oy)
const stamp = (dst, src, ox, oy) => {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const a = src.data[(src.width * y + x) * 4 + 3] / 255;
      if (!a) continue;
      const si = (src.width * y + x) * 4;
      const di = (dst.width * (oy + y) + (ox + x)) * 4;
      for (let c = 0; c < 3; c++) {
        dst.data[di + c] = Math.round(src.data[si + c] * a + dst.data[di + c] * (1 - a));
      }
    }
  }
};

export default async (req) => {
  const url = new URL(req.url);
  let code = (url.searchParams.get('code') || '').toUpperCase();
  if (!CODE_RE.test(code)) {
    // fallback: the original /og/<code> path survives the rewrite
    code = (url.pathname.split('/').filter(Boolean).pop() || '').toUpperCase();
  }
  if (!CODE_RE.test(code)) return new Response('not found', { status: 404 });

  const img = decode(OG_BASE);
  [...code].forEach((ch, i) => stamp(img, decode(GLYPHS[ch]), CELLS.xs[i], CELLS.y));
  const out = PNG.sync.write(img);

  return new Response(out, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
      'netlify-cdn-cache-control': 'public, durable, max-age=604800',
    },
  });
};
