const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp, finalGame } = require('./_harness');

/* checkGameFinals(): the gameResults report must carry the leaderboard AFTER the game (rankingsAfter)
 * as well as before it. The notifyGameFinal Cloud Function recomputed "after" from the room document,
 * which still holds the pre-game state when the report lands (the bracket write is debounced), so the
 * leaderboard shake-up push never fired. liveScores and _reportedFinals are module bindings in 20-live.js. */
let setLive = null, reported = null;

function finalsApp() {
  // Bob already has one win (East-1 advanced); Ann has none. Ann's 16-seed is about to upset a 1-seed.
  const app = createApp({
    players: [{ id: 'ann', name: 'Ann', teamIds: ['South-16'] }, { id: 'bob', name: 'Bob', teamIds: ['East-1'] }]
  });
  setLive = setLive || vm.runInThisContext('(v) => { liveScores = v; }');
  reported = reported || vm.runInThisContext('_reportedFinals');
  reported.clear();
  app.S.bracket.East[0] = 'East-1';
  app.syncGames();
  app.roomId = 'R';
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } };
  const calls = { set: 0, payload: null };
  const docRef = {
    async get() { return { exists: false }; },
    async set(data) { calls.set++; calls.payload = data; }
  };
  app.db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => docRef }) }) }) };
  app.getMyPlayerId = () => 'ann';
  const t = id => app.S.teams.find(x => x.id === id);
  setLive([finalGame(t('South-16'), t('South-1'), t('South-16'))]);
  return { app, calls };
}

test('the report carries rankingsBefore (Bob leads) and rankingsAfter (Ann leads after the upset)', async () => {
  const { app, calls } = finalsApp();
  assert.deepEqual(app.scores().map(s => s.pid), ['bob', 'ann'], 'precondition: Bob leads before the game');
  await app.checkGameFinals();
  assert.equal(calls.set, 1);
  assert.deepEqual(calls.payload.rankingsBefore, ['bob', 'ann']);
  assert.deepEqual(calls.payload.rankingsAfter, ['ann', 'bob']);
  assert.equal(app.S.bracket.South[0], 'South-16', 'bracket advanced locally');
  assert.equal(app.__calls.saveState, 1, 'first reporter still writes the room state');
});

test('a final that does not touch the bracket reports identical before/after rankings', async () => {
  const { app, calls } = finalsApp();
  const t = id => app.S.teams.find(x => x.id === id);
  // South-2 vs South-3 are not opponents in any open bracket slot (R1 pairs 2 with 15, 3 with 14)
  setLive([finalGame(t('South-2'), t('South-3'), t('South-2'))]);
  await app.checkGameFinals();
  assert.equal(calls.set, 1, 'still reported (one of the teams is in the room)');
  assert.deepEqual(calls.payload.rankingsAfter, calls.payload.rankingsBefore);
  assert.equal(app.__calls.saveState, 0, 'nothing advanced, nothing to sync');
});
