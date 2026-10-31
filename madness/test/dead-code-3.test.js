const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./_harness');

function fourRegionWinners(b) {
  b.South[14] = 'South-1'; b.East[14] = 'East-1'; b.Midwest[14] = 'Midwest-1'; b.West[14] = 'West-1';
}

test('advanceTeam: the Final Four cascade lives in cascadeFF(), not a second inline copy', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '70-logic.js'), 'utf8');
  const start = src.indexOf('async function advanceTeam(');
  const end = src.indexOf('function clearDownstream(');
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /cascadeFF\(\);/, 'advanceTeam delegates to cascadeFF');
  assert.doesNotMatch(body, /ffPairs/, 'no inline Final Four loop');
  assert.doesNotMatch(body, /FEEDERS/, 'no inline copy of clearDownstream');
  assert.equal(body.split('clearDownstream(').length, 2, 'exactly one clearDownstream call');
});

test('advanceTeam: changing a region winner still clears the Final Four pick and champion built on it', async () => {
  const app = createApp();
  const b = app.S.bracket;
  fourRegionWinners(b);
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1'; b.ff[2] = 'South-1';
  await app.advanceTeam('South', 14, 'South-2');
  assert.equal(b.ff[0], null);
  assert.equal(b.ff[2], null);
  assert.equal(b.ff[1], 'West-1');
  assert.equal(b.ff[3], undefined);
});

test('clearBracketGame: clearing a region winner also clears a champion picked from the OTHER semifinal', async () => {
  const app = createApp();
  const b = app.S.bracket;
  fourRegionWinners(b);
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1'; b.ff[2] = 'West-1';
  await app.clearBracketGame('South', 14);
  assert.equal(b.South[14], null);
  assert.equal(b.ff[0], null, 'semifinal with the cleared region is reopened');
  assert.equal(b.ff[1], 'West-1', 'other semifinal untouched');
  assert.equal(b.ff[2], null, 'title game cannot stand with one semifinal undecided (previously left stale)');
});

test('cascadeFF: a consistent bracket is left untouched', () => {
  const app = createApp();
  const b = app.S.bracket;
  fourRegionWinners(b);
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1'; b.ff[2] = 'West-1';
  app.cascadeFF();
  assert.deepEqual(b.ff, ['South-1', 'West-1', 'West-1']);
});
