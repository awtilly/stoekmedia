const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/**
 * App in room `code` whose debounced write runs against a fake transaction. `remoteState` is what
 * tx.get() returns as the server copy (null = document missing); tx.set() records the write.
 */
function txApp(code, remoteState) {
  const app = createApp();
  const writes = [];
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.db = {
    collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction: async (fn) => {
      await fn({
        get: async () => remoteState ? { exists: true, data: () => ({ state: JSON.stringify(remoteState) }) } : { exists: false },
        set: (ref, data) => { writes.push({ id: ref.id, raw: data.state, state: JSON.parse(data.state) }); }
      });
    }
  };
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null');
  app.roomId = code;
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }, { id: 'p2', name: 'Bob', teamIds: [] }];
  app.S.ds = { order: ['p1', 'p2'], cp: 0, started: true, complete: false, epoch: 1 };
  return { app, writes };
}
const settle = () => new Promise(r => setImmediate(r));
const lastSynced = () => vm.runInThisContext('_lastSyncedState');

test('when the server is not ahead, the written string becomes the dedupe key so the echo is skipped', async () => {
  const { app, writes } = txApp('AAAA', null);
  app._writeSharedState();
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].state.ds.cp, 0);
  assert.equal(lastSynced(), writes[0].raw);
});

test('when the server has a newer pick, the merged state is written and the echo is left to be applied', async () => {
  const remote = {
    players: [{ id: 'p1', name: 'Ann', teamIds: ['T1'] }, { id: 'p2', name: 'Bob', teamIds: [] }],
    ds: { order: ['p1', 'p2'], cp: 1, started: true, complete: false, epoch: 1 }
  };
  const { app, writes } = txApp('AAAA', remote);
  app.S.ub = false; // the local edit that triggered the write
  app._writeSharedState();
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].state.ds.cp, 1, 'server draft progress kept');
  assert.deepEqual(writes[0].state.players[0].teamIds, ['T1'], 'server roster kept');
  assert.equal(writes[0].state.ub, false, 'local edit layered on top');
  assert.equal(lastSynced(), null, 'this device still holds cp 0: the echo must be applied, not skipped');
});

/* Offline paths. `fail` makes the fake transaction reject with that error; ref.set() records plain writes. */
function offlineApp(code, { onLine, fail }) {
  const { app } = txApp(code, null);
  const plain = []; let txCalls = 0;
  app.db = {
    collection: () => ({ doc: (id) => ({ id, set: (data) => { plain.push({ id, raw: data.state, state: JSON.parse(data.state) }); return Promise.resolve(); } }) }),
    runTransaction: async () => { txCalls++; throw fail; }
  };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  return { app, plain, txCalls: () => txCalls };
}

test('known offline: no transaction is attempted and the plain write is queued in the same tick', () => {
  const { app, plain, txCalls } = offlineApp('AAAA', { onLine: false });
  app.S.ub = false;
  app._writeSharedState();
  assert.equal(txCalls(), 0, 'no transaction while offline');
  assert.equal(plain.length, 1, 'queued synchronously, before anything is awaited');
  assert.equal(plain[0].state.ub, false);
  assert.equal(lastSynced(), plain[0].raw);
});

test('a transaction that fails as unavailable falls back to a plain write of what the device holds by then', async () => {
  const { app, plain, txCalls } = offlineApp('AAAA', { onLine: true, fail: { code: 'unavailable' } });
  app.S.ub = false;
  app._writeSharedState();
  app.S.year = 2031; // a newer edit made while the transaction was still retrying
  await settle();
  assert.equal(txCalls(), 1);
  assert.equal(plain.length, 1);
  assert.equal(plain[0].state.ub, false);
  assert.equal(plain[0].state.year, 2031, 'an older fallback can never overwrite a newer edit: it sends the current state');
  assert.equal(lastSynced(), plain[0].raw);
});

test('the fallback for a room that has been left writes the captured state to that room and leaves the dedupe key alone', async () => {
  const { app, plain } = offlineApp('AAAA', { onLine: true, fail: { code: 'unavailable' } });
  app.S.ub = false;
  app._writeSharedState();
  app.roomId = 'BBBB'; app.S.ub = true; // went home and into another room before the transaction gave up
  await settle();
  assert.equal(plain.length, 1);
  assert.equal(plain[0].id, 'AAAA');
  assert.equal(plain[0].state.ub, false, 'room A gets the edit made in room A');
  assert.equal(lastSynced(), null, 'room B dedupe key untouched');
});

test('any other transaction error is reported, not papered over with a blind write', async () => {
  const { app, plain } = offlineApp('AAAA', { onLine: true, fail: { code: 'permission-denied' } });
  app._writeSharedState();
  await settle();
  assert.equal(plain.length, 0);
  assert.equal(app.__calls.toasts.length, 1);
});
