const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* checkGameFinals must ignore games that are not NCAA tournament games. On Selection Sunday two bracket
 * teams can meet in a conference final, and NIT games run on the same days as the first rounds; neither
 * may become a gameResult (push alert, upset flag, bracket advance). ncaa.com tags tournament games (and
 * only those) with a bracketId, which ncaa.parseScoreboard turns into the `tournament` flag; everything
 * else is skipped. Replayed from the real 2026 scoreboards: 9 conference games produced gameResults writes
 * before this guard existed. */
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
  g.id = 'conf-1'; g.tournament = false; g.note = '';
  await feed([g]);
  assert.deepEqual(writes, []);
  assert.equal(app.S.bracket.South.filter(Boolean).length, 0);
  assert.equal(app.__calls.saveState, 0);
});

test('checkGameFinals: an NCAA tournament game is reported and advances the bracket', async () => {
  const { app, writes, T, feed } = liveApp();
  const g = finalGame(T('South-16'), T('South-1'), T('South-1'));
  g.id = 'ncaa-1';
  await feed([g]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, 'ncaa-1');
  assert.equal(writes[0].winnerName, 'South 1');
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(app.__calls.saveState, 1);
});

test('checkGameFinals: a game without the tournament flag is not processed even with an NCAA-looking note', async () => {
  const { app, writes, T, feed } = liveApp();
  const g = finalGame(T('East-9'), T('East-8'), T('East-9'));
  g.id = 'noflag-1'; delete g.tournament; g.note = 'NCAA Tournament - First Round';
  await feed([g]);
  assert.equal(writes.length, 0);
  assert.equal(app.S.bracket.East[1], null);
});

test('checkGameFinals: a skipped non-tournament game is not remembered as reported', async () => {
  const { app, writes, T, feed } = liveApp();
  const g = finalGame(T('West-5'), T('West-12'), T('West-12'));
  g.id = 'same-id'; g.tournament = false;
  await feed([g]);
  assert.equal(writes.length, 0);
  g.tournament = true;
  await feed([g]);
  assert.equal(writes.length, 1, 'the same game id flagged as a tournament game is processed afterwards');
  assert.equal(app.S.bracket.West[2], 'West-12');
});
