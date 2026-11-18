const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* advanceFF(ffIdx, teamId) in js/70-logic.js is the Final Four twin of advanceTeam: it receives the team the page
 * showed when the slot was tapped and writes it after `await requireAdmin()`, which on the first admin action of a
 * session is a PIN prompt. If another admin changes a regional final, a semifinal or the Final Four pairing while
 * the prompt is open, the stale tap crowned a team that was no longer in that game, and the standings counted it.
 * Now a team the game no longer holds is refused with a toast; the winner must be tapped again. */
const lastToast = (app) => app.__calls.toasts[app.__calls.toasts.length - 1];

function finalFour(app) {
  const b = app.S.bracket;
  b.South[14] = 'South-1'; b.East[14] = 'East-1'; b.Midwest[14] = 'Midwest-1'; b.West[14] = 'West-1';
  app.S.ffPairs = [['South', 'East'], ['Midwest', 'West']];
  return b;
}

test('semifinal: a regional final changes during the PIN prompt -> the stale winner is refused', async () => {
  const app = createApp();
  const b = finalFour(app);
  app.requireAdmin = async () => { b.South[14] = 'South-2'; return true; }; // other phone: the 2 seed won the South after all
  await app.advanceFF(0, 'South-1');
  assert.equal(b.ff[0], null, 'South-1 is not in the semifinal any more');
  assert.equal(app.__calls.saveState, 0);
  assert.match(lastToast(app), /^That game changed while the PIN prompt was open/);
});

test('semifinal: the Final Four pairing changes during the PIN prompt -> a team from the other semifinal is refused', async () => {
  const app = createApp();
  const b = finalFour(app);
  app.requireAdmin = async () => { app.S.ffPairs = [['South', 'West'], ['East', 'Midwest']]; return true; };
  await app.advanceFF(0, 'East-1'); // East was in semifinal 1 when it was tapped; it now plays in semifinal 2
  assert.equal(b.ff[0], null);
  assert.equal(app.__calls.saveState, 0);
});

test('title game: a semifinal result changes during the PIN prompt -> the stale champion is refused', async () => {
  const app = createApp();
  const b = finalFour(app);
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1';
  app.requireAdmin = async () => { b.ff[0] = 'East-1'; return true; }; // other phone: East won that semifinal
  await app.advanceFF(2, 'South-1');
  assert.equal(b.ff[2], null, 'no champion who lost the semifinal');
  assert.equal(app.__calls.saveState, 0);
  assert.match(lastToast(app), /^That game changed/);
});

test('title game: a semifinal is cleared during the PIN prompt -> refused', async () => {
  const app = createApp();
  const b = finalFour(app);
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1';
  app.requireAdmin = async () => { b.ff[0] = null; return true; };
  await app.advanceFF(2, 'South-1');
  assert.equal(b.ff[2], null);
  assert.equal(app.__calls.saveState, 0);
});

test('the ordinary taps still work: both semifinals, the title game, and changing a semifinal winner', async () => {
  const app = createApp();
  const b = finalFour(app);
  await app.advanceFF(0, 'East-1');
  await app.advanceFF(1, 'Midwest-1');
  await app.advanceFF(2, 'East-1');
  assert.deepEqual([b.ff[0], b.ff[1], b.ff[2]], ['East-1', 'Midwest-1', 'East-1']);
  await app.advanceFF(0, 'South-1'); // corrected: the other team won the semifinal; the champion no longer stands
  assert.deepEqual([b.ff[0], b.ff[2]], ['South-1', null]);
  assert.equal(app.__calls.saveState, 4);
  assert.equal(app.__calls.toasts.length, 0);
});

test('a room without a stored pairing uses the default one for the check', async () => {
  const app = createApp();
  const b = finalFour(app);
  delete app.S.ffPairs;
  const def = app.ffPairs();
  const inFirst = b[def[0][0]][14], inSecond = b[def[1][0]][14];
  await app.advanceFF(0, inSecond);
  assert.equal(b.ff[0], null, 'a team from the other semifinal is refused');
  await app.advanceFF(0, inFirst);
  assert.equal(b.ff[0], inFirst);
});

test('a game with no team known yet is left alone (the bracket tests set winners directly)', async () => {
  const app = createApp();
  await app.advanceFF(0, 'South-1');
  assert.equal(app.S.bracket.ff[0], 'South-1');
  await app.advanceFF(2, 'South-1');
  assert.equal(app.S.bracket.ff[2], 'South-1');
});
