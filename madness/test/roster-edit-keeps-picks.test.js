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

/* The rosters (who picked which team) are written by the pick, undo and start transactions and by Reset Draft,
 * always together with the draft state. A save of something else that lists the players (a player renamed or
 * moved, a PIN set) used to send its own copy of the rosters when the room's draft position was no further along
 * than the copy this save was given of it, which is always: it takes the draft state from the room. A pick that
 * landed while such a save was on its way lost its team again, with the draft position already moved on. */
/** A room in the middle of a draft: two players, four picks, `cp` of them made (p1 took t1 first). */
const draftRoom = cp => {
  const r = stampedRoom();
  r.deliver(r.elsewhere(room => {
    room.players = [{ id: 'p1', name: 'Ann', teamIds: cp > 0 ? ['t1'] : [] }, { id: 'p2', name: 'Bob', teamIds: [] }];
    room.teams = ['t1', 't2', 't3', 't4'].map((id, i) => ({ id, name: id, seed: i + 1, region: 'South' }));
    room.ds = { order: ['p1', 'p2', 'p2', 'p1'], cp, started: true, complete: false, epoch: 1 };
  }));
  return r;
};
const rosters = room => room.players.map(p => p.id + ':' + p.teamIds.join(',')).join(' ');
const rename = (r, id, name) => { r.app.S.players.find(p => p.id === id).name = name; r.app._debouncedFirestoreWrite(); };

test('a player renamed while a pick lands does not take the pick off the roster', withTimers(async () => {
  const r = draftRoom(0);
  rename(r, 'p2', 'Bobby');
  await r.fire();                                           // the rename is on its way
  r.elsewhere(room => { room.players[0].teamIds.push('t1'); room.ds.cp = 1; }); // p1's pick lands first; this phone has not been shown it
  await r.finish(0);
  assert.equal(rosters(r.server()), 'p1:t1 p2:', 'the pick is still on the roster');
  assert.equal(r.server().ds.cp, 1);
  assert.equal(r.server().players[1].name, 'Bobby', 'and the rename is in the room');
}));

test('a player moved while two picks land keeps both picks, in the new order', withTimers(async () => {
  const r = draftRoom(1);
  r.app.S.players = [r.app.S.players[1], r.app.S.players[0]];
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.elsewhere(room => { room.players[1].teamIds.push('t2', 't3'); room.ds.cp = 3; });
  await r.finish(0);
  assert.equal(rosters(r.server()), 'p2:t2,t3 p1:t1');
  assert.equal(r.server().ds.cp, 3);
}));

test('a player renamed while a pick is undone does not put the team back on the roster', withTimers(async () => {
  const r = draftRoom(1);
  rename(r, 'p1', 'Annie');
  await r.fire();
  r.elsewhere(room => { room.players[0].teamIds = []; room.ds.cp = 0; room.ds.epoch = 2; }); // the commissioner's undo
  await r.finish(0);
  assert.equal(rosters(r.server()), 'p1: p2:', 'the undone pick stays undone');
  assert.equal(r.server().ds.cp, 0);
  assert.equal(r.server().players[0].name, 'Annie');
}));

test('Reset Draft from this phone still empties the rosters, also when a pick lands meanwhile', withTimers(async () => {
  const r = draftRoom(1);
  r.app.S.ds = { order: [], cp: 0, started: false, complete: false, epoch: 2 }; // as resetDraft() does
  r.app.S.players.forEach(p => { p.teamIds = []; });
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.elsewhere(room => { room.players[1].teamIds.push('t2'); room.ds.cp = 2; });
  await r.finish(0);
  assert.equal(rosters(r.server()), 'p1: p2:');
  assert.equal(r.server().ds.started, false);
}));

/* The other way round: Reset Draft is tapped on a screen. A pick that landed before this phone was shown it is
 * not on that screen, so the rosters there are already what the reset wants and "the players" are not among
 * the keys the save changed: the reset landed, and the pick's team stayed on a roster of a draft not started. */
test('Reset Draft tapped while a pick lands leaves no team on a roster', withTimers(async () => {
  const r = draftRoom(0);                                    // this screen: nobody has picked yet
  r.app.S.ds = { order: [], cp: 0, started: false, complete: false, epoch: 2 }; // as resetDraft() does
  r.app.S.players.forEach(p => { p.teamIds = []; });
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.elsewhere(room => { room.players[0].teamIds.push('t1'); room.ds.cp = 1; }); // a pick lands first
  await r.finish(0);
  assert.equal(r.server().ds.started, false, 'the reset is in the room');
  assert.equal(rosters(r.server()), 'p1: p2:', 'and no pick is left on a roster');
}));

test('a pause that loses to a pick that landed meanwhile leaves the rosters alone', withTimers(async () => {
  const r = draftRoom(1);
  r.app.S.ds = Object.assign({}, r.app.S.ds, { timerPaused: true, pausedRemaining: 5000, pickDeadline: null }); // as pauseDraftClock() does
  r.app._debouncedFirestoreWrite();
  await r.fire();
  r.elsewhere(room => { room.players[1].teamIds.push('t2'); room.ds.cp = 2; });
  await r.finish(0);
  assert.equal(rosters(r.server()), 'p1:t1 p2:t2');
  assert.equal(r.server().ds.cp, 2);
}));
