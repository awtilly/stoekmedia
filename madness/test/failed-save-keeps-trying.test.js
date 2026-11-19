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

/* After six failed saves in a row the app used to stop trying ("changes saved locally"). An unsent edit is only
 * kept across updates from the room while a save is armed or on its way, so the next update from anybody took
 * it off the screen. Now the save stays armed at a slow interval. */
test('a new player whose save has failed six times stays on the screen through a room update and is sent by the slow retry', withTimers(async () => {
  const { app, refuse, finish, fire, flush, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  app.eval('_writeRetries = 5');                    // the five quick retries are used up
  await refuse(0);
  assert.equal(app.eval('!!_firestoreWriteTimer'), true, 'a save is still armed');
  deliver(elsewhere(r => { r.ub = false; }));
  assert.deepEqual(ids(app.S.players), ['n1', 'p1'], 'the player is still on this screen');
  await fire();
  assert.equal(txs.length, 1, 'not tried again after 800 ms');
  mock.timers.tick(15000); await flush();
  assert.equal(txs.length, 2, 'tried again after 15 s');
  await finish(1);
  deliver(now());
  assert.deepEqual(ids(server().players), ['n1', 'p1']);
  assert.equal(server().ub, false, 'the other phone\'s change is kept');
  assert.deepEqual(ids(app.S.players), ['n1', 'p1']);
}));

test('a setting whose save has failed six times stays on the screen through a room update and is sent by the slow retry', withTimers(async () => {
  const { app, refuse, finish, fire, flush, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('year', 2028);
  await fire();
  app.eval('_writeRetries = 5');
  await refuse(0);
  deliver(elsewhere(r => { r.ub = false; }));
  assert.equal(app.S.year, 2028, 'the setting is still on this screen');
  mock.timers.tick(15000); await flush();
  assert.equal(txs.length, 2);
  await finish(1);
  deliver(now());
  assert.equal(server().year, 2028);
  assert.equal(app.S.year, 2028);
}));

test('a new edit while the slow retry is waiting goes out after the usual 800 ms', withTimers(async () => {
  const { app, refuse, finish, fire, deliver, now, set, server, txs } = stampedRoom();
  set('year', 2028);
  await fire();
  app.eval('_writeRetries = 5');
  await refuse(0);
  set('ub', false);
  await fire();
  assert.equal(txs.length, 2, 'the edit did not wait for the slow retry');
  await finish(1);
  deliver(now());
  assert.equal(server().year, 2028);
  assert.equal(server().ub, false);
  assert.equal(app.eval('_writeRetries'), 0);
}));
