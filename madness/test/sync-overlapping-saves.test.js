const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Three orderings found by running several simulated phones against one room with random delivery order.
 * The fake server here is stepped by hand: every transaction stops before its read and before its commit until
 * the test lets it go on, commits fail and re-run when the document changed (as Firestore does), and snapshots
 * reach this device only when the test delivers them. */
function steppedRoom() {
  const app = createApp();
  const srv = { state: null, v: 0 };
  const txs = [];
  const flush = () => new Promise(r => setImmediate(r));
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: async fn => {
      const t = { go: null, done: false, runs: 0 };
      txs.push(t);
      const gate = () => new Promise(r => { t.go = r; });
      for (;;) {
        await gate();
        const read = srv.state, v = srv.v;
        let out = null;
        t.runs++;
        await fn({ get: async () => ({ exists: true, data: () => ({ state: read }) }), set: (ref, data) => { out = data.state; } });
        await gate();
        if (srv.v !== v) continue;
        srv.state = out; srv.v++; t.done = true;
        return;
      }
    }
  };
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _lastSnapshotPlayerIds = null; _syncedShared = null; _sharedAtSync = null; _queuedPlainWrites = {}; _writeRetries = 0;');
  vm.runInThisContext('_serverSeen = null; _recentSent = []; _snapshotSeq = 0; _writeSeq = 0; _keyWriteNo = {};');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  const deliver = state => app._applyRoomSnapshot({ exists: true, data: () => ({ state }), metadata: {} });
  const shared = JSON.parse(JSON.stringify(app.S));
  for (const k of app.eval('VIEW_LOCAL')) delete shared[k];
  shared.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  srv.state = JSON.stringify(shared);
  deliver(srv.state); // the snapshot this device joined with
  return {
    app, srv, txs, deliver,
    server: () => JSON.parse(srv.state),
    /** Lets transaction i take its next step (read + compute, or commit). */
    step: async i => { txs[i].go(); await flush(); },
    /** The 800 ms debounce runs out: the save starts and waits before its read. */
    fire: async () => { mock.timers.tick(800); await flush(); },
    /** Another phone changes the room; nothing reaches this device until deliver(). Returns the new state. */
    elsewhere: fn => { const r = JSON.parse(srv.state); fn(r); srv.state = JSON.stringify(r); srv.v++; return srv.state; },
    tap: (region, gi, id) => { app.S.bracket[region][gi] = id; app._debouncedFirestoreWrite(); }
  };
}
const withTimers = fn => async () => { mock.timers.enable({ apis: ['setTimeout'] }); try { await fn(); } finally { mock.timers.reset(); } };

test('a second result tapped while the first is being saved survives another phone\'s unrelated change and the first save\'s echo', withTimers(async () => {
  const { app, txs, step, fire, elsewhere, deliver, tap, server, srv } = steppedRoom();
  tap('South', 0, 'South-1');
  await fire();                                   // save 1 is on its way
  const theirs = elsewhere(r => { r.rp[3] = 9; }); // another phone changes a scoring value
  tap('South', 1, 'South-8');                     // second tap: waiting in the debounce
  deliver(theirs);                                // the other phone's change arrives; it predates save 1
  assert.equal(app.S.rp[3], 9, 'the other phone\'s change is shown');
  assert.equal(app.S.bracket.South[0], 'South-1', 'the first result is still on screen');
  assert.equal(app.S.bracket.South[1], 'South-8', 'the second result is still on screen');
  await step(0); await step(0);                   // save 1 reads, then commits
  assert.equal(txs[0].done, true);
  deliver(srv.state);                             // its echo: the server now shows the first result only
  assert.equal(app.S.bracket.South[1], 'South-8', 'the second result survives the echo of the first save');
  await fire();
  await step(1); await step(1);                   // save 2
  assert.equal(server().bracket.South[0], 'South-1');
  assert.equal(server().bracket.South[1], 'South-8', 'the second result reached the server');
  assert.equal(server().rp[3], 9, 'the other phone\'s change was not undone');
}));

test('another phone changing the SAME setting still wins over an edit waiting in the debounce', withTimers(async () => {
  const { app, fire, step, elsewhere, deliver, tap, server } = steppedRoom();
  tap('South', 0, 'South-1');
  await fire(); await step(0); await step(0);     // save 1 done
  deliver(JSON.stringify(server()));
  tap('South', 1, 'South-8');                     // waiting in the debounce
  deliver(elsewhere(r => { r.bracket.South[0] = 'South-16'; })); // somebody else corrects game 0
  assert.equal(app.S.bracket.South[0], 'South-16', 'the other phone\'s bracket is shown');
  assert.equal(app.S.bracket.South[1], null, 'as before, the whole bracket is theirs');
}));

test('snapshots applied during a save are noticed even when they end on the state the save started from', withTimers(async () => {
  const { app, srv, step, fire, elsewhere, deliver, tap, server } = steppedRoom();
  const v1 = elsewhere(r => { r.bracket.East[0] = 'East-1'; }); // another phone enters a result; not delivered yet
  tap('South', 0, 'South-1');
  await fire(); await step(0); await step(0);     // our save replaces the bracket (v2); its echo is still on its way
  const v2 = srv.state;
  app.S.ub = false; app._debouncedFirestoreWrite();
  await fire();                                   // save 2 (the ub change) starts and waits before its read
  deliver(v1); deliver(v2);                       // both late snapshots arrive now: the screen is back on v2
  await step(1); await step(1);                   // save 2 commits
  assert.equal(server().ub, false, 'the change reached the server');
  deliver(srv.state);                             // and its echo arrives
  assert.equal(app.S.ub, false, 'this device shows what the server holds');
}));

test('an older save that is re-run after a newer one from this phone landed does not put its older copy back', withTimers(async () => {
  const { txs, step, fire, tap, server } = steppedRoom();
  tap('South', 0, 'South-1');
  await fire(); await step(0);                    // save 1 has read the room and is held up before its commit
  tap('South', 1, 'South-8');
  await fire(); await step(1); await step(1);     // save 2 (both results) goes through first
  assert.equal(txs[1].done, true);
  await step(0);                                  // save 1's commit is refused: the room changed
  await step(0); await step(0);                   // Firestore runs it again, and it commits
  assert.equal(txs[0].done, true);
  assert.equal(txs[0].runs, 2);
  assert.equal(server().bracket.South[0], 'South-1');
  assert.equal(server().bracket.South[1], 'South-8', 'the newer result is still there');
}));
