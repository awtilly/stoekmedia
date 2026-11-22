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


/* A setting is switched off (that save lands) and on again, and the server then refuses save after save (each
 * one is a try of its own in the list of "what this phone sent lately", which is 12 long). The save that did land
 * was pushed out of the list, so when another phone's update arrived, still carrying "off", that value read as the
 * other phone's change: the screen went back to "off" and the retries no longer carried the setting. */
const refuseAll = async (txs, refuse) => { for (let i = 0; i < txs.length; i++) if (!txs[i].done && !txs[i].failed) await refuse(i); };

test('many refused saves do not make this phone forget the save of its own that landed', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('ub', false);
  await fire();
  await finish(0);                                  // save 1 lands: the room says "off"
  set('ub', true);                                  // on again
  for (let n = 0; n < 14; n++) {                    // and nothing gets through for a while
    set('year', 2030 + n);
    await fire();
    await refuseAll(txs, refuse);
  }
  assert.equal(app.S.ub, true);
  set('year', 2049);
  await fire();                                     // the next try has started and has not read the room yet
  deliver(elsewhere(r => { r.rp = Object.assign({}, r.rp, { 1: 7 }); })); // another phone changes something else
  assert.equal(app.S.ub, true, 'the room still says "off" because of this phone\'s own save: the tap stays on screen');
  for (let round = 0; round < 4; round++) {
    set('year', 2050 + round);
    await fire();
    for (let i = 1; i < txs.length; i++) if (!txs[i].done && !txs[i].failed) await finish(i);
    deliver(now());
  }
  assert.equal(server().ub, true, 'and it reaches the room once a save gets through');
  assert.equal(app.S.ub, true);
}));

test('another phone\'s change to the setting still wins after many refused saves', withTimers(async () => {
  const { app, refuse, fire, deliver, elsewhere, set, txs } = stampedRoom();
  for (let n = 0; n < 14; n++) {
    set('year', 2030 + n);
    await fire();
    await refuseAll(txs, refuse);
  }
  deliver(elsewhere(r => { r.ub = false; }));       // this phone never touched the setting
  assert.equal(app.S.ub, false, 'the other phone\'s value is shown');
}));
