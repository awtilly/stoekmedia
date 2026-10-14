const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function storageApp() {
  const app = createApp();
  app.localStorage = memStorage();
  app.saveState = app.__real.saveState;
  app.firebase = { firestore: { Timestamp: function (s, n) { this.seconds = s; this.nanoseconds = n; } } };
  return app;
}

test('stateKey is per room, and plain "mm4" for offline play', () => {
  const app = createApp();
  app.roomId = null;
  assert.equal(app.stateKey(), 'mm4');
  app.roomId = 'ABC';
  assert.equal(app.stateKey(), 'mm4_state_ABC');
});

test('saveState caches under the room key; another room does not see it', () => {
  const app = storageApp();
  app.roomId = 'ROOMA';
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: [] }];
  app.saveState();
  assert.ok(app.localStorage.getItem('mm4_state_ROOMA').includes('Ann'));
  assert.equal(app.localStorage.getItem('mm4'), null, 'offline key untouched');

  app.roomId = 'ROOMB';
  app.loadState();
  assert.deepEqual(app.S.players, [], 'room B starts clean, not with room A players');
  assert.equal(app.S.phase, 'draft', 'defaults restored');
});

test('loadState restores the cached copy for the current room and rebuilds the pick deadline', () => {
  const app = storageApp();
  app.roomId = 'ROOMA';
  app.localStorage.setItem('mm4_state_ROOMA', JSON.stringify({
    phase: 'bracket', players: [{ id: 'a', name: 'Ann', teamIds: ['x'] }],
    ds: { order: ['a'], cp: 2, started: true, complete: false, pickDeadline: { seconds: 1700000000, nanoseconds: 0 } }
  }));
  app.loadState();
  assert.equal(app.S.phase, 'bracket');
  assert.deepEqual(app.S.players[0].teamIds, ['x']);
  assert.equal(app.S.ds.pickDeadline.seconds, 1700000000);
});

test('loadState with no cache and corrupt cache both leave S at defaults', () => {
  const app = storageApp();
  app.roomId = 'NEW';
  app.S.players = [{ id: 'stale', name: 'Stale', teamIds: [] }];
  app.loadState();
  assert.deepEqual(app.S.players, []);
  app.localStorage.setItem('mm4_state_NEW', '{not json');
  app.S.players = [{ id: 'stale', name: 'Stale', teamIds: [] }];
  app.loadState();
  assert.deepEqual(app.S.players, [], 'corrupt cache ignored, defaults kept');
});

test('offline play (no room) still round-trips through the legacy "mm4" key', () => {
  const app = storageApp();
  app.roomId = null;
  app.S.players = [{ id: 'o', name: 'Offline', teamIds: [] }];
  app.saveState();
  assert.ok(app.localStorage.getItem('mm4').includes('Offline'));
  app.S.players = [];
  app.loadState();
  assert.equal(app.S.players[0].name, 'Offline');
});
