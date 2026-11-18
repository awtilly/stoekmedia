const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A room snapshot that arrives while a local edit is still waiting in the 800 ms debounce used to replace S
 * wholesale: the edit vanished from the screen and the debounce then wrote the server's own state back. These
 * tests drive _applyRoomSnapshot + the debounced write against a fake server that keeps the last write. */
function roomApp() {
  const app = createApp();
  const srv = { state: null, writes: 0 };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = {
    collection: () => ({ doc: id => ({ id, set: data => { srv.state = data.state; srv.writes++; return Promise.resolve(); } }) }),
    runTransaction: async fn => {
      let next = null;
      await fn({ get: async () => ({ exists: !!srv.state, data: () => ({ state: srv.state }) }), set: (ref, data) => { next = data.state; } });
      srv.state = next; srv.writes++;
    }
  };
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _lastSnapshotPlayerIds = null; _syncedShared = null; _sharedAtSync = null;');
  const first = {
    players: [{ id: 'p1', name: 'Ann', teamIds: [] }, { id: 'p2', name: 'Bob', teamIds: [] }],
    ds: { order: ['p1', 'p2'], cp: 0, started: true, complete: false, epoch: 1 },
    rp: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 }, ub: true
  };
  const snapshot = state => app._applyRoomSnapshot({ exists: true, data: () => ({ state }), metadata: {} });
  srv.state = JSON.stringify(Object.assign(JSON.parse(JSON.stringify(app.S)), first));
  snapshot(srv.state); // the snapshot this device joined with
  // What another device does: change the server copy and let the snapshot reach us.
  const elsewhere = fn => { const r = JSON.parse(srv.state); fn(r); srv.state = JSON.stringify(r); snapshot(srv.state); };
  const pick = r => { r.players[0].teamIds = ['South-1']; r.ds.cp = 1; };
  const fire = async () => { mock.timers.tick(800); await new Promise(r => setImmediate(r)); };
  return { app, srv, elsewhere, pick, fire, server: () => JSON.parse(srv.state) };
}
const withTimers = fn => async () => { mock.timers.enable({ apis: ['setTimeout'] }); try { await fn(); } finally { mock.timers.reset(); } };

test('a scoring edit made just before somebody else\'s pick arrives stays on screen and reaches the server', withTimers(async () => {
  const { app, elsewhere, pick, fire, server } = roomApp();
  app.S.rp[3] = 9;
  app._debouncedFirestoreWrite();
  mock.timers.tick(300);
  elsewhere(pick);
  assert.equal(app.S.rp[3], 9, 'the edit is still on this device');
  assert.deepEqual(app.S.players[0].teamIds, ['South-1'], 'and the pick arrived');
  assert.equal(app.S.ds.cp, 1);
  await fire();
  assert.equal(server().rp[3], 9, 'the edit reached the server');
  assert.deepEqual(server().players[0].teamIds, ['South-1'], 'the pick was not rolled back');
  assert.equal(server().ds.cp, 1);
}));

test('with nothing pending a snapshot still replaces everything, exactly as before', withTimers(async () => {
  const { app, elsewhere, srv } = roomApp();
  const writes = srv.writes;
  elsewhere(r => { r.rp[3] = 7; r.ub = false; r.players[0].teamIds = ['South-1']; r.ds.cp = 1; });
  assert.equal(app.S.rp[3], 7);
  assert.equal(app.S.ub, false);
  assert.equal(app.S.ds.cp, 1);
  assert.equal(srv.writes, writes, 'applying a snapshot writes nothing');
}));

test('only the keys edited here are kept: everything else in the snapshot is taken', withTimers(async () => {
  const { app, elsewhere, fire, server } = roomApp();
  app.S.rp[3] = 9;
  app._debouncedFirestoreWrite();
  elsewhere(r => { r.ub = false; });
  assert.equal(app.S.ub, false, 'the other device\'s change to a key we did not touch is applied');
  assert.equal(app.S.rp[3], 9);
  await fire();
  assert.equal(server().ub, false);
  assert.equal(server().rp[3], 9);
}));

test('two snapshots inside one debounce window: the edit survives both', withTimers(async () => {
  const { app, elsewhere, pick, fire, server } = roomApp();
  app.S.rp[3] = 9;
  app._debouncedFirestoreWrite();
  elsewhere(pick);
  elsewhere(r => { r.players[1].teamIds = ['East-1']; r.ds.cp = 2; });
  assert.equal(app.S.rp[3], 9);
  assert.equal(app.S.ds.cp, 2);
  await fire();
  assert.equal(server().rp[3], 9);
  assert.equal(server().ds.cp, 2);
  assert.deepEqual(server().players.map(p => p.teamIds), [['South-1'], ['East-1']]);
}));

test('a player added here while a pick lands elsewhere: both the newcomer and the pick are kept', withTimers(async () => {
  const { app, elsewhere, pick, fire, server } = roomApp();
  app.S.players.push({ id: 'p3', name: 'Cy', teamIds: [] });
  app._debouncedFirestoreWrite();
  elsewhere(pick);
  assert.deepEqual(app.S.players.map(p => p.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(app.S.players[0].teamIds, ['South-1'], 'the server roster wins for draft progress');
  await fire();
  assert.deepEqual(server().players.map(p => p.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(server().players[0].teamIds, ['South-1']);
  assert.equal(server().ds.cp, 1);
}));

test('the view-local keys are never touched by any of this', withTimers(async () => {
  const { app, elsewhere, pick } = roomApp();
  app.S.phase = 'bracket';
  app.S.rp[3] = 9;
  app._debouncedFirestoreWrite();
  elsewhere(r => { pick(r); r.phase = 'draft'; });
  assert.equal(app.S.phase, 'bracket');
}));

test('both sides changed the same key inside the window: the snapshot wins for that key, as before; other pending edits are kept', withTimers(async () => {
  const { app, elsewhere, fire, server } = roomApp();
  app.S.rp[3] = 9;      // edited here...
  app.S.ub = false;     // ...and this too
  app._debouncedFirestoreWrite();
  elsewhere(r => { r.rp[3] = 7; }); // another admin changed the same round at the same moment
  assert.equal(app.S.rp[3], 7, 'a real conflict on one key goes to the snapshot (unchanged behaviour)');
  assert.equal(app.S.ub, false, 'the edit to a key the snapshot did not change survives');
  await fire();
  assert.equal(server().rp[3], 7);
  assert.equal(server().ub, false);
}));
