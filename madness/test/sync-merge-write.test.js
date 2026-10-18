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
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null');
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
