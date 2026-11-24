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

/* A correction (a winner changed or cleared) is written whole by the phone that made it. It can have landed after
 * this phone's save, and the room then no longer has this phone's winners: the screen follows it, and this phone's
 * final is back with the update that carries its own save. */
test('a correction that arrives while a save of this phone is on its way wins on the screen; the final is back once the save has landed', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();                                   // this phone's save is started
  r.deliver(fillElsewhere(r, 1, 'S8', 'S8', 'S9')); // another phone's winner arrives: shown next to ours
  assert.equal(r.app.S.bracket.South[1], 'S8');
  assert.equal(r.app.S.bracket.South[0], 'S1');
  r.deliver(r.elsewhere(room => { room.bracket.South[1] = null; room.games = room.games.filter(g => g.id !== 'South_1'); })); // the commissioner clears it
  assert.equal(r.app.S.bracket.South[1], null, 'the cleared winner is gone here too');
  await r.finish(0);
  r.deliver(r.now());
  assert.equal(gameIds(r.server()), 'South_0:S1', 'this phone\'s final is in the room');
  assert.equal(r.app.S.bracket.South[0], 'S1', 'and on its screen');
  assert.equal(gameIds(r.app.S), 'South_0:S1');
}));

/** The room already holds South game 1 (S8), shown to this phone. */
const roomWithS8 = () => { const r = bracketRoom(); r.deliver(fillElsewhere(r, 1, 'S8', 'S8', 'S9')); return r; };
/** This phone's save is in the room, its confirmation has not come back yet. */
const landUnconfirmed = async (r, i) => { r.txs[i].rerun = true; for (let n = 0; n < 8 && !r.txs[i].done; n++) { r.txs[i].go(); await r.flush(); } assert.equal(r.txs[i].done, true); };

test('a correction written whole AFTER this phone\'s save landed: the screen shows the room, not the final the room no longer has', withTimers(async () => {
  const r = roomWithS8();
  fill(r, 0, 'S1');
  await r.fire();
  await landUnconfirmed(r, 0);
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8');
  // another phone, which had not been shown S1, corrects game 1 and writes its whole bracket
  r.deliver(r.elsewhere(room => { room.bracket.South[0] = null; room.bracket.South[1] = 'S9'; room.games = [{ id: 'South_1', round: 1, t1: 'S8', t2: 'S9', wid: 'S9' }]; }));
  assert.deepEqual(r.app.S.bracket.South.slice(0, 2), r.server().bracket.South.slice(0, 2), 'this screen shows what the room holds');
  assert.equal(gameIds(r.app.S), gameIds(r.server()));
}));

test('two phones fill the same game differently: the screen shows the winner the update brings', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();
  await landUnconfirmed(r, 0);
  r.deliver(r.elsewhere(room => { room.bracket.South[0] = 'S16'; room.games = [{ id: 'South_0', round: 1, t1: 'S1', t2: 'S16', wid: 'S16' }]; })); // the commissioner's tap, after ours
  assert.equal(r.app.S.bracket.South[0], 'S16');
  assert.equal(gameIds(r.app.S), 'South_0:S16');
}));

test('a final on its way stays next to an update that fills OTHER games, and the games list on the screen is the one that bracket makes', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();
  r.deliver(fillElsewhere(r, 1, 'S8', 'S8', 'S9'));
  assert.equal(gameIds(r.app.S), 'South_0:S1 South_1:S8');
  r.deliver(fillElsewhere(r, 2, 'S5', 'S5', 'S12'));
  assert.equal(gameIds(r.app.S), 'South_0:S1 South_1:S8 South_2:S5');
  await r.finish(0);
  r.deliver(r.now());
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8 South_2:S5');
  assert.equal(gameIds(r.app.S), gameIds(r.server()));
}));

test('a save that carries a corrected bracket and not the games list still writes the list that bracket makes', withTimers(async () => {
  const r = roomWithS8();
  r.app.S.bracket.South[1] = 'S9';                  // a winner changed here; the games list on this screen is not rebuilt yet
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await r.finish(0);
  assert.equal(r.server().bracket.South[1], 'S9');
  assert.equal(gameIds(r.server()), 'South_1:S9', 'the room\'s list follows the bracket written');
}));

test('a winner corrected here stays on the screen when the echo of this phone\'s own older save arrives', withTimers(async () => {
  const r = bracketRoom();
  fill(r, 0, 'S1');
  await r.fire();
  await r.finish(0);
  const echo = r.now();                             // the update that carries save 1, still on its way to this phone
  r.app.S.bracket.South[0] = 'S16'; r.app.eval('syncGames()'); r.app._debouncedFirestoreWrite(); // corrected here
  await r.fire();                                   // save 2 is started
  r.deliver(echo);
  assert.equal(r.app.S.bracket.South[0], 'S16', 'the correction is still shown');
  await r.finish(1);
  assert.equal(gameIds(r.server()), 'South_0:S16');
}));

/* A score check fills its slots one by one and starts the save at its end: in between, the screen is ahead of the
 * room with no save waiting and none on its way. */
test('finals filled during a score check, before any save is started, stay when an update arrives', withTimers(async () => {
  const r = bracketRoom();
  r.app.S.bracket.South[0] = 'S1';                  // the check has filled its first final; it is still reading the others
  r.deliver(fillElsewhere(r, 1, 'S8', 'S8', 'S9')); // another phone's winner arrives
  assert.equal(r.app.S.bracket.South[0], 'S1', 'this phone\'s final is still shown');
  assert.equal(r.app.S.bracket.South[1], 'S8');
  r.deliver(fillElsewhere(r, 2, 'S5', 'S5', 'S12')); // and a second update before the check ends
  assert.deepEqual(r.app.S.bracket.South.slice(0, 3), ['S1', 'S8', 'S5']);
  r.app.eval('syncGames()'); r.app._debouncedFirestoreWrite(); // the end of the check
  await r.fire();
  await r.finish(0);
  assert.equal(gameIds(r.server()), 'South_0:S1 South_1:S8 South_2:S5');
}));

