#!/usr/bin/env node
// Assembles the publishable site into public/. Only what's listed here reaches the
// web — puzzles.json, the phrase graph and the tooling stay in the repo, because
// serving them would hand out every answer in plaintext.
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';

const ASSETS = ['index.html', 'favicon.png', 'ogimage.png', 'site.webmanifest'];

rmSync('public', { recursive: true, force: true });
mkdirSync('public', { recursive: true });

let copied = 0;
for (const f of ASSETS) {
  if (existsSync(f)) { copyFileSync(f, `public/${f}`); copied++; }
  else console.warn(`  (skipped missing ${f})`);
}
console.log(`✓ staged ${copied} file(s) into public/`);
