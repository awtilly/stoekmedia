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


/* A setting is changed (save 1, already built, still on its way) and changed back (save 2, refused). Before the
 * retry runs, an update another phone made earlier arrives: it shows the setting as this screen has it again, so
 * the retry found "nothing changed" and sent nothing. Save 1 then landed last with the first change. The retry now
 * sends the setting a refused save left unsent whatever the screen and the room look like. */
test('a setting changed back, its save refused: the retry still sends it after a room update that reads the same', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, flush, txs } = stampedRoom();
  set('ub', false);
  await fire();                                     // save 1: off (the room has on)
  const other = elsewhere(r => { r.year = 2030; }); // another phone changes something else; its update is on its way
  txs[0].go(); await flush();                       // save 1 is built on that room, not landed yet
  set('ub', true);
  await fire();                                     // save 2: on again
  await refuse(1);                                  // save 2 is refused; a retry is armed
  deliver(other);                                   // the other phone's update: the room still reads "on"
  assert.equal(app.S.ub, true);
  await fire();                                     // the retry
  await finish(0);                                  // save 1 lands: off
  for (let round = 0; round < 3; round++) {
    for (let i = 2; i < txs.length; i++) if (!txs[i].failed) await finish(i);
    deliver(now());
    await fire();
  }
  assert.equal(server().ub, true, 'the last choice on this phone reached the room');
  assert.equal(server().year, 2030, 'the other phone\'s change is kept');
  assert.equal(app.S.ub, true, 'and it stays on this screen');
  assert.deepEqual(Object.keys(app.eval('_resendKeys')), [], 'nothing is left to resend');
}));

test('the same, and the retry is refused as well: the setting is sent by the next one', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, flush, txs } = stampedRoom();
  set('ub', false);
  await fire();
  const other = elsewhere(r => { r.year = 2030; });
  txs[0].go(); await flush();
  set('ub', true);
  await fire();
  await refuse(1);
  deliver(other);
  await fire();                                     // the retry ...
  await refuse(2);                                  // ... refused too
  await finish(0);                                  // save 1 lands: off
  for (let round = 0; round < 3; round++) {
    await fire();
    for (let i = 3; i < txs.length; i++) if (!txs[i].failed) await finish(i);
    deliver(now());
  }
  assert.equal(server().ub, true);
  assert.equal(app.S.ub, true);
}));

test('with nothing left unsent, a timer that finds the screen as the room has it still sends nothing', withTimers(async () => {
  const { app, fire, deliver, elsewhere, set, txs } = stampedRoom();
  set('ub', false);
  deliver(elsewhere(r => { r.ub = false; }));       // another phone made the same change first
  await fire();
  assert.equal(txs.length, 0, 'no save was started');
  assert.equal(app.S.ub, false);
}));
