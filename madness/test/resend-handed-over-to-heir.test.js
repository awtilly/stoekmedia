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

/* Save 1 adds a player and is refused. The add is handed to save 2 (a setting only), which lists the player but
 * writes no roster. Save 3, started before the refusal and still on its way, lists the player too and lands them.
 * The add used to be taken out of this phone's books when save 2 turned out not to write them: taking the player
 * off the screen afterwards was "nothing to save", and save 3 put them in the room for good. */
test('a player handed to a save that writes no roster is handed on to the running save that lists them', withTimers(async () => {
  const { app, finish, refuse, fire, flush, deliver, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 adds n1 (stays on its way)
  set('ub', false);
  await fire();                                     // save 2: a setting; it lists n1
  set('players', app.S.players.concat([N('n2')]));
  await fire();                                     // save 3 adds n2; it lists n1 too
  await refuse(0);                                  // save 1 is refused: n1 is handed to save 2
  await finish(1);                                  // save 2 lands, without a roster
  txs[2].go(); await flush();                       // save 3 has built its roster, with n1
  set('players', app.S.players.filter(p => p.id !== 'n1')); // n1 is taken off this screen
  await fire();                                     // save 4 carries that
  await finish(2);                                  // save 3 lands n1
  for (let round = 0; round < 3; round++) {
    await fire();
    for (let i = 3; i < txs.length; i++) await finish(i);
    deliver(now());
  }
  assert.deepEqual(ids(server().players), ['n2', 'p1'], 'the removed player is not in the room');
  assert.deepEqual(ids(app.S.players), ['n2', 'p1']);
  assert.equal(server().ub, false);
}));

test('the same, and the player stays: the running save that lists them adds them once', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  set('ub', false);
  await fire();
  set('players', app.S.players.concat([N('n2')]));
  await fire();
  await refuse(0);
  await finish(1);
  await finish(2);
  for (let round = 0; round < 3; round++) {
    await fire();
    for (let i = 3; i < txs.length; i++) await finish(i);
    deliver(now());
  }
  assert.deepEqual(ids(server().players), ['n1', 'n2', 'p1']);
  assert.deepEqual(ids(app.S.players), ['n1', 'n2', 'p1']);
}));

test('a handed-over player no other running save lists is still sent again', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 adds n1
  set('ub', false);
  await fire();                                     // save 2: a setting; it lists n1
  await refuse(0);                                  // n1 is handed to save 2, which writes no roster
  await finish(1);
  for (let round = 0; round < 3; round++) {
    await fire();
    for (let i = 2; i < txs.length; i++) await finish(i);
    deliver(now());
  }
  assert.deepEqual(ids(server().players), ['n1', 'p1'], 'a new save added them');
  assert.deepEqual(ids(app.S.players), ['n1', 'p1']);
}));
