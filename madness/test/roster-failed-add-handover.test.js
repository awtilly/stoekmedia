const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A save that was adding a player can fail for good while later saves of the same phone, which list that player
 * too, are still on their way. The player is then nobody's "being added" any more, a later save writes them, and
 * taking them off this screen before that write has come back was not recorded as a removal: they stayed in the
 * room. The add is now handed to a running save that lists the player and has still to build its roster.
 * Same hand-stepped fake server as sync-commit-times.test.js, with a way to make one transaction fail. */
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

test('the adding save fails for good, a later save writes the player, and taking them off before that write is seen removes them from the room', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 (adding n1) is on its way
  set('players', app.S.players.concat([N('n2')]));
  await fire();                                     // save 2 (adding n2) lists n1 too; it has not read the room yet
  await refuse(0);                                  // and fails for good
  deliver(elsewhere(r => { r.pt = 'x'; }));         // any snapshot from the room: n1 is not in it
  assert.deepEqual(ids(app.S.players), ['n1', 'n2', 'p1'], 'n1 is still on this screen');
  await finish(1);                                  // save 2 lands and has written n1 (its echo has not arrived)
  assert.deepEqual(ids(server().players), ['n1', 'n2', 'p1'], 'save 2 added the player save 1 could not');
  set('players', app.S.players.filter(p => p.id !== 'n1')); // taken off here before that write is seen
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  assert.deepEqual(ids(server().players), ['n2', 'p1'], 'the removal reached the room');
  assert.deepEqual(app.eval('Object.keys(_savesRunning)'), []);
}));

test('the player stays when nobody takes them off: the later save adds them, once', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  set('players', app.S.players.concat([N('n2')]));
  await fire();
  await refuse(0);
  await finish(1);
  deliver(now());
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  assert.deepEqual(ids(server().players), ['n1', 'n2', 'p1']);
  assert.deepEqual(ids(app.S.players), ['n1', 'n2', 'p1']);
}));

test('a later save that has already built its roster is not handed the player: the retry adds them', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs, flush } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 (adding n1)
  set('players', app.S.players.concat([N('n2')]));
  await fire();                                     // save 2 lists n1
  txs[1].go(); await flush();                       // save 2 reads the room and builds its roster WITHOUT n1 (save 1's to add)
  await refuse(0);                                  // save 1 fails; the app arms a retry
  await finish(1);                                  // save 2 lands without n1
  assert.deepEqual(ids(server().players), ['n2', 'p1']);
  deliver(now());
  assert.deepEqual(ids(app.S.players), ['n1', 'n2', 'p1'], 'n1 is still on this screen');
  await fire();                                     // the retry
  for (let i = 2; i < txs.length; i++) await finish(i);
  assert.deepEqual(ids(server().players), ['n1', 'n2', 'p1'], 'the retry added n1');
}));

test('handed to a save that only changed a setting (it does not write players): the player is sent again', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 (adding n1)
  set('ub', false);
  await fire();                                     // save 2 changes a setting; its copy of the room lists n1
  app.eval('_writeRetries = 5');                    // save 1 has used up its retries: no retry is armed for it
  await refuse(0);
  await finish(1);                                  // save 2 lands: the setting, not n1
  assert.equal(server().ub, false);
  deliver(now());
  assert.deepEqual(ids(app.S.players), ['n1', 'p1'], 'n1 is still on this screen');
  await fire();                                     // the save armed for the player nobody wrote
  for (let i = 2; i < txs.length; i++) await finish(i);
  assert.deepEqual(ids(server().players), ['n1', 'p1'], 'n1 reached the room');
  deliver(now());
  assert.deepEqual(ids(app.S.players), ['n1', 'p1']);
}));

test('the offline fallback hands nothing over: the whole copy is queued, as before', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, now, set, server } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();                                     // save 1 (adding n1)
  set('players', app.S.players.concat([N('n2')]));
  await fire();                                     // save 2 lists n1 and adds n2
  await refuse(0, 'unavailable');                   // the connection is gone: save 1 falls back to the plain write
  assert.deepEqual(app.eval('[_rosterInFlight.n1, Object.keys(_handedOver)]'), [undefined, []], 'n1 is nobody\'s to add any more');
  await finish(1);
  deliver(now());
  assert.deepEqual(ids(server().players), ['n1', 'n2', 'p1']);
  assert.deepEqual(ids(app.S.players), ['n1', 'n2', 'p1']);
}));

test('nothing is kept about a save once it is over', withTimers(async () => {
  const { app, finish, fire, set } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  set('players', app.S.players.concat([N('n2')]));
  await fire();
  await finish(0);
  await finish(1);
  assert.deepEqual(app.eval('[_savesRunning, _saveSends, _saveBuilt, _handedOver].map(o => Object.keys(o))'), [[], [], [], []]);
}));
