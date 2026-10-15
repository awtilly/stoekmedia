const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');
const vm = require('node:vm');

/** In-memory localStorage so cache writes are harmless. */
function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function roomApp() {
  const app = createApp();
  app.localStorage = memStorage();
  app.roomId = 'ROOM1';
  app.unsubRoom = null;
  app._roomGeneration = 0;
  app._pickInFlight = false;
  vm.runInThisContext('_lastSyncedState = null'); // module-level let in 60-rooms.js; isolate tests
  app.firebase = {
    firestore: {
      Timestamp: function (s, n) { this.seconds = s; this.nanoseconds = n; },
      FieldValue: { serverTimestamp: () => 'SERVER_TS' }
    }
  };
  app.db = { collection() { throw new Error('this test did not expect a Firestore write'); } };
  return app;
}

function snap(state) {
  const str = typeof state === 'string' ? state : JSON.stringify(state);
  return { exists: true, metadata: { fromCache: false, hasPendingWrites: false }, data: () => ({ state: str }) };
}

const remoteA = { players: [{ id: 'p1', name: 'Ann', teamIds: [] }], ds: { order: ['p1'], cp: 0, started: true, complete: false } };
const remoteB = { players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }], ds: { order: ['p1'], cp: 1, started: true, complete: false } };

test('a snapshot identical to the last applied one is skipped: no re-render, no cache write', () => {
  const app = roomApp();
  app._applyRoomSnapshot(snap(remoteA));
  assert.equal(app.__calls.render, 1);
  const cached = app.localStorage.getItem(app.stateKey());
  app.localStorage.setItem(app.stateKey(), 'UNTOUCHED');
  app._applyRoomSnapshot(snap(remoteA));
  app._applyRoomSnapshot(snap(remoteA));
  assert.equal(app.__calls.render, 1, 'identical snapshots must not redraw');
  assert.equal(app.localStorage.getItem(app.stateKey()), 'UNTOUCHED', 'identical snapshots must not rewrite the cache');
  assert.ok(cached && JSON.parse(cached).ds.cp === 0);
});

test('a snapshot with different state is still applied and rendered', () => {
  const app = roomApp();
  app._applyRoomSnapshot(snap(remoteA));
  app._applyRoomSnapshot(snap(remoteB));
  assert.equal(app.__calls.render, 2);
  assert.equal(app.S.ds.cp, 1);
  assert.deepEqual(app.S.players[0].teamIds, ['South-1']);
  // Same content, different key order => different string => applied again. Cheap and predictable;
  // the aim is to drop the exact echoes, not to deep-compare.
  app._applyRoomSnapshot(snap({ ds: remoteB.ds, players: remoteB.players }));
  assert.equal(app.__calls.render, 3);
});

test('the echo of our own debounced write is skipped, a later remote change is not', async () => {
  const app = roomApp();
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  app.S.ds = { order: ['p1'], cp: 0, started: true, complete: false };
  let written = null;
  app.db = { collection: () => ({ doc: () => ({ set: (doc) => { written = doc; return Promise.resolve(); } }) }) };
  app._debouncedFirestoreWrite();
  await new Promise(r => setTimeout(r, 900)); // the 800 ms debounce
  assert.ok(written && typeof written.state === 'string', 'write happened');
  assert.equal(written.updatedAt, 'SERVER_TS');
  const shared = JSON.parse(written.state);
  assert.equal(shared.phase, undefined, 'view-local keys are not shared');
  assert.equal(shared.ds.cp, 0);

  // Firestore echoes the write back (latency-compensated, then server-acked): both carry our string.
  app._applyRoomSnapshot({ exists: true, metadata: { fromCache: false, hasPendingWrites: true }, data: () => ({ state: written.state }) });
  app._applyRoomSnapshot(snap(written.state));
  assert.equal(app.__calls.render, 0, 'echoes of our own write must not redraw');

  // Someone else picks: new string, applied.
  const other = JSON.parse(written.state);
  other.players[0].teamIds.push('South-1'); other.ds.cp = 1;
  app._applyRoomSnapshot(snap(other));
  assert.equal(app.__calls.render, 1);
  assert.equal(app.S.ds.cp, 1);
});

test('connecting to a room forgets the previous sync string so its first snapshot always applies', () => {
  const app = roomApp();
  app._applyRoomSnapshot(snap(remoteA));
  assert.equal(app.__calls.render, 1);
  let handler = null;
  app.db = { collection: () => ({ doc: () => ({ onSnapshot: (cb) => { handler = cb; return () => {}; } }) }) };
  app.connectToRoom('ROOM1');
  assert.equal(typeof handler, 'function');
  handler(snap(remoteA)); // same string as before the reconnect
  assert.equal(app.__calls.render, 2, 'first snapshot after (re)connect must render');
  handler(snap(remoteA));
  assert.equal(app.__calls.render, 2);
});
