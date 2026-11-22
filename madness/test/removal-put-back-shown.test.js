const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Same hand-stepped fake server as roster-failed-add-handover.test.js. */
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


/* A player is taken off here; while that save is on its way the screen keeps them off whatever an update says.
 * A phone that had been offline then sends its old copy of the whole room (the plain write), which has the
 * player, and that update arrives after the removal has landed but before the server's confirmation reaches this
 * phone. The player is in the room again and nothing is on its way from here any more, yet this screen went on
 * hiding them. */
/** Saves land as usual, but the app is only told so when the returned function is called. */
const holdConfirmation = app => {
  const run = app.db.runTransaction;
  let tell;
  const told = new Promise(r => { tell = r; });
  app.db.runTransaction = async fn => { await run(fn); await told; };
  return tell;
};

test('a removed player an offline phone put back is shown again once the removal is confirmed', withTimers(async () => {
  const { app, finish, fire, deliver, elsewhere, set, server, flush } = stampedRoom();
  deliver(elsewhere(r => { r.players.push(N('o1')); }));
  assert.deepEqual(ids(app.S.players), ['o1', 'p1']);
  const confirm = holdConfirmation(app);
  set('players', app.S.players.filter(p => p.id !== 'o1'));
  await fire();
  await finish(0);
  assert.deepEqual(ids(server().players), ['p1'], 'the removal landed');
  deliver(elsewhere(r => { r.players.push(N('o1')); })); // the other phone's old copy lands on top of it
  assert.deepEqual(ids(app.S.players), ['p1'], 'kept off the screen while the removal is not confirmed');
  confirm();
  await flush();
  assert.deepEqual(ids(server().players), ['o1', 'p1']);
  assert.deepEqual(ids(app.S.players), ['o1', 'p1'], 'this screen shows what the room holds');
}));

test('a removed player stays off when the update that arrives before the confirmation is the removal itself', withTimers(async () => {
  const { app, finish, fire, deliver, elsewhere, now, set, server, flush } = stampedRoom();
  deliver(elsewhere(r => { r.players.push(N('o1')); }));
  const confirm = holdConfirmation(app);
  set('players', app.S.players.filter(p => p.id !== 'o1'));
  await fire();
  await finish(0);
  deliver(now());
  confirm();
  await flush();
  assert.deepEqual(ids(server().players), ['p1']);
  assert.deepEqual(ids(app.S.players), ['p1']);
}));
