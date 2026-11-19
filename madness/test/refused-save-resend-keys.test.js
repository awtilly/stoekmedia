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

/* A setting changed (save 1, still on its way) and changed back (save 2). Save 2 is refused, and before the retry
 * runs the setting is changed once more. Every earlier save of this phone leaves the setting to the refused one,
 * so only the retry can deliver it; it compared the screen with a baseline, found them equal and sent nothing. */
test('a setting changed again between a refused save and its retry reaches the room', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs } = stampedRoom();
  set('ub', false);
  await fire();                                     // save 1: off (the room has on)
  set('ub', true);
  await fire();                                     // save 2: on again
  await refuse(1);                                  // save 2 is refused; a retry is armed
  set('ub', false);                                 // off once more, before the retry
  await fire();                                     // the retry
  for (let i = 0; i < txs.length; i++) if (i !== 1) await finish(i);
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  assert.equal(server().ub, false, 'the last choice on this phone reached the room');
  deliver(now());
  assert.equal(app.S.ub, false, 'and it stays on this screen');
}));

test('the retry of a refused save carries its setting even when another phone\'s update arrives first', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('year', 2028);
  await fire();                                     // save 1
  await refuse(0);                                  // refused; a retry is armed
  deliver(elsewhere(r => { r.ub = false; }));       // another phone changes something else
  assert.equal(app.S.year, 2028, 'the unsent setting is still on this screen');
  await fire();
  for (let i = 1; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.equal(server().year, 2028);
  assert.equal(server().ub, false, 'the other phone\'s change is kept');
}));

test('a save after a refused one does not carry settings the refused save did not have', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('year', 2028);
  await fire();
  await refuse(0);
  deliver(elsewhere(r => { r.ub = false; }));       // ub was never edited here: it stays the other phone's
  await fire();
  for (let i = 1; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.equal(server().ub, false);
  assert.equal(app.S.ub, false);
  assert.deepEqual(Object.keys(app.eval('_resendKeys')), [], 'nothing is left to resend');
}));
