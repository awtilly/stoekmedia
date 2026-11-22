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


/* A save that gives up while adding a player (the room was busy: it lost every race) hands the player to another
 * save of this phone that is still on its way. That save may be one that only carries a setting. */
/** The phone goes Home and comes straight back into the same room: a new visit, same screen copy. */
const comeBack = app => {
  app.db.collection = () => ({ doc: id => ({ id, onSnapshot: () => () => {} }) });
  app.connectToRoom('AAAA');
};
const rest = async r => { for (let n = 0; n < 3; n++) { await r.fire(); for (let i = 1; i < r.txs.length; i++) if (!r.txs[i].done && !r.txs[i].failed) await r.finish(i); } };

test('a player handed to a save that only carries a setting reaches the room when the phone goes Home and back', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();                                           // save 1 (adds n1) is on its way
  r.set('ub', false);
  await r.fire();                                           // save 2 (the setting) too; to it n1 is already sent
  await r.refuse(0, 'aborted');                             // save 1 gives up: n1 goes to save 2
  comeBack(r.app);
  r.deliver(r.now());                                       // the first update of the new visit: no n1 in the room
  await rest(r);
  assert.deepEqual(ids(r.server().players), ['n1', 'p1']);
  assert.equal(r.server().ub, false);
  r.deliver(r.now());
  assert.deepEqual(ids(r.app.S.players), ['n1', 'p1']);
}));

test('the same without Home: the player reaches the room once', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.set('ub', false);
  await r.fire();
  await r.refuse(0, 'aborted');
  await rest(r);
  r.deliver(r.now());
  await rest(r);
  assert.deepEqual(ids(r.server().players), ['n1', 'p1']);
  assert.deepEqual(ids(r.app.S.players), ['n1', 'p1']);
  assert.equal(r.server().ub, false);
}));

test('a handed-over player taken off this screen again is not written by the save they were handed to', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.set('ub', false);
  await r.fire();
  await r.refuse(0, 'aborted');
  r.app.S.players = r.app.S.players.filter(p => p.id !== 'n1');
  r.app._debouncedFirestoreWrite();
  await rest(r);
  r.deliver(r.now());
  await rest(r);
  assert.deepEqual(ids(r.server().players), ['p1']);
  assert.deepEqual(ids(r.app.S.players), ['p1']);
}));
