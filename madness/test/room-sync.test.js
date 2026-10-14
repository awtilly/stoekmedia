const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/** In-memory localStorage so recent-room bookkeeping can be observed. */
function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function roomApp() {
  const app = createApp();
  app.localStorage = memStorage();
  app.roomId = 'TYPO';
  app.firebase = { firestore: { Timestamp: function (s, n) { this.seconds = s; this.nanoseconds = n; } } };
  app.db = { collection() { throw new Error('snapshot handling must not write to Firestore'); } };
  app.saveRecentRoom('TYPO');
  app.saveRecentRoom('REAL1');
  return app;
}

const serverMissing = { exists: false, metadata: { fromCache: false, hasPendingWrites: false } };
const cacheMissing = { exists: false, metadata: { fromCache: true, hasPendingWrites: false } };

test('unknown room (server says missing): no write, leave to lobby, toast, drop from recent rooms', () => {
  const app = roomApp();
  app._applyRoomSnapshot(serverMissing);
  assert.equal(app.__calls.saveState, 0, 'must not create the room from local state');
  assert.equal(app.__calls.goHome, 1);
  assert.deepEqual(app.__calls.toasts, ['Room TYPO not found']);
  assert.deepEqual(app.getRecentRooms().map(r => r.code), ['REAL1']);
});

test('offline with nothing cached: wait for the server, change nothing', () => {
  const app = roomApp();
  app._applyRoomSnapshot(cacheMissing);
  assert.equal(app.__calls.saveState, 0);
  assert.equal(app.__calls.goHome, 0);
  assert.deepEqual(app.__calls.toasts, []);
  assert.deepEqual(app.getRecentRooms().map(r => r.code), ['REAL1', 'TYPO']);
});

test('existing room: remote state replaces shared keys, view-local keys survive, render runs once', () => {
  const app = roomApp();
  app.S.phase = 'leaderboard';
  app.S.bracketRegion = 'West';
  app.S.players = [{ id: 'old', name: 'Old Room Player', teamIds: [] }];
  const remote = {
    phase: 'draft', bracketRegion: 'South',
    players: [{ id: 'p9', name: 'Remote', teamIds: [] }],
    ds: { order: ['p9'], cp: 3, started: true, complete: false, pickDeadline: { seconds: 1700000000, nanoseconds: 5 } }
  };
  app._applyRoomSnapshot({ exists: true, metadata: { fromCache: false }, data: () => ({ state: JSON.stringify(remote) }) });
  assert.equal(app.S.phase, 'leaderboard', 'phase is view-local');
  assert.equal(app.S.bracketRegion, 'West', 'bracketRegion is view-local');
  assert.deepEqual(app.S.players.map(p => p.id), ['p9']);
  assert.equal(app.S.ds.cp, 3);
  assert.equal(app.S.ds.pickDeadline.seconds, 1700000000, 'Timestamp reconstructed');
  assert.equal(app.__calls.render, 1);
  assert.equal(app.__calls.saveState, 0, 'remote updates never echo back to Firestore');
  assert.equal(app.__calls.goHome, 0);
});

test('existing room with no state field is ignored', () => {
  const app = roomApp();
  app._applyRoomSnapshot({ exists: true, metadata: { fromCache: false }, data: () => ({ adminPin: 'x' }) });
  assert.equal(app.__calls.render, 0);
  assert.equal(app.__calls.saveState, 0);
});

test('forgetRecentRoom tolerates garbage in storage and keeps the others', () => {
  const app = roomApp();
  app.localStorage.setItem('mm4_rooms', '[{"code":"A"},null,{"code":"B"}]');
  app.forgetRecentRoom('A');
  assert.deepEqual(app.getRecentRooms().map(r => r.code), ['B']);
  app.localStorage.setItem('mm4_rooms', 'not json');
  app.forgetRecentRoom('B'); // must not throw
});
