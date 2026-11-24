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


/* The in-flight half: a bracket save of this phone is on its way (started, not confirmed) when another phone's
 * update arrives. The update used to win on the screen; the save still landed, and the next final scored here went
 * out as a bracket that "cleared" this phone's own earlier winner. */
test('a final on its way stays on this screen when an update from before it arrives', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();                                 // the save is started, not yet in the room
  r.deliver(fillElsewhere(r, 1, 'S8', 'S8', 'S9')); // another phone's winner arrives first
  assert.equal(r.app.S.bracket.South[0], 'S1', 'this phone\'s winner is still shown');
  assert.equal(r.app.S.bracket.South[1], 'S8', 'next to the one the update brought');
  await r.finish(0);
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8');
  fill(r, 2, 'S5');                               // the next final scored here
  await r.fire();
  await r.finish(1);
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8 South_2:S5', 'does not empty the first one in the room');
}));

test('finals scored during a poll, after the save in flight was started, stay on this screen when an update arrives', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();                                 // save 1 is started
  r.app.S.bracket.South[1] = 'S8';                // the poll goes on: the next final is filled, its save comes at the end of the poll
  r.deliver(fillElsewhere(r, 2, 'S5', 'S5', 'S12'));
  assert.deepEqual(r.app.S.bracket.South.slice(0, 3), ['S1', 'S8', 'S5'], 'all three are shown');
  r.app.eval('syncGames()'); r.app._debouncedFirestoreWrite(); // the end of the poll
  await r.finish(0);
  await r.fire();
  await r.finish(1);
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8 South_2:S5');
}));

test('a winner an update brought and the room has dropped since is not kept while a save of this phone is on its way', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();                                   // this phone's save is started
  r.deliver(fillElsewhere(r, 1, 'S8', 'S8', 'S9')); // another phone's winner arrives: shown next to ours
  assert.equal(r.app.S.bracket.South[1], 'S8');
  r.deliver(r.elsewhere(room => { room.bracket.South[1] = null; room.games = room.games.filter(g => g.id !== 'South_1'); })); // the commissioner clears it
  assert.equal(r.app.S.bracket.South[1], null, 'the cleared winner is gone here too');
  assert.equal(r.app.S.bracket.South[0], 'S1', 'this phone\'s own final is still shown');
  await r.finish(0);
  assert.equal(gameIds(r.server()), 'South_0:S1');
}));
