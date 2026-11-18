const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* advanceTeam(region, gameIdx, teamId) in js/70-logic.js receives the team the page showed when the slot was
 * tapped and writes it into the game after `await requireAdmin()`. On the first admin action of a session that
 * await is a PIN prompt. If another admin phone changes an earlier result while the prompt is open, the room
 * snapshot moves other teams into that game, and the stale tap then crowned a team that was not even playing.
 * Now a team the game no longer shows is refused with a toast; the winner must be tapped again. */
const lastToast = (app) => app.__calls.toasts[app.__calls.toasts.length - 1];

test('advanceTeam: an upstream result changes during the PIN prompt -> the stale winner is refused', async () => {
  const app = createApp();
  const b = app.S.bracket;
  b.South[0] = 'South-1'; b.South[1] = 'South-8'; // Round of 32 game 8 shows 1 v 8
  app.requireAdmin = async () => { b.South[0] = 'South-16'; return true; }; // other phone: the 16 seed won after all
  await app.advanceTeam('South', 8, 'South-1'); // tapped the 1 seed before the prompt
  assert.equal(b.South[8], null, 'the 1 seed is not in that game any more');
  assert.equal(app.__calls.saveState, 0);
  assert.match(lastToast(app), /^That game changed while the PIN prompt was open/);
});

test('advanceTeam: an upstream result is cleared during the PIN prompt -> the stale winner is refused', async () => {
  const app = createApp();
  const b = app.S.bracket;
  b.South[0] = 'South-1'; b.South[1] = 'South-8';
  app.requireAdmin = async () => { b.South[0] = null; return true; }; // other phone: long-pressed the 1 v 16 game clear
  await app.advanceTeam('South', 8, 'South-1');
  assert.equal(b.South[8], null);
  assert.equal(app.__calls.saveState, 0);
});

test('advanceTeam: the ordinary tap still wins the game, including a Round of 64 game (teams come from the seeds)', async () => {
  const app = createApp();
  const b = app.S.bracket;
  b.South[0] = 'South-1'; b.South[1] = 'South-8';
  await app.advanceTeam('South', 8, 'South-1');
  assert.equal(b.South[8], 'South-1');
  await app.advanceTeam('South', 2, 'South-12');
  assert.equal(b.South[2], 'South-12');
  assert.equal(app.__calls.saveState, 2);
  assert.equal(app.__calls.toasts.length, 0);
});

test('advanceTeam: a game with no team known yet is left alone (the bracket tests set winners directly)', async () => {
  const app = createApp();
  await app.advanceTeam('South', 14, 'South-2'); // feeders 12 and 13 are open
  assert.equal(app.S.bracket.South[14], 'South-2');
  assert.equal(app.__calls.saveState, 1);
});
