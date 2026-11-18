const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* sanitizeSharedState() in js/70-logic.js runs on every room snapshot and on every load from localStorage. It
 * already normalises ids and seeds. The year, the per-round point values, the upset-bonus switch and the draft
 * clock are printed by the page as plain numbers (the footer scoring line everyone sees, the Settings tab), so
 * they have to arrive as numbers and booleans as well, whatever the stored document says. */
const TEXT = '<b>not a number</b>';

test('sanitizeSharedState: year, points per round, upset bonus and draft clock become numbers and booleans', () => {
  const app = createApp();
  const s = { year: TEXT, rp: { 1: TEXT, 2: '2', 3: null, 4: 8, 5: 16, 6: 32, 7: 'extra' }, ub: 'yes', draftClockDuration: TEXT };
  app.sanitizeSharedState(s);
  assert.equal(s.year, new Date().getFullYear(), 'an unusable year falls back to this year');
  assert.deepEqual(s.rp, { 1: 0, 2: 2, 3: 0, 4: 8, 5: 16, 6: 32 }, 'exactly rounds 1-6, numbers only');
  assert.equal(s.ub, true);
  assert.equal(s.draftClockDuration, 0);
  assert.doesNotMatch(JSON.stringify(s), /</, 'nothing printable as markup survives');
});

test('sanitizeSharedState: ordinary settings pass through unchanged', () => {
  const app = createApp();
  const s = { year: 2027, rp: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 20, 6: 40 }, ub: false, draftClockDuration: 90 };
  app.sanitizeSharedState(s);
  assert.deepEqual(s, { year: 2027, rp: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 20, 6: 40 }, ub: false, draftClockDuration: 90 });
});

test('sanitizeSharedState: a point value stored as text, a fractional year and a negative clock are repaired', () => {
  const app = createApp();
  const s = { year: '2026.9', rp: { 1: '3', 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 }, ub: 0, draftClockDuration: -60 };
  app.sanitizeSharedState(s);
  assert.equal(s.year, 2026);
  assert.equal(s.rp[1], 3);
  assert.equal(typeof s.rp[1], 'number');
  assert.equal(s.ub, false);
  assert.equal(s.draftClockDuration, 0);
});

test('sanitizeSharedState: a missing rp object becomes six zero rounds; a partial state gains no settings keys', () => {
  const app = createApp();
  const s = { rp: null };
  app.sanitizeSharedState(s);
  assert.deepEqual(s.rp, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  const partial = { players: [] };
  app.sanitizeSharedState(partial);
  assert.deepEqual(Object.keys(partial), ['players']);
});

test('the footer scoring line renders numbers from a sanitised state (the live default state passes)', () => {
  const app = createApp();
  app.sanitizeSharedState(app.S);
  assert.deepEqual(app.S.rp, { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 });
  assert.equal(typeof app.S.year, 'number');
  assert.equal(app.S.ub, true);
});
