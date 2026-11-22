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
        // t.lose: the save is in the room, but the phone is told it failed (the confirmation never arrived)
        if (t.lose) { await new Promise(r => { t.ack = r; }); throw Object.assign(new Error('confirmation lost'), { code: 'internal' }); }
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
  vm.runInThisContext('if(typeof _saveWrote !== "undefined"){ _saveWrote = {}; _landedSeen = {}; } if(typeof _refusedAdds !== "undefined") _refusedAdds = {};');
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


/* A save can land although the phone is told it failed: the connection dropped between the commit and its
 * confirmation. The phone must still learn that the room holds what it sent. */
const lostConfirmation = async (r, i) => { r.txs[i].lose = true; await r.finish(i); };
const told = async (r, i) => { r.txs[i].ack(); await r.flush(); await r.flush(); };

test('a player added by a save that landed unconfirmed can be taken off again (the update comes after the refusal)', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await lostConfirmation(r, 0);
  assert.deepEqual(ids(r.server().players), ['n1', 'p1']); // it is in the room
  await told(r, 0);                                         // ...and the phone is told the save failed
  r.deliver(r.now());                                       // the update that brings the save
  r.app.S.players = r.app.S.players.filter(p => p.id !== 'n1');
  r.app._debouncedFirestoreWrite();
  await r.fire();
  for (let i = 1; i < r.txs.length; i++) await r.finish(i);
  await r.fire();
  for (let i = 1; i < r.txs.length; i++) if (!r.txs[i].done) await r.finish(i);
  assert.deepEqual(ids(r.server().players), ['p1']);
  assert.deepEqual(ids(r.app.S.players), ['p1']);
}));

test('a player added by a save that landed unconfirmed can be taken off again (the update comes before the refusal)', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await lostConfirmation(r, 0);
  r.deliver(r.now());                                       // the room with the save in it is shown first
  await told(r, 0);                                         // then the phone is told the save failed
  r.app.S.players = r.app.S.players.filter(p => p.id !== 'n1');
  r.app._debouncedFirestoreWrite();
  await r.fire();
  for (let i = 1; i < r.txs.length; i++) await r.finish(i);
  await r.fire();
  for (let i = 1; i < r.txs.length; i++) if (!r.txs[i].done) await r.finish(i);
  assert.deepEqual(ids(r.server().players), ['p1']);
  assert.deepEqual(ids(r.app.S.players), ['p1']);
}));

test('a player added by a save that landed unconfirmed and taken off before any update shows them leaves the room', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await lostConfirmation(r, 0);
  await told(r, 0);                                         // told the save failed; no update has shown the room yet
  r.app.S.players = r.app.S.players.filter(p => p.id !== 'n1'); // taken off again while the retry waits
  r.app._debouncedFirestoreWrite();
  await r.fire();
  for (let i = 1; i < r.txs.length; i++) if (!r.txs[i].done) await r.finish(i);
  r.deliver(r.now());                                       // the room, with the landed save in it
  for (let n = 0; n < 3; n++) { await r.fire(); for (let i = 1; i < r.txs.length; i++) if (!r.txs[i].done) await r.finish(i); }
  assert.deepEqual(ids(r.server().players), ['p1']);
  assert.deepEqual(ids(r.app.S.players), ['p1']);
}));

test('a player whose adding save really was refused is added by the retry and stays', withTimers(async () => {
  const r = stampedRoom();
  r.app.S.players = r.app.S.players.concat([N('n1')]);
  r.app._debouncedFirestoreWrite();
  await r.fire();
  await r.refuse(0, 'internal');
  r.deliver(r.elsewhere(room => { room.ub = false; }));     // somebody else's change arrives while the retry waits
  for (let n = 0; n < 3; n++) { await r.fire(); for (let i = 1; i < r.txs.length; i++) if (!r.txs[i].done) await r.finish(i); }
  r.deliver(r.now());
  await r.fire();
  assert.deepEqual(ids(r.server().players), ['n1', 'p1']);
  assert.deepEqual(ids(r.app.S.players), ['n1', 'p1']);
}));

test('a save that really was refused is still sent again', withTimers(async () => {
  const r = stampedRoom();
  r.set('ub', false);
  await r.fire();
  await r.refuse(0, 'internal');
  assert.equal(r.server().ub, true);
  await r.fire();
  await r.finish(1);
  assert.equal(r.server().ub, false);
}));
