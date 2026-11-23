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

/* Reset Draft and Undo both number the draft "one on" from the draft they were tapped on. A reset whose save was
 * still on its way while an Undo reached the room met a running draft with the SAME number; between equal numbers
 * the draft that is further along wins, so the reset was dropped and nothing told the commissioner. */
/** A room in the middle of a draft: two players, four picks, `cp` of them made (p1 took t1 first, p2 t2). */
const draftRoom = cp => {
  const r = stampedRoom();
  r.deliver(r.elsewhere(room => {
    room.players = [{ id: 'p1', name: 'Ann', teamIds: cp > 0 ? ['t1'] : [] }, { id: 'p2', name: 'Bob', teamIds: cp > 1 ? ['t2'] : [] }];
    room.teams = ['t1', 't2', 't3', 't4'].map((id, i) => ({ id, name: id, seed: i + 1, region: 'South' }));
    room.ds = { order: ['p1', 'p2', 'p2', 'p1'], cp, started: true, complete: false, epoch: 1 };
  }));
  return r;
};
const rosters = room => room.players.map(p => p.id + ':' + p.teamIds.join(',')).join(' ');
const resetHere = r => {
  r.app.S.ds = { order: [], cp: 0, started: false, complete: false, epoch: (r.app.S.ds.epoch || 0) + 1 }; // as resetDraft() does
  r.app.S.players.forEach(p => { p.teamIds = []; });
  r.app._debouncedFirestoreWrite();
};
const undoElsewhere = room => { room.ds.cp--; room.ds.epoch++; room.players[1].teamIds.pop(); };

test('Reset Draft still lands when an Undo reached the room first', withTimers(async () => {
  const r = draftRoom(2);
  resetHere(r);                               // draft 1 → reset numbered 2
  await r.fire();
  r.elsewhere(undoElsewhere);                 // the undo: draft 1 → 2 as well, one pick left
  await r.finish(0);
  assert.equal(r.server().ds.started, false, 'the reset is in the room');
  assert.equal(r.server().ds.epoch, 3, 'numbered above the undone draft, so every phone takes it');
  assert.equal(rosters(r.server()), 'p1: p2:');
  r.deliver(r.now());
  assert.equal(r.app.S.ds.started, false);
}));

test('the same when the Undo lands while the reset is being saved (the save is run again)', withTimers(async () => {
  const r = draftRoom(2);
  resetHere(r);
  await r.fire();
  r.txs[0].go(); await r.flush();             // the save has read the room
  r.elsewhere(undoElsewhere);
  await r.finish(0);
  assert.equal(r.server().ds.started, false);
  assert.equal(r.server().ds.epoch, 3);
}));

test('a reset that arrives after the draft was reset and started again elsewhere does not wipe the new draft', withTimers(async () => {
  const r = draftRoom(2);
  resetHere(r);                               // numbered 2
  await r.fire();
  r.elsewhere(room => {                       // reset (2) and start (3) on another phone, one pick made
    room.ds = { order: ['p2', 'p1', 'p1', 'p2'], cp: 1, started: true, complete: false, epoch: 3 };
    room.players[0].teamIds = []; room.players[1].teamIds = ['t3'];
  });
  await r.finish(0);
  assert.equal(r.server().ds.started, true);
  assert.equal(r.server().ds.epoch, 3);
  assert.equal(rosters(r.server()), 'p1: p2:t3');
}));

test('a reset with nothing else going on is numbered as before', withTimers(async () => {
  const r = draftRoom(2);
  resetHere(r);
  await r.fire();
  await r.finish(0);
  assert.equal(r.server().ds.started, false);
  assert.equal(r.server().ds.epoch, 2);
}));

/* The same tie one step earlier, on the screen: Reset tapped on a screen that had not been shown the Undo yet. The
 * update bringing the undone draft (same draft number as the reset) arrives inside the save delay. */
test('a reset not sent yet stays on the screen when the update with an Undo arrives, and then lands', withTimers(async () => {
  const r = draftRoom(2);
  const undone = r.elsewhere(undoElsewhere);  // in the room, not shown here yet
  resetHere(r);
  r.deliver(undone);
  assert.equal(r.app.S.ds.started, false, 'the reset is still what this screen shows');
  await r.fire();
  await r.finish(0);
  assert.equal(r.server().ds.started, false, 'and it reached the room');
  assert.equal(r.server().ds.epoch, 3);
  assert.equal(rosters(r.server()), 'p1: p2:');
}));

test('an update with a draft that was reset and started again elsewhere still replaces a reset not sent yet', withTimers(async () => {
  const r = draftRoom(2);
  const restarted = r.elsewhere(room => {
    room.ds = { order: ['p2', 'p1', 'p1', 'p2'], cp: 1, started: true, complete: false, epoch: 3 };
    room.players[0].teamIds = []; room.players[1].teamIds = ['t3'];
  });
  resetHere(r);                               // numbered 2
  r.deliver(restarted);
  assert.equal(r.app.S.ds.started, true);
  assert.equal(r.app.S.ds.epoch, 3);
}));
