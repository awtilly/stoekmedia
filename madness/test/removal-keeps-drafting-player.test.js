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

/* A player can only be removed on a screen whose draft has not started (removePlayer refuses otherwise): the draft
 * order is fixed at the start, and a player taken out afterwards leaves turns nobody can take. The removal is saved
 * a moment after the tap, though, and by then the ROOM's draft can be running with that player in it: started on
 * another phone, or this phone's own Reset Draft lost to a pick and the running draft is still the room's. */
/** A lobby of three, shown on this phone; `cp` picks of the draft that is then started elsewhere. */
const lobbyOfThree = () => {
  const r = stampedRoom();
  r.deliver(r.elsewhere(room => {
    room.players = [N('p1'), N('p2'), N('p3')];
    room.teams = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => ({ id, name: id, seed: i + 1, region: 'South' }));
    room.ds = { order: [], cp: 0, started: false, complete: false, epoch: 1 };
  }));
  return r;
};
const startedElsewhere = room => {
  room.ds = { order: ['p1', 'p2', 'p3', 'p3', 'p2', 'p1'], cp: 1, started: true, complete: false, epoch: 2 };
  room.players[0].teamIds = ['t1'];
};
const removeHere = (r, id) => { r.app.S.players = r.app.S.players.filter(p => p.id !== id); r.app._debouncedFirestoreWrite(); };
const ids = room => room.players.map(p => p.id).join(' ');
const rosters = room => room.players.map(p => p.id + ':' + p.teamIds.join(',')).join(' ');

test('a removal that reaches the room after the draft was started there leaves the player in the draft', withTimers(async () => {
  const r = lobbyOfThree();
  removeHere(r, 'p3');                       // tapped on a lobby screen
  r.elsewhere(startedElsewhere);             // the draft starts on another phone, with p3 in the order
  await r.fire();
  await r.finish(0);
  assert.equal(ids(r.server()), 'p1 p2 p3', 'p3 has turns in the running draft and stays in the room');
  assert.equal(r.server().ds.started, true);
  assert.equal(rosters(r.server()), 'p1:t1 p2: p3:');
  r.deliver(r.now());
  assert.equal(ids(r.app.S), 'p1 p2 p3', 'and is back on this screen');
}));

test('the same when the draft starts while the removal is being saved (the save is run again)', withTimers(async () => {
  const r = lobbyOfThree();
  removeHere(r, 'p3');
  await r.fire();
  r.txs[0].go(); await r.flush();            // the save has read the lobby
  r.elsewhere(startedElsewhere);             // the start lands first: Firestore runs the save again
  await r.finish(0);
  assert.equal(ids(r.server()), 'p1 p2 p3');
  assert.equal(r.server().ds.cp, 1);
}));

test('a removal still goes through while the room\'s draft has not started', withTimers(async () => {
  const r = lobbyOfThree();
  removeHere(r, 'p3');
  r.elsewhere(room => { room.ub = false; }); // something else changed meanwhile
  await r.fire();
  await r.finish(0);
  assert.equal(ids(r.server()), 'p1 p2');
}));

test('a removed player who has no turn in the running draft (joined after the start) is still removed', withTimers(async () => {
  const r = lobbyOfThree();
  r.deliver(r.elsewhere(room => { room.players.push(N('p4')); }));
  removeHere(r, 'p4');
  r.elsewhere(startedElsewhere);             // started without p4 in the order
  await r.fire();
  await r.finish(0);
  assert.equal(ids(r.server()), 'p1 p2 p3');
}));

/* The rosters belong to the pick, undo and start transactions and to Reset Draft. A pause or resume is saved with
 * the draft state of this screen, and with it went this screen's rosters: after a Reset Draft tapped here that lost
 * to a pick, the running draft comes back onto a screen that still holds the reset's empty rosters. */
test('a pause saved from a screen holding older rosters does not write them into the running draft', withTimers(async () => {
  const r = lobbyOfThree();
  r.deliver(r.elsewhere(startedElsewhere));
  r.app.S.players.forEach(p => { p.teamIds = []; });                       // what a lost reset left on this screen
  r.app.S.ds = Object.assign({}, r.app.S.ds, { timerPaused: true, pausedRemaining: 5000, pickDeadline: null }); // as pauseDraftClock() does
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await r.finish(0);
  assert.equal(r.server().ds.timerPaused, true, 'the pause is in the room');
  assert.equal(rosters(r.server()), 'p1:t1 p2: p3:', 'and the pick is still on its roster');
}));

test('Reset Draft from this phone still empties the rosters', withTimers(async () => {
  const r = lobbyOfThree();
  r.deliver(r.elsewhere(startedElsewhere));
  r.app.S.ds = { order: [], cp: 0, started: false, complete: false, epoch: 3 }; // as resetDraft() does
  r.app.S.players.forEach(p => { p.teamIds = []; });
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await r.finish(0);
  assert.equal(r.server().ds.started, false);
  assert.equal(rosters(r.server()), 'p1: p2: p3:');
}));
