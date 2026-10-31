const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* Only the first device to report a final saves the bracket to Firestore; every other device advanced its local
 * copy only. If the first reporter's save never landed, the next room snapshot wiped that local advance and, with
 * the gameResult already written, no device was ever "first" again, so the slot stayed empty until the commissioner
 * filled it by hand. A non-first reporter now re-applies its advance on every poll and, 30 s after the final, reads
 * the room document once: if the winner is missing from the remote bracket it saves the slot itself.
 * Game ids are unique per test because 20-live.js keeps _reportedFinals / _unsyncedAdvances for the whole process. */
const realNow = Date.now;
let clock = 1_000_000;
test.beforeEach(() => { clock = 1_000_000; Date.now = () => clock; });
test.after(() => { Date.now = realNow; });

function liveApp(existingIds) {
  const app = createApp({ phase: 'live' });
  vm.runInThisContext('_unsyncedAdvances.clear()'); // module-level in 20-live.js: do not let one test's entry leak into the next
  const writes = existingIds.map(id => ({ id }));
  const room = { reads: 0, bracket: null, fail: false }; // what the room document says the bracket is
  app.roomId = 'room1';
  app.db = { collection: () => ({ doc: () => ({
    get: async () => {
      room.reads++;
      if (room.fail) throw new Error('offline');
      return { exists: true, data: () => ({ state: JSON.stringify({ bracket: room.bracket }) }) };
    },
    collection: () => ({ doc: (id) => ({
      get: async () => ({ exists: writes.some(w => w.id === id) }), set: async (d) => { writes.push({ id, ...d }); } }) })
  }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  const T = id => app.S.teams.find(t => t.id === id);
  const feed = async (games) => { globalThis.__games = games; vm.runInThisContext('liveScores = globalThis.__games'); await app.checkGameFinals(); };
  const snapshotBracket = () => JSON.parse(JSON.stringify(app.S.bracket));
  return { app, writes, room, T, feed, snapshotBracket };
}
const withId = (g, id) => { g.id = id; return g; };

test('checkGameFinals: a non-first reporter advances locally without writing the result, the bracket, or reading the room', async () => {
  const { app, writes, room, T, feed, snapshotBracket } = liveApp(['a-r64']);
  room.bracket = snapshotBracket();
  await feed([withId(finalGame(T('South-16'), T('South-1'), T('South-1')), 'a-r64')]);
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(writes.length, 1, 'the existing gameResult is not rewritten');
  assert.equal(app.__calls.saveState, 0);
  assert.equal(room.reads, 0, 'no room read inside the 30 s grace');
});

test('checkGameFinals: a slot missing from the room document 30 s after the final is re-filled and saved exactly once', async () => {
  const { app, room, T, feed, snapshotBracket } = liveApp(['b-r64']);
  room.bracket = snapshotBracket(); // the first reporter\'s save never landed: the remote bracket stays empty
  await feed([withId(finalGame(T('East-16'), T('East-1'), T('East-1')), 'b-r64')]);
  app.S.bracket.East[0] = null; // a room snapshot without the slot wiped the local advance
  clock += 5_000;
  await feed([]);
  assert.equal(app.S.bracket.East[0], 'East-1', 're-applied locally inside the grace');
  assert.equal(app.__calls.saveState, 0, 'the first reporter may still be saving');
  assert.equal(room.reads, 0);
  app.S.bracket.East[0] = null;
  clock += 26_000;
  await feed([]);
  assert.equal(app.S.bracket.East[0], 'East-1');
  assert.equal(room.reads, 1, 'the room document is read once');
  assert.equal(app.__calls.saveState, 1);
  await feed([]);
  assert.equal(room.reads, 1, 'the entry is gone: no further reads');
  assert.equal(app.__calls.saveState, 1, 'saved exactly once');
});

test('checkGameFinals: a slot the first reporter did save is never written by a non-first reporter', async () => {
  const { app, room, T, feed, snapshotBracket } = liveApp(['c-r64']);
  await feed([withId(finalGame(T('Midwest-16'), T('Midwest-1'), T('Midwest-1')), 'c-r64')]);
  room.bracket = snapshotBracket(); // the remote bracket has the winner
  clock += 31_000;
  await feed([]);
  assert.equal(room.reads, 1);
  assert.equal(app.__calls.saveState, 0);
  app.S.bracket.Midwest[0] = null; // a later deliberate removal by the admin is not undone
  await feed([]);
  assert.equal(app.S.bracket.Midwest[0], null);
  assert.equal(app.__calls.saveState, 0);
  assert.equal(room.reads, 1);
});

test('checkGameFinals: a failed room read is retried on the next poll', async () => {
  const { app, room, T, feed, snapshotBracket } = liveApp(['d-r64']);
  room.bracket = snapshotBracket();
  await feed([withId(finalGame(T('West-16'), T('West-1'), T('West-1')), 'd-r64')]);
  room.fail = true;
  clock += 31_000;
  await feed([]);
  assert.equal(room.reads, 1);
  assert.equal(app.__calls.saveState, 0, 'nothing is saved on an unverified read');
  room.fail = false;
  await feed([]);
  assert.equal(room.reads, 2);
  assert.equal(app.__calls.saveState, 1);
});

test('checkGameFinals: leaving the room drops the pending advance without a read or a save', async () => {
  const { app, room, T, feed, snapshotBracket } = liveApp(['e-r64']);
  room.bracket = snapshotBracket();
  await feed([withId(finalGame(T('South-15'), T('South-2'), T('South-2')), 'e-r64')]);
  app.roomId = null;
  clock += 31_000;
  await feed([]);
  assert.equal(room.reads, 0);
  assert.equal(app.__calls.saveState, 0);
});
