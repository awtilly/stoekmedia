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

/* The bracket is saved as one key, but it is filled one game at a time, by whichever phone sees a final first. A
 * save that was slow to land used to write its whole, older bracket: the winners other phones had saved meanwhile
 * were emptied again, and a phone that had already reported those finals did not fill them a second time. A save
 * that only fills open slots is now laid over the room's bracket. */
/** A room with the sixteen South teams (S1 … S16) and an empty bracket, shown to this phone. */
const bracketRoom = () => {
  const r = stampedRoom();
  r.deliver(r.elsewhere(room => {
    room.teams = Array.from({ length: 16 }, (_, i) => ({ id: 'S' + (i + 1), name: 'S' + (i + 1), seed: i + 1, region: 'South', ncaaId: 'n' + (i + 1) }));
    room.bracket = { South: Array(15).fill(null), East: Array(15).fill(null), Midwest: Array(15).fill(null), West: Array(15).fill(null), ff: Array(3).fill(null) };
    room.games = [];
  }));
  return r;
};
/** A final scored on this phone: the slot is filled, the games list rebuilt, the save started. */
const fill = (r, gi, id) => { r.app.S.bracket.South[gi] = id; r.app.eval('syncGames()'); r.app._debouncedFirestoreWrite(); };
/** The same on another phone, already in the room. */
const fillElsewhere = (r, gi, id, t1, t2) => r.elsewhere(room => { room.bracket.South[gi] = id; room.games.push({ id: 'South_' + gi, round: 1, t1, t2, wid: id }); });
const gameIds = room => room.games.map(g => g.id + ':' + g.wid).sort().join(' ');

test('a final saved late keeps the winner another phone saved meanwhile', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();                                 // the save is on its way
  fillElsewhere(r, 1, 'S8', 'S8', 'S9');          // another phone's final lands first; this phone has not been shown it
  await r.finish(0);
  assert.equal(r.server().bracket.South[0], 'S1', 'this phone\'s winner is in the room');
  assert.equal(r.server().bracket.South[1], 'S8', 'and the other phone\'s winner is still there');
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8', 'the games list has both');
}));

test('a final not sent yet stays when an update brings another winner', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');                               // inside the debounce second
  r.deliver(fillElsewhere(r, 1, 'S8', 'S8', 'S9'));
  assert.equal(r.app.S.bracket.South[0], 'S1', 'still on this screen');
  assert.equal(r.app.S.bracket.South[1], 'S8', 'with the winner the update brought');
  await r.fire();
  await r.finish(0);
  assert.equal(r.server().bracket.South[0], 'S1');
  assert.equal(r.server().bracket.South[1], 'S8');
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8');
}));

test('two phones filling the same slot: one winner, nothing else touched', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();
  fillElsewhere(r, 0, 'S1', 'S1', 'S16');
  fillElsewhere(r, 2, 'S5', 'S5', 'S12');
  await r.finish(0);
  assert.equal(r.server().bracket.South[0], 'S1');
  assert.equal(r.server().bracket.South[2], 'S5');
  assert.equal(r.server().games.filter(g => g.id === 'South_0').length, 1, 'the game is listed once');
}));

test('a corrected winner is still sent as the whole bracket (not a fill)', withTimers(async () => {
  const r = bracketRoom();
  r.deliver(fillElsewhere(r, 0, 'S1', 'S1', 'S16'));
  fill(r, 0, 'S16');                              // the commissioner corrects the result
  await r.fire();
  fillElsewhere(r, 1, 'S8', 'S8', 'S9');
  await r.finish(0);
  assert.equal(r.server().bracket.South[0], 'S16', 'the correction is in the room');
  assert.equal(r.server().bracket.South[1], null, 'as before: a correction goes out whole');
}));

test('_bracketFillsOnto: only pure fills; the other winners of the room are added', () => {
  const { app } = bracketRoom();
  const B = (a, b) => ({ South: [a, b], ff: [null] });
  const f = app.eval('_bracketFillsOnto');
  assert.deepEqual(JSON.parse(JSON.stringify(f(B(null, null), B('x', null), B(null, 'y')))), B('x', 'y'));
  assert.deepEqual(JSON.parse(JSON.stringify(f(B(null, null), B('x', null), B(null, null)))), B('x', null), 'the room has nothing new: the fill stays');
  assert.equal(f(B('x', null), B('z', null), B('x', 'y')), null, 'a changed winner is not a fill');
  assert.equal(f(B('x', null), B(null, null), B('x', 'y')), null, 'a cleared winner is not a fill');
  assert.equal(f(B(null, null), B('x', null), { South: [null], ff: [null] }), null, 'another shape');
  assert.equal(f(null, B('x', null), B(null, 'y')), null);
  // An update from the room: a slot this phone did not touch is the room's, also when the room emptied it.
  assert.deepEqual(JSON.parse(JSON.stringify(f(B('w', null), B('w', 'x'), B(null, null)))), B(null, 'x'));
  // The save itself (keepMine): this copy can be ahead of the room, so its winners stay and only the room's extra ones are added.
  assert.deepEqual(JSON.parse(JSON.stringify(f(B('w', null), B('w', 'x'), B(null, null), true))), B('w', 'x'), 'nothing to take from the room');
  assert.deepEqual(JSON.parse(JSON.stringify(f({ South: ['w', null, null], ff: [null] }, { South: ['w', 'x', null], ff: [null] }, { South: [null, null, 'y'], ff: [null] }, true))), { South: ['w', 'x', 'y'], ff: [null] });
});

test('two finals saved one after the other: the second save does not empty the first one\'s slot while it is still on its way', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();                                 // save 1 is on its way
  fill(r, 1, 'S8');
  await r.fire();                                 // save 2, built on a copy the room does not have yet
  await r.finish(1);                              // save 2 lands first
  assert.equal(r.server().bracket.South[0], 'S1', 'the first final is in the room with it');
  assert.equal(r.server().bracket.South[1], 'S8');
  await r.finish(0);
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8');
}));
