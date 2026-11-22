const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Same hand-stepped fake server as roster-failed-add-handover.test.js (one transaction can be refused). */
function stampedRoom() {
  const app = createApp();
  const srv = { state: null, v: 0 };
  const txs = [];
  const flush = () => new Promise(r => setImmediate(r));
  const stamp = v => ({ seconds: 1000 + v, nanoseconds: 0 });
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = {
    // set: the plain write of the offline fallback, as if Firestore's queue had delivered it at once
    collection: () => ({ doc: id => ({ id, set: async data => { srv.state = data.state; srv.v++; } }) }),
    runTransaction: async fn => {
      const t = { go: null, fail: null, done: false, failed: false };
      txs.push(t);
      const gate = () => new Promise((r, no) => { t.go = r; t.fail = code => { t.failed = true; no(Object.assign(new Error('refused'), { code: code || 'permission-denied' })); }; });
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
  app.showToast = () => {};
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _lastSnapshotPlayerIds = null; _syncedShared = null; _sharedAtSync = null; _queuedPlainWrites = {}; _writeRetries = 0;');
  vm.runInThisContext('_serverSeen = null; _recentSent = []; _snapshotSeq = 0; _writeSeq = 0; _keyWriteNo = {}; _inFlight = {}; _rosterInFlight = {}; _rosterGone = {}; _rosterAcked = {}; _rosterRemovedNo = {}; _rosterRemoving = {}; _knownAtExit = {}; _visitSaves = {}; _savesRunning = {}; _knownEver = []; _writeNoRoom = "AAAA"; _pendingBase = {}; _echoWriteNo = 0; _lastRoomDoc = null; _pickInFlight = false;');
  vm.runInThisContext('if(typeof _saveSends !== "undefined"){ _saveSends = {}; _saveBuilt = {}; _handedOver = {}; }');
  vm.runInThisContext('if(typeof _addLanded !== "undefined") _addLanded = {};');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
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
    app, srv, txs, deliver, now, flush,
    server: () => JSON.parse(srv.state),
    finish: async i => { for (let n = 0; n < 8 && !txs[i].done; n++) { txs[i].go(); await flush(); } assert.equal(txs[i].done, true); },
    /** The transaction is refused (not a lost race: the save gives up). */
    refuse: async (i, code) => { txs[i].fail(code); await flush(); await flush(); },
    fire: async () => { mock.timers.tick(800); await flush(); },
    elsewhere: fn => { const r = JSON.parse(srv.state); fn(r); srv.state = JSON.stringify(r); srv.v++; return now(); },
    set: (k, v) => { app.S[k] = v; app._debouncedFirestoreWrite(); }
  };
}
const withTimers = fn => async () => { mock.timers.enable({ apis: ['setTimeout'] }); try { await fn(); } finally { mock.timers.reset(); } };
const N = id => ({ id, name: id, teamIds: [] });
const ids = list => list.map(p => p.id).sort();

/* Save 1 adds a player and stays on its way; save 2 lists them and leaves
 * them to save 1. Save 1 fails for good: nothing is handed over (save 2 has built its roster, without the player).
 * Save 2 loses a race and runs again: save 1 is gone, so this run writes the player. The player is taken off the
 * screen before that run commits: "nothing to save", and the run lands them. */
test('a player taken off after their adding save failed is not landed by a re-run of another save', withTimers(async () => {
  const { app, finish, refuse, fire, flush, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n7')]));
  await fire();                                     // save 1 adds n7 (stays on its way)
  set('players', app.S.players.concat([N('n8')]));
  await fire();                                     // save 2 adds n8; it lists n7 too, left to save 1
  txs[1].go(); await flush();                       // save 2 has built its roster, without n7
  await refuse(0);                                  // save 1 fails for good
  elsewhere(r => { r.year = 2030; });               // the room changes: save 2 loses the race
  txs[1].go(); await flush();                       // ... and is sent round again
  txs[1].go(); await flush();                       // its second run builds the roster again, now with n7
  set('players', app.S.players.filter(p => p.id !== 'n7')); // n7 is taken off this screen
  deliver(now());                                   // the other phone's update arrives while save 2 is on its way
  await finish(1);                                  // the second run lands
  for (let round = 0; round < 3; round++) {
    await fire();
    for (let i = 2; i < txs.length; i++) await finish(i);
    deliver(now());
  }
  assert.deepEqual(ids(server().players), ['n8', 'p1'], 'the removed player is not in the room');
  assert.deepEqual(ids(app.S.players), ['n8', 'p1']);
}));

/* Save 1 adds a player; save 2 (a setting only) lists them and has built what it writes, without a roster. Save 1
 * fails for good, and another phone's update arrives while save 2 is still on its way. Save 2 lands: it did not
 * write the player, and nothing else is adding them, so they are sent again by a new save. */
test('a player whose adding save failed is sent again when the save they were left to did not write them', withTimers(async () => {
  const { app, finish, refuse, fire, flush, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n7')]));
  await fire();                                     // save 1 adds n7 (stays on its way)
  set('ub', false);
  await fire();                                     // save 2: a setting; it lists n7
  const update = elsewhere(r => { r.year = 2030; }); // another phone's update, still on its way to this phone
  txs[1].go(); await flush();                       // save 2 has built what it writes: no roster
  await refuse(0);                                  // save 1 fails for good
  deliver(update);                                  // the update arrives
  await finish(1);                                  // save 2 lands
  deliver(now());
  for (let round = 0; round < 3; round++) {
    await fire();
    for (let i = 2; i < txs.length; i++) await finish(i);
    deliver(now());
  }
  assert.deepEqual(ids(server().players), ['n7', 'p1'], 'the player is in the room');
  assert.deepEqual(ids(app.S.players), ['n7', 'p1']);
  assert.equal(server().ub, false);
}));
