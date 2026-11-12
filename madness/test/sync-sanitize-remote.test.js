const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* The server's copy of the room is read in two places before it is shown: the snapshot handler (which players the
 * server knows, and the merge of an edit still waiting to be sent) and the write transaction's merge. Both now get
 * the copy through the same clean-up step as everything this device shows (sanitizeSharedState). Before, a room
 * whose roster held one damaged record could neither be shown nor written to by any phone in the pool. */

const DAMAGED = () => ({
  players: [null, { id: 'p1', name: 'Ann', teamIds: ['T1'] }, { id: 'p2', name: 'Bob', teamIds: [] }],
  teams: [{ id: 'T1', name: 'Duke', seed: 1 }],
  ds: { order: ['p1', 'p2'], cp: 1, started: true, complete: false, epoch: 1 }
});
const settle = () => new Promise(r => setImmediate(r));

test('a snapshot whose roster holds a damaged record is still applied', () => {
  const app = createApp();
  app.roomId = 'POOL';
  app.unsubRoom = null; app._roomGeneration = 0; app._pickInFlight = false;
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _sharedAtSync = null');
  app._applyRoomSnapshot({ exists: true, metadata: { fromCache: false }, data: () => ({ state: JSON.stringify(DAMAGED()) }) });
  assert.deepEqual(app.S.players.map(p => p.id), ['p1', 'p2']);
  assert.equal(app.S.ds.cp, 1);
  assert.equal(app.__calls.render, 1);
  assert.deepEqual(vm.runInThisContext('_lastSnapshotPlayerIds'), ['p1', 'p2']);
});

test('an edit can still be written to such a room, and the write leaves the damaged record out', async () => {
  const app = createApp();
  const writes = [];
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.db = {
    collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction: async (fn) => {
      await fn({
        get: async () => ({ exists: true, data: () => ({ state: JSON.stringify(DAMAGED()) }) }),
        set: (ref, data) => { writes.push(JSON.parse(data.state)); }
      });
    }
  };
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _sharedAtSync = null');
  app.roomId = 'POOL';
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }, { id: 'p2', name: 'Bob', teamIds: [] }];
  app.S.ds = { order: ['p1', 'p2'], cp: 0, started: true, complete: false, epoch: 1 }; // behind the server: its draft state wins
  app.S.ub = false; // the edit
  app._writeSharedState();
  await settle();
  assert.equal(writes.length, 1, 'the write went through');
  assert.deepEqual(writes[0].players.map(p => p && p.id), ['p1', 'p2']);
  assert.deepEqual(writes[0].players[0].teamIds, ['T1'], "the server's pick is kept");
  assert.equal(writes[0].ub, false);
});
