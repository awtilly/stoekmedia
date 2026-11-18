const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* Which regional champions meet in each national semifinal is set by the committee every year: 2025 was
 * South-West and East-Midwest, 2026 East-South and West-Midwest. The app assumed South-East / Midwest-West
 * for every year; replaying the real 2025 tournament filled all four regions and then left both semifinals
 * pending while the title game (Florida-Houston) landed in the Midwest-West semifinal slot, so there was no
 * champion. S.ffPairs now carries the room's pairing, read from the bracket feed on import (each regional final's
 * victorBracketPositionId names its semifinal), with the old assumption as the default for existing rooms. */
const bracket2026 = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-bracket-2026.json'), 'utf8'));

/** The 2026 feed rewired the way 2025 was: South and West into 601, East and Midwest into 602. */
function bracket2025Shaped() {
  const data = bracket2026();
  const champ = data.championships[0];
  const sect = {};
  for (const r of champ.regions) sect[String(r.title || '').trim().toLowerCase()] = r.sectionId;
  for (const g of champ.games) {
    if (Math.floor(g.bracketId / 100) !== 5) continue;
    g.victorBracketPositionId = (g.sectionId === sect.south || g.sectionId === sect.west) ? 601 : 602;
  }
  return data;
}

function liveApp(pairs) {
  const app = createApp({ phase: 'live' });
  if (pairs !== undefined) app.S.ffPairs = pairs;
  const writes = [];
  app.roomId = 'room1';
  app.db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: (id) => ({
    get: async () => ({ exists: false }), set: async (d) => { writes.push(id); } }) }) }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  const T = id => app.S.teams.find(t => t.id === id);
  const feed = async (games) => { globalThis.__games = games; vm.runInThisContext('liveScores = globalThis.__games'); await app.checkGameFinals(); };
  // regional champions: the 1 seeds
  for (const r of app.REGIONS) app.S.bracket[r][14] = r + '-1';
  return { app, writes, T, feed };
}

test('finalFourPairs: the real 2026 bracket pairs East with South and West with Midwest', () => {
  const app = createApp();
  assert.deepEqual(app.ncaa.finalFourPairs(bracket2026()), [['South', 'East'], ['Midwest', 'West']]);
});

test('finalFourPairs: a 2025-shaped bracket pairs South with West and East with Midwest', () => {
  const app = createApp();
  assert.deepEqual(app.ncaa.finalFourPairs(bracket2025Shaped()), [['South', 'West'], ['East', 'Midwest']]);
});

test('finalFourPairs: null when the feed is missing, has no semifinals, or links a final nowhere', () => {
  const app = createApp();
  assert.equal(app.ncaa.finalFourPairs(null), null);
  assert.equal(app.ncaa.finalFourPairs({ championships: [] }), null);
  const d = bracket2026();
  d.championships[0].games = d.championships[0].games.filter(g => Math.floor(g.bracketId / 100) !== 6);
  assert.equal(app.ncaa.finalFourPairs(d), null, 'no semifinal games');
  const e = bracket2026();
  e.championships[0].games.find(g => g.bracketId === 503).victorBracketPositionId = null;
  assert.equal(app.ncaa.finalFourPairs(e), null, 'a regional final that feeds nothing');
});

test('ffPairs: the old South-East / Midwest-West assumption when the room has no or an invalid pairing', () => {
  const app = createApp();
  assert.deepEqual(app.ffPairs(), [['South', 'East'], ['Midwest', 'West']]);
  app.S.ffPairs = [['South', 'South'], ['East', 'West']];
  assert.deepEqual(app.ffPairs(), [['South', 'East'], ['Midwest', 'West']], 'duplicate region');
  app.S.ffPairs = [['South', 'West'], ['East', 'Midwest']];
  assert.deepEqual(app.ffPairs(), [['South', 'West'], ['East', 'Midwest']]);
  assert.equal(app.ffPairingIndex(), 1);
  app.S.ffPairs = [['Midwest', 'East'], ['West', 'South']];
  assert.equal(app.ffPairingIndex(), 1, 'same pairing written in another order');
});

test('autoAdvanceBracket: with the 2025 pairing the South-West semifinal, the East-Midwest semifinal and the final all advance', async () => {
  const { app, writes, T, feed } = liveApp([['South', 'West'], ['East', 'Midwest']]);
  await feed([finalGame(T('South-1'), T('West-1'), T('West-1'))]);
  assert.equal(app.S.bracket.ff[0], 'West-1');
  await feed([finalGame(T('East-1'), T('Midwest-1'), T('Midwest-1'))]);
  assert.equal(app.S.bracket.ff[1], 'Midwest-1');
  await feed([finalGame(T('West-1'), T('Midwest-1'), T('West-1'))]);
  assert.equal(app.S.bracket.ff[2], 'West-1');
  assert.equal(writes.length, 3);
  assert.equal(app.eval('_pendingAdvance.size'), 0);
  const ff = app.S.games.filter(g => g.round >= 5).map(g => [g.id, g.t1, g.t2, g.wid]);
  assert.deepEqual(ff, [['ff_0', 'South-1', 'West-1', 'West-1'], ['ff_1', 'East-1', 'Midwest-1', 'Midwest-1'], ['champ', 'West-1', 'Midwest-1', 'West-1']]);
});

test('autoAdvanceBracket: under the default pairing a South-West game is not a semifinal (it waits), South-East is', async () => {
  const { app, T, feed } = liveApp();
  // fresh game ids: _reportedFinals is module state and the previous test already reported 'g-South-1-West-1'
  const sw = finalGame(T('South-1'), T('West-1'), T('West-1')); sw.id = 'default-sw';
  await feed([sw]);
  assert.deepEqual(app.S.bracket.ff, [null, null, null]);
  assert.equal(app.eval('_pendingAdvance.size'), 1, 'both teams are ours, no slot matched: parked');
  const se = finalGame(T('South-1'), T('East-1'), T('East-1')); se.id = 'default-se';
  await feed([se]);
  assert.equal(app.S.bracket.ff[0], 'East-1');
  app.eval('_pendingAdvance.clear()');
});

test('setFinalFourPairing: admin-only; switching the pairing clears a semifinal winner that no longer fits and the title game', async () => {
  const app = createApp();
  for (const r of app.REGIONS) app.S.bracket[r][14] = r + '-1';
  app.S.bracket.ff = ['East-1', 'West-1', 'West-1']; // default pairing: East beat South, West beat Midwest, West champion
  app.requireAdmin = async () => false;
  await app.setFinalFourPairing(1);
  assert.equal(app.S.ffPairs, undefined, 'refused without admin');
  assert.equal(app.__calls.render, 1, 'a refused change redraws, so the select snaps back to the room\'s pairing');
  assert.equal(app.__calls.saveState, 0);
  app.requireAdmin = async () => true;
  await app.setFinalFourPairing(1); // South-West / East-Midwest
  assert.deepEqual(app.S.ffPairs, [['South', 'West'], ['East', 'Midwest']]);
  assert.deepEqual(app.S.bracket.ff, [null, null, null], 'East-1 is not in South-West, West-1 is not in East-Midwest, so both semis and the final clear');
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.__calls.render, 2);
  await app.setFinalFourPairing(1);
  assert.equal(app.__calls.saveState, 1, 'choosing the current pairing again is a no-op');
  await app.setFinalFourPairing(9);
  assert.equal(app.__calls.saveState, 1, 'unknown index ignored');
});

test('setFinalFourPairing: a semifinal winner that still fits its new pair is kept', async () => {
  const app = createApp();
  for (const r of app.REGIONS) app.S.bracket[r][14] = r + '-1';
  app.S.bracket.ff = ['South-1', null, null]; // South beat East under the default pairing
  await app.setFinalFourPairing(2); // South-Midwest / East-West: South-1 is still in pair 0
  assert.deepEqual(app.S.bracket.ff, ['South-1', null, null]);
  assert.deepEqual(app.S.games.filter(g => g.round === 5).map(g => [g.t1, g.t2, g.wid]), [['South-1', 'Midwest-1', 'South-1']]);
});
