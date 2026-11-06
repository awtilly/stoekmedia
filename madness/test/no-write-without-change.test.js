const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A save only reaches Firestore when something shared changed. View-only changes (tab, region, filters) call
 * saveState() too; they used to send this phone's whole copy of the room. `srv.state` is the room document. */
function room({ failSet } = {}) {
  const app = createApp();
  const srv = { state: null, writes: 0 };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = {
    collection: () => ({ doc: () => ({ set: data => {
      if (failSet && failSet()) return Promise.reject({ code: 'permission-denied' });
      srv.writes++; srv.state = data.state; return Promise.resolve();
    } }) })
  };
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
const save = app => { app.__real.saveState(); mock.timers.tick(800); };
const settle = () => new Promise(r => setImmediate(r));

test('switching tabs or filters writes nothing to the room', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    for (const [k, v] of [['phase', 'leaderboard'], ['bracketRegion', 'East'], ['fr', 'South'], ['fs', '1'], ['liveScoresFilter', 'final'], ['liveScoresDate', '20270318']]) {
      app.S[k] = v;
      save(app);
    }
    assert.equal(srv.writes, 0);
  } finally { mock.timers.reset(); }
});

test('a phone that is behind does not roll the room back by switching tabs', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    // A pick lands on the server; this phone has not received it (asleep, bad signal).
    const ahead = JSON.parse(srv.state);
    ahead.ds.cp = 1; ahead.players[0].teamIds = ['South-1'];
    srv.state = JSON.stringify(ahead);
    app.S.phase = 'bracket';
    save(app);
    assert.equal(JSON.parse(srv.state).ds.cp, 1, 'the pick is still on the server');
    assert.deepEqual(JSON.parse(srv.state).players[0].teamIds, ['South-1']);
    assert.equal(srv.writes, 0);
  } finally { mock.timers.reset(); }
});

test('a real edit is still written, once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    app.S.rp[3] = 9;
    save(app);
    assert.equal(srv.writes, 1);
    assert.equal(JSON.parse(srv.state).rp[3], 9);
    app.S.phase = 'settings';
    save(app);
    assert.equal(srv.writes, 1, 'the tab switch after it writes nothing more');
    app.S.ub = false;
    save(app);
    assert.equal(srv.writes, 2, 'the next real edit does');
  } finally { mock.timers.reset(); }
});

test('after someone else\'s change arrives, a tab switch still writes nothing and a new edit does', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv, snapshot } = room();
    const other = JSON.parse(srv.state); other.ub = false;
    snapshot(JSON.stringify(other));
    app.S.phase = 'live';
    save(app);
    assert.equal(srv.writes, 0);
    app.S.rp[1] = 3;
    save(app);
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
    save(app);
    await settle();
    assert.equal(srv.writes, 0);
    fail = false;
    app.S.phase = 'draft';
    save(app);
    assert.equal(srv.writes, 1);
    assert.equal(JSON.parse(srv.state).rp[3], 9);
  } finally { mock.timers.reset(); }
});

test('leaving a room with only a tab switch pending flushes nothing', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, srv } = room();
    app.S.phase = 'leaderboard';
    app.__real.saveState();
    app.flushFirestoreWrite();
    assert.equal(srv.writes, 0);
  } finally { mock.timers.reset(); }
});

test('entering a room with only this phone\'s cached copy: a tab switch before the first update arrives writes nothing, an edit does', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const app = createApp();
    const writes = [];
    app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
    app.db = { collection: () => ({ doc: () => ({
      set: data => { writes.push(JSON.parse(data.state)); return Promise.resolve(); },
      onSnapshot: () => () => {} // offline, nothing cached: no snapshot is delivered
    }) }) };
    vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _sharedAtSync = null;');
    app.unsubRoom = null; app._roomGeneration = 0; app._pickInFlight = false; // 30-state.js / 80-pages.js globals the harness does not load
    app.roomId = 'AAAA';
    app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }]; // the copy loadState() restored from this phone's cache
    app.connectToRoom('AAAA');
    app.S.phase = 'bracket';
    save(app);
    assert.equal(writes.length, 0, 'the old cached copy was not sent');
    app.S.ub = !app.S.ub;
    save(app);
    assert.equal(writes.length, 1, 'a real edit still goes out');
  } finally { mock.timers.reset(); }
});
