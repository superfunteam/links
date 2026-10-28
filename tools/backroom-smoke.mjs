#!/usr/bin/env node
// Smoke test for the backroom's pure rules (netlify/lib/chain.mjs) and the
// staff password helpers. Usage: node tools/backroom-smoke.mjs
import assert from 'node:assert/strict';
import {
  checkChain, checkDay, dayWarnings, checkNod, parOf, linksOf, normHole, daysBetween
} from '../netlify/lib/chain.mjs';
import { hashPassword, verifyPassword, secretEquals, hasRole, tempPassword } from '../netlify/lib/staff.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const msgs = errs => errs.map(e => e.msg).join(' | ');

console.log('chain rules');
t('valid 3-word chain', () => assert.deepEqual(checkChain('mob', ['move', 'on', 'board']), []));
t('seed length', () => { assert.equal(checkChain('AB', ['AX', 'BY']).length, 1); assert.equal(checkChain('ABCDEF', []).length, 1); });
t('seed letters only', () => assert.equal(checkChain('A1B', ['A', 'B', 'C']).length, 1));
t('word count matches seed', () => assert.match(msgs(checkChain('MOB', ['MOVE', 'ON'])), /needs 3 words/));
t('initials follow seed', () => {
  const e = checkChain('MOB', ['MOVE', 'IN', 'BOARD']);
  assert.equal(e.length, 1); assert.equal(e[0].word, 1);
});
t('word length 2..10', () => {
  assert.equal(checkChain('MOB', ['M', 'ON', 'BOARD']).length, 1);
  assert.equal(checkChain('MOB', ['MOVEMENTSXX', 'ON', 'BOARD']).length, 1);
  assert.deepEqual(checkChain('MOB', ['MOVEMENTSX', 'ON', 'BOARD']), []);
});
t('A-Z words only', () => assert.equal(checkChain('MOB', ['MO-VE', 'ON', 'BOARD']).length, 1));
t('no repeated word', () => assert.match(msgs(checkChain('EYE', ['EYE', 'YES', 'EYE'])), /used twice/));
t('links lowercased', () => assert.deepEqual(linksOf(['MOVE', 'ON', 'BOARD']), ['move on', 'on board']));
t('normHole computes links', () => assert.deepEqual(normHole({ seed: 'mob', words: [' move', 'on', 'board '] }),
  { seed: 'MOB', words: ['MOVE', 'ON', 'BOARD'], links: ['move on', 'on board'] }));

console.log('par');
t('3 words -> 3', () => assert.equal(parOf(['A', 'B', 'C']), 3));
t('4 words -> 4', () => assert.equal(parOf(['A', 'B', 'C', 'D']), 4));
t('5 words -> 6', () => assert.equal(parOf(['A', 'B', 'C', 'D', 'E']), 6));

console.log('day rules');
const day = [
  { seed: 'MOB', words: ['MOVE', 'ON', 'BOARD'] },
  { seed: 'EBB', words: ['EYE', 'BALL', 'BOY'] },
  { seed: 'AWE', words: ['ART', 'WORK', 'ETHIC'] },
  { seed: 'SLOP', words: ['SECOND', 'LOOK', 'OUT', 'POST'] },
  { seed: 'PUT', words: ['PIN', 'UP', 'TOWN'] },
];
t('valid day', () => assert.deepEqual(checkDay({ name: 'Left Field', holes: day }), []));
t('needs a name', () => assert.equal(checkDay({ name: '  ', holes: day })[0].hole, null));
t('exactly 5 holes', () => assert.match(msgs(checkDay({ name: 'X', holes: day.slice(0, 4) })), /exactly 5/));
t('repeated seed', () => {
  const e = checkDay({ name: 'X', holes: [...day.slice(0, 4), { seed: 'MOB', words: ['MAKE', 'OVER', 'BOARD'] }] });
  assert.ok(e.some(x => x.hole === 4 && /Seed MOB/.test(x.msg)));
});
t('repeated word across holes', () => {
  const e = checkDay({ name: 'X', holes: [...day.slice(0, 4), { seed: 'PUB', words: ['PIN', 'UP', 'BOARD'] }] });
  assert.ok(e.some(x => x.hole === 4 && x.word === 2 && /BOARD/.test(x.msg)));
});
t('repeated link across holes', () => {
  const e = checkDay({ name: 'X', holes: [...day.slice(0, 4), { seed: 'MOT', words: ['MOVE', 'ON', 'TOP'] }] });
  assert.ok(e.some(x => x.hole === 4 && /move on/.test(x.msg)));
});
t('hole errors carry index', () => {
  const e = checkDay({ name: 'X', holes: [...day.slice(0, 4), { seed: 'PUT', words: ['PIN', 'UP'] }] });
  assert.ok(e.some(x => x.hole === 4));
});

console.log('day warnings');
t('daysBetween', () => { assert.equal(daysBetween('2026-10-01', '2026-10-04'), 3); assert.equal(daysBetween('2026-10-04', '2026-10-01'), -3); });
const others = [
  { date: '2026-11-02', name: 'Back Nine', holes: [{ seed: 'MOT', words: ['MOVE', 'ON', 'TOP'] }] },          // link within 3
  { date: '2026-11-20', name: 'Other', holes: [{ seed: 'EBB', words: ['EGG', 'BEATER', 'BOX'] }] },          // seed within 28
  { date: '2026-11-08', name: 'Echo', holes: [{ seed: 'SLOT', words: ['SECOND', 'LOOK', 'OUT', 'TAKE'] }] }, // 3 shared within 10
  { date: '2026-12-10', name: 'Left Field', holes: [] },                                                       // name within 45
  { date: '2026-11-01', name: 'Self', holes: day },                                                           // same date: ignored
];
const w = dayWarnings('2026-11-01', 'Left Field', day, others);
t('link reuse warned', () => assert.ok(w.some(x => x.hole === 0 && /move on/.test(x.msg))));
t('seed reuse warned', () => assert.ok(w.some(x => x.hole === 1 && /Seed EBB/.test(x.msg))));
t('echo warned', () => assert.ok(w.some(x => x.hole === 3 && /shares 3 words/.test(x.msg))));
t('name reuse warned', () => assert.ok(w.some(x => x.hole === null && /Left Field/.test(x.msg))));
t('same date ignored', () => assert.ok(!w.some(x => /2026-11-01/.test(x.msg))));
t('far days quiet', () => {
  const far = others.map(o => ({ ...o, date: '2027-06-01' }));
  assert.deepEqual(dayWarnings('2026-11-01', 'Left Field', day, far), []);
});

console.log('nods');
const nod = { icon: 'watch', text: 'Pants started as pantaloons.', label: 'Hear the story.', url: 'https://example.org/a?b=1' };
t('valid nod', () => assert.deepEqual(checkNod(nod).errors, []));
t('icon set', () => assert.equal(checkNod({ ...nod, icon: 'video' }).errors.length, 1));
t('https only', () => {
  assert.equal(checkNod({ ...nod, url: 'http://example.org' }).errors.length, 1);
  assert.equal(checkNod({ ...nod, url: 'javascript:alert(1)' }).errors.length, 1);
  assert.equal(checkNod({ ...nod, url: 'https://exa mple.org' }).errors.length, 1);
});
t('url <= 600', () => assert.equal(checkNod({ ...nod, url: 'https://e.org/' + 'a'.repeat(600) }).errors.length, 1));
t('text 1..140', () => {
  assert.equal(checkNod({ ...nod, text: '' }).errors.length, 1);
  assert.equal(checkNod({ ...nod, text: 'x'.repeat(141) }).errors.length, 1);
  assert.deepEqual(checkNod({ ...nod, text: 'x'.repeat(140) }).errors, []);
});
t('label 1..140', () => assert.equal(checkNod({ ...nod, label: '   ' }).errors.length, 1));
t('control chars stripped', () => assert.equal(checkNod({ ...nod, text: 'a\u0000b​c' }).nod.text, 'a bc'));

console.log('staff');
const hash = await hashPassword('correct horse battery');
t('hash format', () => assert.match(hash, /^scrypt\$16384\$8\$1\$/));
const [good, badPw] = await Promise.all([verifyPassword('correct horse battery', hash), verifyPassword('wrong', hash)]);
t('verify', () => { assert.equal(good, true); assert.equal(badPw, false); });
const [h1, h2, junk] = await Promise.all([hashPassword('x'), hashPassword('x'), verifyPassword('x', 'nope')]);
t('salted', () => assert.notEqual(h1, h2));
t('garbage hash rejected', () => assert.equal(junk, false));
t('secretEquals', () => { assert.ok(secretEquals('abc', 'abc')); assert.ok(!secretEquals('abc', 'abd')); assert.ok(!secretEquals('', '')); });
t('roles', () => {
  assert.ok(hasRole({ role: 'owner' }, 'editor')); assert.ok(!hasRole({ role: 'viewer' }, 'editor'));
  assert.ok(hasRole({ role: 'editor' }, 'viewer')); assert.ok(!hasRole(null, 'viewer'));
});
t('temp password', () => assert.match(tempPassword(), /^[a-zA-Z2-9]{14}$/));

console.log(`\n${n} checks passed`);
