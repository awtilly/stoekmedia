const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A save whose transaction fails outright (not offline: contention after Firestore's own retries, a refused write)
 * used to leave the edit in S with a "saved locally" toast and nothing armed to send it again. The next snapshot
 * from another phone then replaced S and the local copy, and the edit was gone. Now the save is retried through the
 * debounce (a few times, then it gives up), and until then the edit is protected from snapshots the way an edit in
 * the debounce window is. */
function room() {
  const app = createApp();
  const srv = { state: null, commits: 0, failWith: null };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  const snapshot = state => app._applyRoomSnapshot({ exists: true, data: () => ({ state }), metadata: {} });
  app.db = {
    collection: () => ({ doc: id => ({ id, set: data => { srv.state = data.state; return Promise.resolve(); } }) }),
    runTransaction: async fn => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const readState = srv.state;
        let next = null;
        await fn({ get: async () => ({ exists: true, data: () => ({ state: readState }) }), set: (ref, data) => { next = data.state; } });
        if (srv.failWith) throw srv.failWith;
        if (srv.state !== readState) continue;
        srv.state = next;
        srv.commits++;
        snapshot(srv.state);
        return;
      }
      throw { code: 'aborted' };
    }
  };
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _sharedAtSync = null; _syncedShared = null; _writeRetries = 0;');
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  app.S.ds = { order: ['p1'], cp: 0, started: true, complete: false, epoch: 1 };
  app.S.rp = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 };
  app.S.ub = true;
  srv.state = JSON.stringify(sharedOf(app));
  snapshot(srv.state); // this device is in sync with the server
  return { app, srv, snapshot };
}
function sharedOf(app) {
  const out = {};
  for (const k in app.S) if (!app.eval('VIEW_LOCAL').includes(k)) out[k] = app.S[k];
  return out;
}
/** Another device changes the room document directly (its write is already committed). */
function otherDevice(srv, change) { const r = JSON.parse(srv.state); change(r); srv.state = JSON.stringify(r); }
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const timerArmed = () => vm.runInThisContext('_firestoreWriteTimer') !== null;

test('a save fails for good, another phone\'s snapshot lands first: the edit stays on this phone and the retry sends it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv, snapshot } = room();
    app.S.rp[3] = 9;
    srv.failWith = { code: 'aborted' };
    app._writeSharedState();
    await settle();
    assert.equal(JSON.parse(srv.state).rp[3], 4, 'nothing was written');
    assert.deepEqual(app.__calls.toasts, ['Sync error — trying again']);
    assert.ok(timerArmed(), 'the save is armed again');
    srv.failWith = null;
    otherDevice(srv, r => { r.ub = false; });
    snapshot(srv.state);
    assert.equal(app.S.ub, false, 'the other phone\'s change arrived');
    assert.equal(app.S.rp[3], 9, 'the edit is still on this phone');
    mock.timers.tick(800);
    await settle();
    const server = JSON.parse(srv.state);
    assert.equal(server.rp[3], 9, 'the retry sent the edit');
    assert.equal(server.ub, false, 'and kept the other phone\'s change');
    assert.equal(app.S.rp[3], 9);
    assert.ok(!timerArmed());
  } finally { mock.timers.reset(); }
});

test('a save that keeps failing is retried a few times, then the user is told it is only saved locally; a save that gets through resets the count', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    app.S.rp[3] = 9;
    srv.failWith = { code: 'permission-denied' };
    app._writeSharedState();
    await settle();
    let rounds = 0;
    while (timerArmed() && rounds < 20) { rounds++; mock.timers.tick(800); await settle(); }
    assert.equal(rounds, 5, 'five retries');
    assert.ok(!timerArmed(), 'then it stops');
    assert.equal(app.__calls.toasts.filter(t => t === 'Sync error — trying again').length, 5);
    assert.equal(app.__calls.toasts[app.__calls.toasts.length - 1], 'Sync error — changes saved locally');
    assert.equal(JSON.parse(srv.state).rp[3], 4, 'nothing reached the server');
    assert.equal(app.S.rp[3], 9, 'the edit is still here');
    // The server accepts again: the next save gets through and a later failure is retried once more.
    srv.failWith = null;
    app.S.ub = false;
    app._writeSharedState();
    await settle();
    assert.equal(JSON.parse(srv.state).rp[3], 9, 'the edit went out with the next save');
    assert.equal(JSON.parse(srv.state).ub, false);
    srv.failWith = { code: 'aborted' };
    app.S.rp[4] = 10;
    app._writeSharedState();
    await settle();
    assert.ok(timerArmed(), 'a failure after a success is retried again');
  } finally { mock.timers.reset(); }
});

test('offline failures are not counted as retries: the plain write queues at once, as before', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    app.S.rp[3] = 9;
    srv.failWith = { code: 'unavailable' };
    app._writeSharedState();
    await settle();
    assert.equal(JSON.parse(srv.state).rp[3], 9, 'the plain write landed');
    assert.deepEqual(app.__calls.toasts, []);
    assert.ok(!timerArmed());
    assert.equal(vm.runInThisContext('_writeRetries'), 0);
  } finally { mock.timers.reset(); }
});
