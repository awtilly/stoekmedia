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
        // t.rerun: the save is in the room, its confirmation is lost, and Firestore runs the function again later
        if (t.rerun) { t.rerun = false; await new Promise(r => { t.ack = r; }); t.done = false; continue; }
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

/* With no connection a save falls back to the plain write, which sends this phone's whole copy of the room. For a
 * save of an earlier visit that copy was the one taken when the save started, also when the phone was back in the
 * same room and had been shown a newer one: everything the room had got since was replaced by the old copy. */
/** The phone goes Home and comes straight back into the same room: a new visit, same screen copy. */
const comeBack = app => {
  app.db.collection = () => ({ doc: id => ({ id, onSnapshot: () => () => {} }) });
  app.connectToRoom('AAAA');
};
/** The plain writes land in the fake room; connectToRoom needs collection() for its listener, so both are served. */
const plainWrites = r => {
  r.app.db.collection = () => ({ doc: id => ({ id, onSnapshot: () => () => {}, set: async data => { r.srv.state = data.state; r.srv.v++; } }) });
};

test('an offline save of an earlier visit does not take out a player another phone added once this phone is back in the room', withTimers(async () => {
  const r = stampedRoom();
  r.set('year', 2028);
  await r.fire();                                           // save 1 is on its way
  comeBack(r.app);
  plainWrites(r);
  r.deliver(r.now());                                       // the new visit is shown the room
  r.deliver(r.elsewhere(room => { room.players.push(N('o1')); })); // another phone adds a player
  assert.deepEqual(ids(r.app.S.players), ['o1', 'p1']);
  await r.refuse(0, 'unavailable');                         // no connection: save 1 becomes the plain write
  assert.deepEqual(ids(r.server().players), ['o1', 'p1'], 'the other phone\'s player is still in the room');
  assert.equal(r.server().year, 2028, 'the setting this save was carrying is in the room');
}));

test('an offline save of an earlier visit does not undo this phone\'s own newer save', withTimers(async () => {
  const r = stampedRoom();
  r.set('year', 2028);
  await r.fire();                                           // save 1 is on its way
  comeBack(r.app);
  plainWrites(r);
  r.deliver(r.now());
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await r.finish(1);                                        // save 2 (the new player) lands
  assert.deepEqual(ids(r.server().players), ['n1', 'p1']);
  await r.refuse(0, 'unavailable');                         // save 1 gives up on the connection only now
  assert.deepEqual(ids(r.server().players), ['n1', 'p1'], 'the player this phone added in the new visit is still in the room');
  assert.equal(r.server().year, 2028);
}));

test('an offline save still sends its own copy when the phone is not in that room any more', withTimers(async () => {
  const r = stampedRoom();
  r.set('year', 2028);
  await r.fire();
  const mine = JSON.parse(r.app._sharedJson());
  r.app.roomId = null;                                      // Home
  r.app._roomGeneration = (r.app._roomGeneration || 0) + 1;
  r.elsewhere(room => { room.ub = false; });
  await r.refuse(0, 'unavailable');
  assert.deepEqual(r.server(), mine, 'the copy the save was made from, as before');
}));
