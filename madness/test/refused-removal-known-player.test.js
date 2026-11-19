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

/* A phone adds a player (confirmed; its own echo is not applied, so the room "as last seen" is still without
 * them), removes them again, and that save is refused while a later save is on its way. The removal was only
 * re-armed when the room as last seen had the player: the next update put them back on this screen for good. */
test('a refused removal of a player this phone added itself is tried again and the player stays off', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);                                  // save 1 added n1; confirmed, the room has them
  set('players', app.S.players.filter(p => p.id !== 'n1'));
  await fire();                                     // save 2 removes n1
  set('players', app.S.players.concat([N('n2')]));
  await fire();                                     // save 3 adds n2
  await refuse(1);                                  // the removal is refused
  deliver(elsewhere(r => { r.year = 2030; }));      // another phone's update; the room still has n1
  assert.deepEqual(ids(app.S.players), ['n2', 'p1'], 'the removed player is not back on this screen');
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.deepEqual(ids(server().players), ['n2', 'p1'], 'and the retry took them out of the room');
  assert.deepEqual(ids(app.S.players), ['n2', 'p1']);
}));

test('a refused removal of a player another phone has already removed needs no retry', withTimers(async () => {
  const { app, finish, refuse, fire, deliver, elsewhere, now, set, server, txs } = stampedRoom();
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);
  deliver(now());                                   // this phone has seen the room with n1
  set('players', app.S.players.filter(p => p.id !== 'n1'));
  await fire();                                     // save 2 removes n1
  set('ub', false);
  await fire();                                     // save 3: a setting
  deliver(elsewhere(r => { r.players = r.players.filter(p => p.id !== 'n1'); })); // removed elsewhere meanwhile
  await refuse(1);
  await fire();
  for (let i = 2; i < txs.length; i++) await finish(i);
  deliver(now());
  assert.deepEqual(ids(server().players), ['p1']);
  assert.deepEqual(ids(app.S.players), ['p1']);
  assert.equal(server().ub, false);
}));
