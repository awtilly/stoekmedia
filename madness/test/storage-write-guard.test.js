const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A localStorage that is full: every setItem throws, the way browsers do at the quota (QuotaExceededError).
 * Reads still work, as they do in a real browser. */
function fullStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; },
    removeItem: k => m.delete(k)
  };
}

function roomApp() {
  const app = createApp();
  app.localStorage = fullStorage();
  app.roomId = 'ROOM1';
  app.unsubRoom = null;
  app._roomGeneration = 0;
  app._pickInFlight = false;
  vm.runInThisContext('_lastSyncedState = null; _syncBase = null; _sharedAtSync = null; _syncedShared = null; _firestoreWriteTimer = null');
  app.firebase = {
    firestore: {
      Timestamp: function (s, n) { this.seconds = s; this.nanoseconds = n; },
      FieldValue: { serverTimestamp: () => 'SERVER_TS' }
    }
  };
  app.db = { collection() { throw new Error('this test did not expect a Firestore write'); } };
  return app;
}

const snap = state => ({ exists: true, metadata: { fromCache: false, hasPendingWrites: false }, data: () => ({ state: JSON.stringify(state) }) });
const remote = { players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }], ds: { order: ['p1'], cp: 1, started: true, complete: false } };

test('a room snapshot is applied and drawn even when the offline copy cannot be written (storage full)', () => {
  const app = roomApp();
  assert.doesNotThrow(() => app._applyRoomSnapshot(snap(remote)));
  assert.equal(app.__calls.render, 1, 'the screen must still update');
  assert.equal(app.S.ds.cp, 1);
  assert.deepEqual(app.S.players[0].teamIds, ['South-1']);
  assert.equal(app.eval('_isRemoteUpdate'), false, 'the remote-update gate must be released');
  // The next save still goes to Firestore: the gate was released and the baseline recorded.
  assert.equal(app.eval('_sharedAtSync') !== null, true);
});

test('a correct admin PIN unlocks the session even when the 4 h marker cannot be stored', () => {
  const app = roomApp();
  assert.doesNotThrow(() => app.unlockAdmin());
  assert.equal(app.eval('adminUnlocked'), true);
});

test('claiming a seat survives a full storage: this session still knows who it is', () => {
  const app = roomApp();
  assert.doesNotThrow(() => app.setMyPlayerId('p1'));
  assert.equal(app.getMyPlayerId(), 'p1');
  app.roomId = 'ROOM2';
  assert.equal(app.getMyPlayerId(), null, 'the fallback is per room');
});
