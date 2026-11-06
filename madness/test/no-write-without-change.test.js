const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A save only reaches Firestore when something shared changed. View-only changes (tab, region, filters) call
 * saveState() too; they used to send this phone's whole copy of the room. `srv.state` is the room document.
 * The fake accepts a plain set() and a transaction alike, so these tests do not care which one the write uses. */
function fakeDb(srv, failSet) {
  const commit = state => { if (failSet && failSet()) throw { code: 'permission-denied' }; srv.writes++; srv.state = state; };
  return {
    collection: () => ({ doc: id => ({
      id,
      set: data => { try { commit(data.state); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
      onSnapshot: () => () => {} // connectToRoom: no snapshot is delivered unless a test calls snapshot()
    }) }),
    runTransaction: async fn => {
      let next = null;
      await fn({ get: async () => ({ exists: srv.state !== null, data: () => ({ state: srv.state }) }), set: (ref, data) => { next = data.state; } });
      commit(next);
    }
  };
}
function room({ failSet } = {}) {
  const app = createApp();
  const srv = { state: null, writes: 0 };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = fakeDb(srv, failSet);
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _sharedAtSync = null;');
  const snapshot = state => app._applyRoomSnapshot({ exists: true, data: () => ({ state }), metadata: {} });
  srv.state = JSON.stringify({
    players: [{ id: 'p1', name: 'Ann', teamIds: [] }],
    ds: { order: ['p1'], cp: 0, started: true, complete: false },
    rp: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 }, ub: true
  });
  snapshot(srv.state); // this phone is in sync
  return { app, srv, snapshot };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const save = async app => { app.__real.saveState(); mock.timers.tick(800); await settle(); };

test('switching tabs or filters writes nothing to the room', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    for (const [k, v] of [['phase', 'leaderboard'], ['bracketRegion', 'East'], ['fr', 'South'], ['fs', '1'], ['liveScoresFilter', 'final'], ['liveScoresDate', '20270318']]) {
      app.S[k] = v;
      await save(app);
    }
    assert.equal(srv.writes, 0);
  } finally { mock.timers.reset(); }
});

test('a phone that is behind does not roll the room back by switching tabs', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    // A pick lands on the server; this phone has not received it (asleep, bad signal).
    const ahead = JSON.parse(srv.state);
    ahead.ds.cp = 1; ahead.players[0].teamIds = ['South-1'];
    srv.state = JSON.stringify(ahead);
    app.S.phase = 'bracket';
    await save(app);
    assert.equal(JSON.parse(srv.state).ds.cp, 1, 'the pick is still on the server');
    assert.deepEqual(JSON.parse(srv.state).players[0].teamIds, ['South-1']);
    assert.equal(srv.writes, 0);
  } finally { mock.timers.reset(); }
});

test('a real edit is still written, once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    app.S.rp[3] = 9;
    await save(app);
    assert.equal(srv.writes, 1);
    assert.equal(JSON.parse(srv.state).rp[3], 9);
    app.S.phase = 'settings';
    await save(app);
    assert.equal(srv.writes, 1, 'the tab switch after it writes nothing more');
    app.S.ub = false;
    await save(app);
    assert.equal(srv.writes, 2, 'the next real edit does');
  } finally { mock.timers.reset(); }
});

test('after someone else\'s change arrives, a tab switch still writes nothing and a new edit does', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv, snapshot } = room();
    const other = JSON.parse(srv.state); other.ub = false;
    srv.state = JSON.stringify(other);
    snapshot(srv.state);
    app.S.phase = 'live';
    await save(app);
    assert.equal(srv.writes, 0);
    app.S.rp[1] = 3;
    await save(app);
    assert.equal(srv.writes, 1);
    assert.equal(JSON.parse(srv.state).ub, false);
  } finally { mock.timers.reset(); }
});

test('an edit whose write failed is sent again by the next save, even a view-only one', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let fail = true;
    const { app, srv } = room({ failSet: () => fail });
    app.S.rp[3] = 9;
    await save(app);
    assert.equal(srv.writes, 0);
    fail = false;
    app.S.phase = 'draft';
    await save(app);
    assert.equal(srv.writes, 1);
    assert.equal(JSON.parse(srv.state).rp[3], 9);
  } finally { mock.timers.reset(); }
});

test('leaving a room with only a tab switch pending flushes nothing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    app.S.phase = 'leaderboard';
    app.__real.saveState();
    app.flushFirestoreWrite();
    await settle();
    assert.equal(srv.writes, 0);
  } finally { mock.timers.reset(); }
});

test('entering a room with only this phone\'s cached copy: a tab switch before the first update arrives writes nothing, an edit does', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const app = createApp();
    const srv = { state: null, writes: 0 };
    app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
    app.db = fakeDb(srv); // offline, nothing cached: no snapshot is delivered
    vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _sharedAtSync = null;');
    app.unsubRoom = null; app._roomGeneration = 0; app._pickInFlight = false; // 30-state.js / 80-pages.js globals the harness does not load
    app.roomId = 'AAAA';
    app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }]; // the copy loadState() restored from this phone's cache
    app.connectToRoom('AAAA');
    app.S.phase = 'bracket';
    await save(app);
    assert.equal(srv.writes, 0, 'the old cached copy was not sent');
    app.S.ub = !app.S.ub;
    await save(app);
    assert.equal(srv.writes, 1, 'a real edit still goes out');
  } finally { mock.timers.reset(); }
});
