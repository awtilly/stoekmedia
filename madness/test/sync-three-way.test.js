const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* The debounced whole-state write sends only the keys this device edited since its last sync; every other
 * key goes out as the server holds it at commit time. `srv.state` is the room document's state string. The
 * fake transaction re-runs the callback when the document changed between its read and its commit, the way
 * Firestore does, and delivers the committed write back as a snapshot (our own echo). */
function room() {
  const app = createApp();
  const srv = { state: null, commits: 0, failWith: null, beforeCommit: null };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  const snapshot = state => app._applyRoomSnapshot({ exists: true, data: () => ({ state }), metadata: {} });
  app.db = {
    collection: () => ({ doc: id => ({ id, set: data => { srv.state = data.state; return Promise.resolve(); } }) }),
    runTransaction: async fn => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const readState = srv.state;
        let next = null;
        await fn({ get: async () => ({ exists: true, data: () => ({ state: readState }) }), set: (ref, data) => { next = data.state; } });
        if (srv.beforeCommit) { const f = srv.beforeCommit; srv.beforeCommit = null; f(); }
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
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _sharedAtSync = null;');
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
const lastSynced = () => vm.runInThisContext('_lastSyncedState');

test('nothing else changed on the server: exactly our state is written and the echo is skipped', async () => {
  const { app, srv } = room();
  app.S.rp[3] = 9;
  const expected = JSON.stringify(sharedOf(app));
  app._writeSharedState();
  await settle();
  assert.equal(srv.state, expected, 'byte-for-byte what this device holds');
  assert.equal(lastSynced(), expected, 'dedupe key set, so the echo costs no parse or redraw');
});

test('another device changed a key we did not touch and its snapshot has not reached us: their change survives our write', async () => {
  const { app, srv } = room();
  otherDevice(srv, r => { r.ub = false; });
  app.S.rp[3] = 9;
  app._writeSharedState();
  await settle();
  const server = JSON.parse(srv.state);
  assert.equal(server.ub, false, 'the other device\'s edit is still on the server');
  assert.equal(server.rp[3], 9, 'our edit is on the server');
  assert.equal(app.S.ub, false, 'the echo was applied: this device caught up');
  assert.equal(app.S.rp[3], 9);
});

test('another device\'s edit lands while our write is in flight: the server keeps both and this device matches it', async () => {
  const { app, srv, snapshot } = room();
  app.S.rp[3] = 9;
  srv.beforeCommit = () => { otherDevice(srv, r => { r.ub = false; }); snapshot(srv.state); };
  app._writeSharedState();
  await settle();
  const server = JSON.parse(srv.state);
  assert.equal(server.rp[3], 9, 'our edit survived the retry');
  assert.equal(server.ub, false, 'their edit survived the retry');
  assert.equal(app.S.rp[3], 9, 'this device shows our edit again after the echo');
  assert.equal(app.S.ub, false);
  assert.equal(JSON.stringify(sharedOf(app)), srv.state, 'device and server hold the same state');
});

test('both devices edited the same key: the later write wins, as before', async () => {
  const { app, srv } = room();
  otherDevice(srv, r => { r.rp[3] = 5; });
  app.S.rp[3] = 9;
  app._writeSharedState();
  await settle();
  assert.equal(JSON.parse(srv.state).rp[3], 9);
});

test('a key the server has and this device does not know is kept', async () => {
  const { app, srv } = room();
  otherDevice(srv, r => { r.futureSetting = { a: 1 }; });
  app.S.ub = false;
  app._writeSharedState();
  await settle();
  const server = JSON.parse(srv.state);
  assert.deepEqual(server.futureSetting, { a: 1 });
  assert.equal(server.ub, false);
});

test('a pick that landed on the server still wins over our older draft state, with our other edit on top', async () => {
  const { app, srv } = room();
  otherDevice(srv, r => { r.ds.cp = 1; r.players[0].teamIds = ['T1']; });
  app.S.ub = false;
  app._writeSharedState();
  await settle();
  const server = JSON.parse(srv.state);
  assert.equal(server.ds.cp, 1);
  assert.deepEqual(server.players[0].teamIds, ['T1']);
  assert.equal(server.ub, false);
  assert.equal(app.S.ds.cp, 1, 'this device caught up through the echo');
});

test('an edit made while the previous write is in flight is not wiped by that write\'s echo, and reaches the server', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    app.S.rp[3] = 9;
    srv.beforeCommit = () => { app.S.ub = false; app.__real.saveState(); }; // the user keeps editing during the round trip
    app._writeSharedState();
    await settle();
    assert.equal(JSON.parse(srv.state).rp[3], 9, 'first edit committed');
    assert.equal(app.S.ub, false, 'second edit still on screen after the first write\'s echo');
    mock.timers.tick(800);
    await settle();
    const server = JSON.parse(srv.state);
    assert.equal(server.ub, false, 'second edit committed by its own debounced write');
    assert.equal(server.rp[3], 9);
    assert.equal(srv.commits, 2);
  } finally {
    mock.timers.reset();
  }
});

test('a write that fails for good: the next write still carries its edit, and still keeps what other devices changed', async () => {
  const { app, srv } = room();
  app.S.rp[3] = 9;
  srv.failWith = { code: 'permission-denied' };
  app._writeSharedState();
  await settle();
  assert.equal(JSON.parse(srv.state).rp[3], 4, 'nothing was written');
  assert.equal(app.__calls.toasts.length, 1, 'the user was told');
  srv.failWith = null;
  otherDevice(srv, r => { r.futureSetting = { a: 1 }; });
  app.S.ub = false;
  app._writeSharedState();
  await settle();
  const server = JSON.parse(srv.state);
  assert.equal(server.rp[3], 9, 'the edit whose write failed went out with the next one');
  assert.equal(server.ub, false);
  assert.deepEqual(server.futureSetting, { a: 1 }, 'the other device\'s change was not overwritten');
});

test('two of our writes overlap while another device\'s change is still unseen: all three edits end up on the server', async () => {
  const { app, srv } = room();
  otherDevice(srv, r => { r.futureSetting = { a: 1 }; }); // its snapshot has not reached this device
  app.S.rp[3] = 9;
  srv.beforeCommit = () => { app.S.ub = false; app._writeSharedState(); }; // second write starts before the first commits
  app._writeSharedState();
  await settle();
  const server = JSON.parse(srv.state);
  assert.equal(server.rp[3], 9, 'first edit');
  assert.equal(server.ub, false, 'second edit');
  assert.deepEqual(server.futureSetting, { a: 1 }, 'the other device\'s change');
  assert.equal(JSON.stringify(sharedOf(app)), srv.state, 'device and server hold the same state');
});

test('an edit typed while a save is on its way survives that save\'s echo even when the echo has to be applied', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    otherDevice(srv, r => { r.futureSetting = { a: 1 }; }); // unseen here: our save merges it, so its echo is applied, not skipped
    app.S.rp[3] = 9;
    srv.beforeCommit = () => { app.S.ub = false; app.__real.saveState(); }; // typed during the round trip
    app._writeSharedState();
    await settle();
    assert.deepEqual(app.S.futureSetting, { a: 1 }, 'the echo was applied');
    assert.equal(app.S.rp[3], 9);
    assert.equal(app.S.ub, false, 'the edit still waiting in the save delay was kept');
    mock.timers.tick(800);
    await settle();
    const server = JSON.parse(srv.state);
    assert.equal(server.ub, false, 'and it reached the server with its own save');
    assert.equal(server.rp[3], 9);
    assert.deepEqual(server.futureSetting, { a: 1 });
  } finally {
    mock.timers.reset();
  }
});
