const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/** App "in" room `code` whose Firestore room writes are recorded in `writes`. */
function roomApp(code) {
  const app = createApp();
  const writes = [];
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  // The debounced write runs in a transaction (sync-merge): record what tx.set() writes, keyed by room.
  app.db = {
    collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction: async (fn) => { await fn({ get: async () => ({ exists: false }), set: (ref, data) => { writes.push({ id: ref.id, state: JSON.parse(data.state) }); } }); }
  };
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null');
  app.roomId = code;
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  return { app, writes };
}

/** Let the transaction callback (one awaited tx.get) reach tx.set. */
const settle = () => new Promise(r => setImmediate(r));

test('a debounced write lands in the room the change was made in, 800 ms later', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, writes } = roomApp('AAAA');
    app._debouncedFirestoreWrite();
    mock.timers.tick(799); await settle();
    assert.equal(writes.length, 0, 'still inside the debounce window');
    mock.timers.tick(1); await settle();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, 'AAAA');
    assert.equal(writes[0].state.players[0].name, 'Ann');
    assert.equal('phase' in writes[0].state, false, 'view-local keys stay off the shared doc');
  } finally { mock.timers.reset(); }
});

test('a write scheduled in one room never fires into a room entered inside the window', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, writes } = roomApp('AAAA');
    app._debouncedFirestoreWrite();
    // goHome clears roomId, then the user taps a recent room: S now holds BBBB's cached copy.
    app.roomId = null;
    app.roomId = 'BBBB';
    app.S.players = [{ id: 'p9', name: 'Stale cache of BBBB', teamIds: [] }];
    mock.timers.tick(800); await settle();
    assert.equal(writes.length, 0, 'the old timer must not overwrite BBBB on the server');
  } finally { mock.timers.reset(); }
});

test('flushFirestoreWrite sends the pending edit to its own room immediately and disarms the timer', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, writes } = roomApp('AAAA');
    app._debouncedFirestoreWrite();
    app.flushFirestoreWrite(); await settle();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, 'AAAA');
    assert.equal(writes[0].state.players[0].name, 'Ann');
    app.roomId = 'BBBB';
    mock.timers.tick(800); await settle();
    assert.equal(writes.length, 1, 'nothing left to fire after the flush');
  } finally { mock.timers.reset(); }
});

test('flush is a no-op with nothing pending, and discards a write gated by a remote update', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, writes } = roomApp('AAAA');
    app.flushFirestoreWrite(); await settle();
    assert.equal(writes.length, 0);
    app._debouncedFirestoreWrite();
    vm.runInThisContext('_isRemoteUpdate = true');
    app.flushFirestoreWrite(); await settle();
    assert.equal(writes.length, 0, 'a snapshot is being applied: never echo it back');
    vm.runInThisContext('_isRemoteUpdate = false');
    mock.timers.tick(800); await settle();
    assert.equal(writes.length, 0, 'the flushed timer did not fire later');
  } finally { mock.timers.reset(); }
});

test('goHome flushes the pending write before it clears roomId', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  const m = src.match(/function goHome\(\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'goHome found');
  const body = m[1];
  const flushAt = body.indexOf('flushFirestoreWrite();');
  const clearAt = body.indexOf('roomId = null;');
  assert.ok(flushAt !== -1, 'goHome calls flushFirestoreWrite');
  assert.ok(clearAt !== -1, 'goHome clears roomId');
  assert.ok(flushAt < clearAt, 'flush must run while roomId still names the room being left');
});
