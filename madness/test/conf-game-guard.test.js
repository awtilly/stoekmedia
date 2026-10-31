const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* checkGameFinals must ignore conference-tournament games. On Selection Sunday two bracket teams can meet in a
 * conference final; ESPN names those games after the conference, and every NCAA tournament game
 * "NCAA Men's Basketball Championship - <Region> - <Round>". Replayed from the real 2026 scoreboards:
 * 9 such conference games produced gameResults writes before this guard. */
function liveApp() {
  const app = createApp({ phase: 'live' });
  const writes = [];
  app.roomId = 'room1';
  app.db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: (id) => ({
    get: async () => ({ exists: false }), set: async (d) => { writes.push({ id, ...d }); } }) }) }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  const T = id => app.S.teams.find(t => t.id === id);
  const feed = async (games) => { globalThis.__games = games; vm.runInThisContext('liveScores = globalThis.__games'); await app.checkGameFinals(); };
  return { app, writes, T, feed };
}

test('checkGameFinals: a conference-tournament final between two bracket teams is not reported', async () => {
  const { app, writes, T, feed } = liveApp();
  const g = finalGame(T('South-1'), T('South-2'), T('South-2'));
  g.id = 'conf-1'; g.note = 'Big Ten Tournament - Final';
  await feed([g]);
  assert.deepEqual(writes, []);
  assert.equal(app.S.bracket.South.filter(Boolean).length, 0);
  assert.equal(app.__calls.saveState, 0);
});

test('checkGameFinals: an NCAA tournament game is reported and advances the bracket', async () => {
  const { app, writes, T, feed } = liveApp();
  const g = finalGame(T('South-16'), T('South-1'), T('South-1'));
  g.id = 'ncaa-1'; g.note = "NCAA Men's Basketball Championship - South Region - 1st Round";
  await feed([g]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, 'ncaa-1');
  assert.equal(writes[0].winnerName, 'South 1');
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(app.__calls.saveState, 1);
});

test('checkGameFinals: a game without any note is still processed (older payloads)', async () => {
  const { app, writes, T, feed } = liveApp();
  const g = finalGame(T('East-9'), T('East-8'), T('East-9'));
  g.id = 'nonote-1'; g.note = '';
  await feed([g]);
  assert.equal(writes.length, 1);
  assert.equal(app.S.bracket.East[1], 'East-9');
});

test('checkGameFinals: a skipped conference game is not remembered as reported', async () => {
  const { app, writes, T, feed } = liveApp();
  const g = finalGame(T('West-5'), T('West-12'), T('West-12'));
  g.id = 'same-id'; g.note = 'Mountain West Tournament - Final';
  await feed([g]);
  assert.equal(writes.length, 0);
  g.note = "NCAA Men's Basketball Championship - West Region - 1st Round";
  await feed([g]);
  assert.equal(writes.length, 1, 'the same event id with an NCAA note is processed afterwards');
  assert.equal(app.S.bracket.West[2], 'West-12');
});
