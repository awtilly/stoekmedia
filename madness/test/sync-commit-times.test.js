const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Every write to the room carries updatedAt, the server's commit time. A save remembers the commit time of the
 * room it was built on, so a snapshot stamped no later than that is known to be older than the save: it must not
 * take the saved value off the screen or become the baseline for the next change, even after the server has
 * confirmed the save (snapshots sent before the commit can still arrive after the confirmation).
 * Same hand-stepped fake server as sync-inflight-edits.test.js, with a commit time on every read and snapshot. */
function stampedRoom() {
  const app = createApp();
  const srv = { state: null, v: 0 };
  const txs = [];
  const flush = () => new Promise(r => setImmediate(r));
  const stamp = v => ({ seconds: 1000 + v, nanoseconds: 0 });
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: async fn => {
      const t = { go: null, done: false };
      txs.push(t);
      const gate = () => new Promise(r => { t.go = r; });
      for (;;) {
        await gate();
        const read = srv.state, v = srv.v;
        let out = null;
        await fn({ get: async () => ({ exists: true, data: () => ({ state: read, updatedAt: stamp(v) }) }), set: (ref, data) => { out = data.state; } });
        await gate();
        if (srv.v !== v) continue;
        srv.state = out; srv.v++; t.done = true;
        return;
      }
    }
  };
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _lastSnapshotPlayerIds = null; _syncedShared = null; _sharedAtSync = null; _queuedPlainWrites = {}; _writeRetries = 0;');
  vm.runInThisContext('_serverSeen = null; _recentSent = []; _snapshotSeq = 0; _writeSeq = 0; _keyWriteNo = {}; _inFlight = {}; _rosterInFlight = {}; _rosterGone = {}; _rosterRemovedNo = {}; _rosterRemoving = {}; _pendingBase = {}; _echoWriteNo = 0; _lastRoomDoc = null; _pickInFlight = false;');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  /** What the room holds right now, with its commit time: a snapshot to deliver later. */
  const now = () => ({ state: srv.state, v: srv.v });
  const deliver = snap => app._applyRoomSnapshot({ exists: true, data: () => ({ state: snap.state, updatedAt: stamp(snap.v) }), metadata: {} });
  const shared = JSON.parse(JSON.stringify(app.S));
  for (const k of app.eval('VIEW_LOCAL')) delete shared[k];
  shared.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  shared.ub = true;
  shared.year = 2027;
  srv.state = JSON.stringify(shared);
  deliver(now()); // the snapshot this device joined with
  return {
    app, srv, txs, deliver, now,
    server: () => JSON.parse(srv.state),
    step: async i => { txs[i].go(); await flush(); },
    finish: async i => { for (let n = 0; n < 8 && !txs[i].done; n++) { txs[i].go(); await flush(); } assert.equal(txs[i].done, true); },
    fire: async () => { mock.timers.tick(800); await flush(); },
    /** Another phone changes the room; nothing reaches this device until deliver(). Returns that snapshot. */
    elsewhere: fn => { const r = JSON.parse(srv.state); fn(r); srv.state = JSON.stringify(r); srv.v++; return now(); },
    set: (k, v) => { app.S[k] = v; app._debouncedFirestoreWrite(); }
  };
}
const withTimers = fn => async () => { mock.timers.enable({ apis: ['setTimeout'] }); try { await fn(); } finally { mock.timers.reset(); } };

test('a snapshot from before a confirmed save does not put the old value back, and choosing that old value again is sent', withTimers(async () => {
  const { app, txs, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const older = elsewhere(r => { r.rp[3] = 9; });   // another phone's change: its snapshot is still on its way
  set('year', 2029);
  await fire();
  await finish(0);                                  // read, committed and confirmed before that snapshot arrives
  assert.equal(server().year, 2029);
  const echo = now();
  deliver(older);                                   // older than the save: the room it shows still says 2027
  assert.equal(app.S.rp[3], 9, 'the other phone\'s change is shown');
  assert.equal(app.S.year, 2029, 'the saved year did not flick back');
  set('year', 2028);
  set('year', 2027);                                // back to what the older snapshot said
  await fire();
  assert.equal(txs.length, 2, 'a change, not "nothing to send"');
  await finish(1);
  assert.equal(server().year, 2027, 'the last year this phone chose is what the server holds');
  deliver(echo);
  deliver(now());
  assert.equal(app.S.year, 2027);
  assert.equal(app.S.rp[3], 9);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), [], 'nothing is held once the room has caught up');
}));

test('a held-back snapshot older than the save is not shown when the save is confirmed', withTimers(async () => {
  const { app, txs, step, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const first = elsewhere(r => { r.rp[3] = 9; });   // two changes on other phones, neither delivered yet
  const second = elsewhere(r => { r.rp[4] = 11; });
  set('ub', false);
  await fire();
  await step(0);                                    // the save reads the room as of the second change
  deliver(first);                                   // older than that: held back for ub
  assert.equal(app.S.ub, false);
  await finish(0);                                  // committed and confirmed
  assert.equal(app.S.ub, false, 'the confirmation did not bring the older snapshot\'s value back');
  const echo = now();
  set('ub', false);                                 // (a change only where the old value had come back)
  set('ub', true);
  await fire();
  assert.equal(txs.length, 2, 'switching it back on is a change');
  await finish(1);
  assert.equal(server().ub, true, 'the last thing this phone chose is what the server holds');
  deliver(second);
  deliver(echo);
  deliver(now());
  assert.equal(app.S.ub, true);
  assert.equal(app.S.rp[3], 9);
  assert.equal(app.S.rp[4], 11);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('the same value in a snapshot older than the save is not taken for the save\'s echo', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const a = elsewhere(r => { r.year = 2029; });     // another phone picks 2029, then goes back to 2027
  const b = elsewhere(r => { r.year = 2027; });
  set('year', 2029);                                // this phone has seen neither and picks 2029 itself
  await fire();
  await finish(0);                                  // built on 2027, confirmed
  assert.equal(server().year, 2029);
  deliver(a);                                       // 2029, but older than the save: not its echo
  deliver(b);                                       // 2027, older than the save as well
  assert.equal(app.S.year, 2029, 'the saved year is still on screen');
  deliver(now());                                   // the save's own snapshot
  assert.equal(app.S.year, 2029);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('a snapshot newer than a confirmed save is still taken at its word', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set } = stampedRoom();
  set('year', 2029);
  await fire();
  await finish(0);
  deliver(elsewhere(r => { r.year = 2027; }));      // another phone sets it back after our save: newer, so it wins
  assert.equal(app.S.year, 2027);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('a snapshot without a commit time is handled as before', withTimers(async () => {
  const { app, finish, fire, elsewhere, set } = stampedRoom();
  const older = elsewhere(r => { r.rp[3] = 9; });
  set('year', 2029);
  await fire();
  await finish(0);
  // (a write of this phone the server has not stamped yet reads as null)
  app._applyRoomSnapshot({ exists: true, data: () => ({ state: older.state, updatedAt: null }), metadata: {} });
  assert.equal(app.S.year, 2027, 'after the confirmation an unstamped snapshot is the server\'s word');
}));
