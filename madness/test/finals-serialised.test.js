const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* checkGameFinals() is called from the scoreboard listener (which fires Firestore's cached copy and then the
 * server's back to back), from the 30 s poll and from the 1.5 s fallback, and it awaits Firestore reads per final.
 * Two overlapping runs over the same new final both wrote the gameResult (the second with the post-game order as
 * rankingsBefore) and the run that lost the race could park the game in _pendingAdvance for good. Runs are now
 * serialised, so the second run sees the first run's _reportedFinals entry and does nothing. */
function liveApp() {
  const app = createApp({ phase: 'live' });
  vm.runInThisContext('_unsyncedAdvances.clear(); _pendingAdvance.clear()');
  const writes = [];
  const pendingGets = []; // resolvers for resultRef.get(): the test decides when Firestore answers
  app.roomId = 'room1';
  app.db = { collection: () => ({ doc: () => ({
    get: async () => ({ exists: true, data: () => ({ state: JSON.stringify({ bracket: app.S.bracket }) }) }),
    collection: () => ({ doc: (id) => ({
      get: () => new Promise(res => pendingGets.push(() => res({ exists: writes.some(w => w.id === id) }))),
      set: async (d) => { writes.push({ id, ...d }); } }) })
  }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  const T = id => app.S.teams.find(t => t.id === id);
  const setFeed = (games) => { globalThis.__games = games; vm.runInThisContext('liveScores = globalThis.__games'); };
  const pendingAdvanceSize = () => vm.runInThisContext('_pendingAdvance.size');
  return { app, writes, pendingGets, T, setFeed, pendingAdvanceSize };
}
const withId = (g, id) => { g.id = id; return g; };
const tick = () => new Promise(r => setImmediate(r));

test('checkGameFinals: two overlapping runs over one new final write the result once and park nothing', async () => {
  const { app, writes, pendingGets, T, setFeed, pendingAdvanceSize } = liveApp();
  setFeed([withId(finalGame(T('South-16'), T('South-1'), T('South-1')), 'ser-r64')]);
  const first = app.checkGameFinals();  // the cached snapshot
  const second = app.checkGameFinals(); // the server snapshot, a moment later
  await tick();
  assert.equal(pendingGets.length, 1, 'the second run waits for the first instead of reading Firestore at the same time');
  pendingGets.shift()();
  await first;
  await tick();
  assert.equal(pendingGets.length, 0, 'the second run finds the final already reported: no read');
  await second;
  assert.equal(writes.length, 1, 'the gameResult is written once');
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(pendingAdvanceSize(), 0, 'nothing parked in _pendingAdvance');
  assert.equal(app.__calls.saveState, 1, 'the first reporter saves the bracket once');
});

test('checkGameFinals: a run that throws does not block the runs after it', async () => {
  const { app, writes, pendingGets, T, setFeed } = liveApp();
  setFeed([withId(finalGame(T('East-16'), T('East-1'), T('East-1')), 'ser-throw')]);
  const saved = app.scores;
  app.scores = () => { throw new Error('boom'); };
  await assert.rejects(app.checkGameFinals());
  app.scores = saved;
  const run = app.checkGameFinals();
  await tick();
  assert.equal(pendingGets.length, 1, 'the next run proceeds to its Firestore read');
  pendingGets.shift()();
  await run;
  assert.equal(writes.length, 1);
});

test('checkGameFinals: still awaitable from the callers that feed it one scoreboard at a time', async () => {
  const { app, writes, pendingGets, T, setFeed } = liveApp();
  setFeed([withId(finalGame(T('West-16'), T('West-1'), T('West-1')), 'ser-seq')]);
  const run = app.checkGameFinals();
  await tick();
  pendingGets.shift()();
  await run;
  assert.equal(writes.length, 1);
  setFeed([]);
  await app.checkGameFinals(); // nothing to report: resolves without a Firestore read
  assert.equal(pendingGets.length, 0);
});
