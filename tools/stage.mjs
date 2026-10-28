#!/usr/bin/env node
// Assembles the publishable site into public/. Only what's listed here reaches the
// web — puzzles.json, the phrase graph and the tooling stay in the repo, because
// serving them would hand out every answer in plaintext.
import { mkdirSync, copyFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const ASSETS = ['index.html', 'favicon.png', 'ogimage.png', 'site.webmanifest', 'sw.js', 'words.txt'];

rmSync('public', { recursive: true, force: true });
mkdirSync('public', { recursive: true });

let copied = 0;
for (const f of ASSETS) {
  if (existsSync(f)) { copyFileSync(f, `public/${f}`); copied++; }
  // index.html must ship: without it, /index.html falls through to the invite
  // function, whose self-fetch would then recurse. Fail the build instead.
  // words.txt too: without the file, the catch-all serves HTML with a 200 and
  // the client-side validation just disables the typo check — fail loudly instead
  else if (f === 'index.html' || f === 'words.txt') { console.error(`  FATAL: ${f} missing`); process.exit(1); }
  else console.warn(`  (skipped missing ${f})`);
}

// ── Backroom: static shell + ES modules + compiled Tailwind CSS ─────────────
// backroom/src stays in the repo (Tailwind input only); everything else under
// backroom/index.html and backroom/js/** ships as-is (no bundler).
const copyTree = (src, dest) => {
  for (const name of readdirSync(src)) {
    const s = join(src, name), d = join(dest, name);
    if (statSync(s).isDirectory()) copyTree(s, d);
    else { mkdirSync(dirname(d), { recursive: true }); copyFileSync(s, d); copied++; }
  }
};
if (!existsSync('backroom/index.html')) { console.error('  FATAL: backroom/index.html missing'); process.exit(1); }
mkdirSync('public/backroom', { recursive: true });
copyFileSync('backroom/index.html', 'public/backroom/index.html'); copied++;
copyTree('backroom/js', 'public/backroom/js');

try {
  execFileSync('npx', ['--no-install', '@tailwindcss/cli', '-i', 'backroom/src/app.css', '-o', 'public/backroom/app.css', '--minify'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  console.error('  FATAL: backroom CSS compile failed\n' + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
}
if (!existsSync('public/backroom/app.css')) { console.error('  FATAL: public/backroom/app.css not produced'); process.exit(1); }
copied++;

console.log(`✓ staged ${copied} file(s) into public/`);
