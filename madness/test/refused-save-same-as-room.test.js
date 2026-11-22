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
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: async fn => {
      const t = { go: null, fail: null, done: false, failed: false };
      txs.push(t);
      const gate = () => new Promise((r, no) => { t.go = r; t.fail = () => { t.failed = true; no(Object.assign(new Error('refused'), { code: 'permission-denied' })); }; });
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
    refuse: async i => { txs[i].fail(); await flush(); await flush(); },
    fire: async () => { mock.timers.tick(800); await flush(); },
    elsewhere: fn => { const r = JSON.parse(srv.state); fn(r); srv.state = JSON.stringify(r); srv.v++; return now(); },
    set: (k, v) => { app.S[k] = v; app._debouncedFirestoreWrite(); }
  };
}
const withTimers = fn => async () => { mock.timers.enable({ apis: ['setTimeout'] }); try { await fn(); } finally { mock.timers.reset(); } };
const N = id => ({ id, name: id, teamIds: [] });
const ids = list => list.map(p => p.id).sort();

/* A save that is refused goes back to a baseline from which the retry sends its edits again. Where the screen
 * showed what the room was last seen to hold, the retry found nothing to send, and an earlier save of this phone,
 * already built with the previous value, landed afterwards: the older choice won. */
test('refused while an earlier save with the previous value is already built: the last choice reaches the room', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs, flush } = stampedRoom();
  set('year', 2028);
  await fire();                                     // save 1 (year 2028)
  txs[0].go(); await flush();                       // has read the room and built what it writes: 2028
  set('year', 2027);
  await fire();                                     // save 2: back to 2027, which is what this phone last saw in the room
  set('ub', false);
  await fire();                                     // save 3: another setting, changed right after
  await refuse(1);                                  // save 2 is refused; the app arms a retry
  await finish(0);                                  // save 1 lands: the room says 2028
  assert.equal(server().year, 2028);
  await fire();                                     // the retry
  for (let i = 2; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.equal(server().year, 2027, 'the last choice on this phone reached the room');
  assert.equal(app.S.year, 2027);
}));

test('the same when the earlier save lands and is seen before the retry runs', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs, flush } = stampedRoom();
  set('year', 2028);
  await fire();
  txs[0].go(); await flush();
  set('year', 2027);
  await fire();
  set('ub', false);
  await fire();
  await refuse(1);
  await finish(0);
  deliver(now());                                   // the room's 2028 arrives while 2027 waits to be sent again
  assert.equal(app.S.year, 2027, 'the choice stays on this screen');
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.equal(server().year, 2027);
  assert.equal(app.S.year, 2027);
}));

test('a refused save with no other save on its way is sent again as before', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs } = stampedRoom();
  set('year', 2028);
  await fire();
  await refuse(0);
  await fire();
  for (let i = 1; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.equal(server().year, 2028);
  assert.equal(app.S.year, 2028);
}));

test('refused, and another phone has set the same value meanwhile: nothing is lost and the phones agree', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('year', 2028);
  await fire();
  deliver(elsewhere(r => { r.year = 2028; }));      // somebody else chose 2028 too
  await refuse(0);
  await fire();
  for (let i = 1; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.equal(server().year, 2028);
  assert.equal(app.S.year, 2028);
}));

test('two saves of the same setting, the later one refused: the later value is sent again', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs } = stampedRoom();
  set('year', 2028);
  await fire();
  set('year', 2029);
  await fire();
  await refuse(1);
  await finish(0);
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.equal(server().year, 2029);
  assert.equal(app.S.year, 2029);
}));
