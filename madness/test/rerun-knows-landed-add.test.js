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

/* A save that adds a player can land while its confirmation is lost; Firestore then runs it again. When this phone
 * has not been shown the room with that player, the only proof that the add landed is what its saves read from the
 * room themselves. */
const secondRun = async (r, i) => { r.txs[i].ack(); await r.flush(); await r.finish(i); await r.flush(); };
const without = id => room => { room.players = room.players.filter(p => p.id !== id); };

test('a save run again does not put back a player another save of this phone has read in the room and who was removed since', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.txs[0].rerun = true;
  await r.finish(0);                                        // the first run lands; its confirmation is lost
  assert.deepEqual(ids(r.server().players), ['n1', 'p1']);
  r.set('ub', false);                                       // no update has reached this phone; a second save starts
  await r.fire();
  r.txs[1].go(); await r.flush();                           // it reads the room, n1 is in it, and waits
  r.elsewhere(without('n1'));                               // removed on another phone (not shown here yet)
  await secondRun(r, 0);                                    // Firestore runs the first save again
  assert.deepEqual(ids(r.server().players), ['p1']);
  await r.finish(1);                                        // the second save is run again too: the room moved
  assert.deepEqual(ids(r.server().players), ['p1']);
  assert.equal(r.server().ub, false);
  r.deliver(r.now());
  assert.deepEqual(ids(r.app.S.players), ['p1']);
}));

test('a save run again that has itself read its player in the room does not put them back after a removal', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.txs[0].rerun = true;
  await r.finish(0);                                        // the first run lands; its confirmation is lost
  r.txs[0].ack(); await r.flush();
  r.txs[0].go(); await r.flush();                           // the second run reads the room: n1 is in it
  r.elsewhere(without('n1'));                               // removed on another phone before the second run is through
  await r.finish(0); await r.flush();                       // so it is run a third time
  assert.deepEqual(ids(r.server().players), ['p1']);
  r.deliver(r.now());
  assert.deepEqual(ids(r.app.S.players), ['p1']);
}));

test('a save that lost a race and never landed still adds its player', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.txs[0].go(); await r.flush();                           // reads the room (no n1 yet)
  r.elsewhere(room => { room.year = 2028; });               // somebody else saves first
  await r.finish(0); await r.flush();
  assert.deepEqual(ids(r.server().players), ['n1', 'p1']);
  assert.equal(r.server().year, 2028);
  r.deliver(r.now());
  assert.deepEqual(ids(r.app.S.players), ['n1', 'p1']);
}));
