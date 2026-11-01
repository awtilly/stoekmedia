const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* A final seen before its bracket feeders are filled used to be remembered as reported and never retried,
 * so that device's bracket stayed stuck (2026 replay with 03/21 fed before 03/19: 41/60 slots, no champion).
 * Pending finals are now retried on every poll and saved when they finally advance. */
function liveApp() {
  const app = createApp({ phase: 'live' });
  const writes = [];
  app.roomId = 'room1';
  app.db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: (id) => ({
    get: async () => ({ exists: writes.some(w => w.id === id) }), set: async (d) => { writes.push({ id, ...d }); } }) }) }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  const T = id => app.S.teams.find(t => t.id === id);
  const feed = async (games) => { globalThis.__games = games; vm.runInThisContext('liveScores = globalThis.__games'); await app.checkGameFinals(); };
  return { app, writes, T, feed };
}
const withId = (g, id) => { g.id = id; return g; };

test('checkGameFinals: a Round of 32 final seen before its feeders is reported, kept pending, and advanced on a later poll', async () => {
  const { app, writes, T, feed } = liveApp();
  await feed([withId(finalGame(T('South-8'), T('South-1'), T('South-1')), 'r32')]);
  assert.equal(writes.length, 1, 'result is reported right away');
  assert.equal(app.S.bracket.South[8], null, 'no slot can be decided yet');
  assert.equal(app.__calls.saveState, 0);
  await feed([withId(finalGame(T('South-16'), T('South-1'), T('South-1')), 'r64a'), withId(finalGame(T('South-9'), T('South-8'), T('South-8')), 'r64b')]);
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(app.S.bracket.South[1], 'South-8');
  assert.equal(app.S.bracket.South[8], 'South-1', 'the pending Round of 32 final advanced in the same poll');
  assert.equal(writes.length, 3, 'the pending final is not reported twice');
  assert.ok(app.__calls.saveState >= 1, 'the advance reaches Firestore');
});

test('checkGameFinals: within one poll the order of games does not matter', async () => {
  const { app, T, feed } = liveApp();
  await feed([
    withId(finalGame(T('East-8'), T('East-1'), T('East-1')), 'e-r32'),
    withId(finalGame(T('East-16'), T('East-1'), T('East-1')), 'e-r64a'),
    withId(finalGame(T('East-9'), T('East-8'), T('East-8')), 'e-r64b')
  ]);
  assert.equal(app.S.bracket.East[8], 'East-1');
});

test('checkGameFinals: a pending final advances on a later poll even when the feeders were filled by a room snapshot', async () => {
  const { app, T, feed } = liveApp();
  await feed([withId(finalGame(T('West-5'), T('West-4'), T('West-5')), 'w-r32')]);
  assert.equal(app.S.bracket.West[9], null);
  app.S.bracket.West[2] = 'West-5'; app.S.bracket.West[3] = 'West-4'; // another device advanced Round of 64
  await feed([]);
  assert.equal(app.S.bracket.West[9], 'West-5');
  assert.ok(app.__calls.saveState >= 1);
});

test('checkGameFinals: a final with only one room team is never kept pending', async () => {
  const { app, T, feed } = liveApp();
  const outsider = { id: 'x', name: 'Outsider', seed: 3, abbr: 'OUT', ncaaId: 'e-outsider', region: 'None' };
  await feed([withId(finalGame(T('Midwest-2'), outsider, outsider), 'odd')]);
  await feed([]);
  assert.equal(app.__calls.saveState, 0);
  assert.equal(app.__calls.render, 0);
});
