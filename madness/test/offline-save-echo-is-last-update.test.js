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


/* A save is on its way; an update from another phone arrives meanwhile and is held back for the setting in
 * flight. A second setting is changed and its save starts too. The first save lands and its own update is shown
 * (the second setting is kept, its save is on its way). The connection then drops as the second save is tried:
 * it goes out as the plain write, whose echo is skipped as this phone's own. When the first save is confirmed,
 * the last update is drawn again: that was the first save's, from before the second change, and the screen went
 * back to the old value of the second setting while the room kept the new one. */
/** Saves land as usual, but the app is only told so when the returned function is called. */
const holdConfirmation = app => {
  const run = app.db.runTransaction;
  let tell;
  const told = new Promise(r => { tell = r; });
  app.db.runTransaction = async fn => { await run(fn); await told; };
  return tell;
};

test('a setting saved offline stays on the screen when an earlier save is confirmed afterwards', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, flush } = stampedRoom();
  const confirm = holdConfirmation(app);
  set('ub', false);
  await fire();                                     // save 1 has started
  deliver(elsewhere(r => { r.year = 2031; }));      // another phone's update, still with the old "ub": held back
  assert.equal(app.S.ub, false);
  set('rp', Object.assign({}, app.S.rp, { 3: 83 }));
  await fire();                                     // save 2 has started as well
  elsewhere(r => { r.year = 2032; });               // one more change this phone has not been shown when save 1 reads the room
  await finish(0);                                  // save 1 lands; its confirmation is still on its way
  deliver(now());                                   // the room as save 1 left it
  assert.equal(app.S.rp[3], 83, 'kept: its save is on its way');
  await refuse(1, 'unavailable');                   // no connection: save 2 becomes the plain write
  assert.equal(server().rp[3], 83);
  deliver(now());                                   // its echo
  confirm();
  await flush();
  await flush();
  assert.equal(app.S.rp[3], 83, 'the screen keeps what the room holds');
  assert.equal(app.S.ub, false);
  assert.equal(server().ub, false);
}));
