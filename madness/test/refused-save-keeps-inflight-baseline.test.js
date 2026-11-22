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

/* Save 1 adds a player; save 2 adds a second one; an update from another phone arrives. Save 1 lands (the room's
 * update with the player has not arrived yet) and save 2 is refused. The retry's starting point was rebuilt from
 * the room as last seen, which does not have the first player yet: taking them off the screen was then "nothing
 * changed", no removal was recorded, and the room's update put them back on the screen. (The retry happened to
 * take them out of the room all the same; when it was refused too, they stayed.) */
test('a player still being added is in the starting point after another save is refused: taking them off is sent', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 adds n1 (stays on its way)
  set('players', app.S.players.concat([N('n2')]));
  await fire();                                     // save 2 adds n2
  deliver(elsewhere(r => { r.year = 2030; }));      // another phone's update: the room has neither yet
  await finish(0);                                  // save 1 lands n1; the room's update with them is on its way
  await refuse(1);                                  // save 2 is refused
  set('players', app.S.players.filter(p => p.id !== 'n1')); // n1 is taken off this screen
  await fire();                                     // the retry: adds n2, and n1 is off
  deliver(now());                                   // the room's update arrives: it has n1
  assert.deepEqual(ids(app.S.players), ['n2', 'p1'], 'the removed player is not back on this screen');
  await refuse(2);                                  // the retry is refused as well
  for (let round = 0; round < 3; round++) {
    await fire();
    for (let i = 3; i < txs.length; i++) await finish(i);
    deliver(now());
  }
  assert.deepEqual(ids(server().players), ['n2', 'p1'], 'the removed player is not in the room');
  assert.deepEqual(ids(app.S.players), ['n2', 'p1']);
}));

test('the same, and the first player stays: both end up in the room, once each', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  set('players', app.S.players.concat([N('n2')]));
  await fire();
  deliver(elsewhere(r => { r.year = 2030; }));
  await refuse(1);
  await fire();
  await finish(0);
  for (let round = 0; round < 3; round++) {
    for (let i = 2; i < txs.length; i++) await finish(i);
    deliver(now());
    await fire();
  }
  assert.deepEqual(ids(server().players), ['n1', 'n2', 'p1']);
  assert.deepEqual(ids(app.S.players), ['n1', 'n2', 'p1']);
  assert.equal(server().players.length, 3);
}));

test('the same, and the first save is refused as well: both players are sent again', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  set('players', app.S.players.concat([N('n2')]));
  await fire();
  deliver(elsewhere(r => { r.year = 2030; }));
  await refuse(1);
  await refuse(0);
  for (let round = 0; round < 4; round++) {
    await fire();
    for (let i = 2; i < txs.length; i++) await finish(i);
    deliver(now());
  }
  assert.deepEqual(ids(server().players), ['n1', 'n2', 'p1']);
  assert.deepEqual(ids(app.S.players), ['n1', 'n2', 'p1']);
}));

/* Save 1 adds a player and is confirmed; its own echo from the room is not applied, so the room as last seen is
 * still without them. Saves 2 and 3 each add another player; save 2 is refused while save 3 is on its way. The
 * retry's starting point was rebuilt from the room as last seen plus the players still being added, without the
 * first player: taking them off the screen was then "nothing changed", and the next update from the room put
 * them back. */
for (const retryRefused of [false, true]) test('a player a confirmed save of this phone added is in the starting point after another save is refused' + (retryRefused ? ' (the retry is refused too)' : ''), withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 adds n1
  await finish(0);                                  // ... and lands
  deliver(now());                                   // its own echo: not applied
  set('players', app.S.players.concat([N('n2')]));
  await fire();                                     // save 2 adds n2
  set('players', app.S.players.concat([N('n3')]));
  await fire();                                     // save 3 adds n3, on its way too
  await refuse(1);                                  // save 2 is refused
  set('players', app.S.players.filter(p => p.id !== 'n1')); // n1 is taken off this screen
  deliver(elsewhere(r => { r.year = 2030; }));      // another phone's update: the room has n1
  assert.deepEqual(ids(app.S.players), ['n2', 'n3', 'p1'], 'the removed player is not back on this screen');
  await fire();                                     // the retry
  if (retryRefused) await refuse(3);
  for (let round = 0; round < 4; round++) {
    for (let i = 2; i < txs.length; i++) if (!txs[i].failed) await finish(i);
    deliver(now());
    await fire();
  }
  assert.deepEqual(ids(server().players), ['n2', 'n3', 'p1'], 'the removed player is not in the room');
  assert.deepEqual(ids(app.S.players), ['n2', 'n3', 'p1']);
  assert.equal(server().year, 2030, 'the other phone\'s change is kept');
}));
