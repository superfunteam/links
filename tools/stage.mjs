#!/usr/bin/env node
// Assembles the publishable site into public/. Only what's listed here reaches the
// web — puzzles.json, the phrase graph and the tooling stay in the repo, because
// serving them would hand out every answer in plaintext.
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';

const ASSETS = ['index.html', 'favicon.png', 'ogimage.png', 'site.webmanifest'];
const NESTED = { 'backroom.html': 'backroom/index.html' };

rmSync('public', { recursive: true, force: true });
mkdirSync('public', { recursive: true });

let copied = 0;
for (const f of ASSETS) {
  if (existsSync(f)) { copyFileSync(f, `public/${f}`); copied++; }
  else console.warn(`  (skipped missing ${f})`);
}
for (const [src, dest] of Object.entries(NESTED)) {
  if (!existsSync(src)) { console.warn(`  (skipped missing ${src})`); continue; }
  mkdirSync(`public/${dest.split('/')[0]}`, { recursive: true });
  copyFileSync(src, `public/${dest}`); copied++;
}
console.log(`✓ staged ${copied} file(s) into public/`);
