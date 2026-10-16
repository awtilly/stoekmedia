const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp, finalGame } = require('./_harness');

/* checkGameFinals(): solo rooms (no roomId) must still auto-advance the bracket from ESPN finals,
 * and a final whose gameResults write failed must be retried on the next poll. liveScores and
 * _reportedFinals are module-level bindings in 20-live.js, reached through vm. */
const setLive = vm.runInThisContext('(v) => { liveScores = v; }');
const reported = vm.runInThisContext('_reportedFinals');

function finalsApp(roomId, dbBehaviour) {
  reported.clear();
  const app = createApp({ players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }] });
  app.roomId = roomId;
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } };
  const calls = { get: 0, set: 0 };
  const docRef = {
    async get() { calls.get++; if (dbBehaviour.failGet) throw new Error('offline'); return { exists: !!dbBehaviour.exists }; },
    async set() { calls.set++; }
  };
  app.db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => docRef }) }) }) };
  app.getMyPlayerId = () => 'p1';
  const t = id => app.S.teams.find(x => x.id === id);
  setLive([finalGame(t('South-16'), t('South-1'), t('South-1'))]);
  return { app, calls };
}

test('solo room (no roomId): the final advances the bracket, nothing is written, and it is not reprocessed', async () => {
  const { app, calls } = finalsApp(null, {});
  await app.checkGameFinals();
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(calls.get + calls.set, 0);
  assert.equal(app.__calls.render, 1);
  assert.equal(reported.size, 1);
  await app.checkGameFinals();
  assert.equal(app.__calls.render, 1, 'second poll: already reported, no re-render');
});

test('room: a failed gameResults read still advances locally but is retried on the next poll', async () => {
  const { app, calls } = finalsApp('R', { failGet: true });
  await app.checkGameFinals();
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(reported.size, 0, 'not marked reported after a failure');
  assert.equal(app.__calls.saveState, 0, 'not the first reporter: no Firestore state write');
  const docRef = app.db.collection().doc().collection().doc();
  docRef.get = async () => { calls.get++; return { exists: false }; };
  await app.checkGameFinals();
  assert.equal(calls.set, 1, 'retry reported the final');
  assert.equal(reported.size, 1);
  assert.equal(app.__calls.saveState, 0, 'bracket already advanced on the first pass: nothing new to sync');
  await app.checkGameFinals();
  assert.equal(calls.set, 1, 'third poll is a no-op');
});

test('room: first reporter writes the result once and syncs state', async () => {
  const { app, calls } = finalsApp('R', { exists: false });
  await app.checkGameFinals();
  assert.equal(calls.set, 1);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(reported.size, 1);
  await app.checkGameFinals();
  assert.equal(calls.set, 1);
});

test('room: a final already reported by another client advances locally without writing', async () => {
  const { app, calls } = finalsApp('R', { exists: true });
  await app.checkGameFinals();
  assert.equal(calls.set, 0);
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(app.__calls.saveState, 0);
  assert.equal(reported.size, 1);
});
