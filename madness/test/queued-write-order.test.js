const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A save made with no connection is queued by Firestore and sent when the connection is back. A transaction
 * does not go through that queue. So a save made just after reconnecting could reach the server BEFORE the
 * queued one, and the queued one (an older copy of the whole room) then landed on top of it: the newer edit was
 * gone from the server, and from this phone as soon as the snapshot came back.
 *
 * The fake server here keeps set() calls in `srv.queue` until `flush()` (Firestore sending its queue, in order);
 * a transaction commits at once. Both deliver the committed state back as a snapshot. */
function room() {
  const app = createApp();
  const srv = { state: null, queue: [], txCommits: 0, failSet: null };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  const snapshot = state => app._applyRoomSnapshot({ exists: true, data: () => ({ state }), metadata: {} });
  app.db = {
    collection: () => ({ doc: id => ({ id, set: data => new Promise((resolve, reject) => { srv.queue.push({ id, state: data.state, resolve, reject }); }) }) }),
    runTransaction: async fn => {
      const readState = srv.state;
      let next = null;
      await fn({ get: async () => ({ exists: true, data: () => ({ state: readState }) }), set: (ref, data) => { next = data.state; } });
      srv.state = next;
      srv.txCommits++;
      snapshot(srv.state);
    }
  };
  srv.flush = async () => {
    while (srv.queue.length) {
      const w = srv.queue.shift();
      if (srv.failSet) { const e = srv.failSet; srv.failSet = null; w.reject(e); }
      else {
        srv.state = w.state;
        // The listener shows the server's copy with the writes still queued laid on top, so it never shows an
        // older queued write on its own.
        const later = srv.queue.filter(q => q.id === w.id).pop();
        if (app.roomId === w.id) snapshot(later ? later.state : srv.state);
        w.resolve();
      }
      await settle();
    }
  };
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _sharedAtSync = null; if (typeof _queuedPlainWrites !== "undefined") _queuedPlainWrites = {};');
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  app.S.ds = { order: ['p1'], cp: 0, started: true, complete: false, epoch: 1 };
  app.S.rp = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 };
  app.S.ub = true;
  srv.state = JSON.stringify(sharedOf(app));
  snapshot(srv.state); // this device is in sync with the server
  return { app, srv };
}
function sharedOf(app) {
  const out = {};
  for (const k in app.S) if (!app.eval('VIEW_LOCAL').includes(k)) out[k] = app.S[k];
  return out;
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const online = v => Object.defineProperty(globalThis, 'navigator', { value: { onLine: v }, configurable: true, writable: true });

test('a save made right after reconnecting is not overwritten by the older save still waiting in the offline queue', async () => {
  const { app, srv } = room();
  online(false);
  app.S.ub = false;            // edit A, made with no connection
  app._writeSharedState();
  assert.equal(srv.queue.length, 1, 'edit A is queued');
  online(true);                // connection is back; Firestore has not sent its queue yet
  app.S.rp[3] = 9;             // edit B
  app._writeSharedState();
  await settle();
  await srv.flush();           // Firestore sends what it had queued
  const server = JSON.parse(srv.state);
  assert.equal(server.ub, false, 'edit A is on the server');
  assert.equal(server.rp[3], 9, 'edit B is still on the server');
  assert.equal(app.S.rp[3], 9, 'and still on this phone');
  assert.equal(app.S.ub, false);
});

test('while a queued save is waiting, later saves join the queue behind it instead of racing it', async () => {
  const { app, srv } = room();
  online(false);
  app.S.ub = false;
  app._writeSharedState();
  online(true);
  app.S.rp[3] = 9;
  app._writeSharedState();
  await settle();
  assert.equal(srv.txCommits, 0, 'no transaction while a queued save is outstanding');
  assert.equal(srv.queue.length, 2, 'the second save is queued behind the first');
  assert.equal(JSON.parse(srv.queue[1].state).rp[3], 9);
  assert.equal(JSON.parse(srv.queue[1].state).ub, false, 'and it carries the first edit too');
});

test('once the queue has drained, saves go back to the transaction (another phone\'s edit is kept again)', async () => {
  const { app, srv } = room();
  online(false);
  app.S.ub = false;
  app._writeSharedState();
  online(true);
  await srv.flush();
  assert.equal(JSON.parse(srv.state).ub, false);
  // another phone changes a key; its snapshot has not reached this phone yet
  const r = JSON.parse(srv.state); r.year = 2031; srv.state = JSON.stringify(r);
  app.S.rp[3] = 9;
  app._writeSharedState();
  await settle();
  assert.equal(srv.txCommits, 1, 'a transaction again');
  assert.equal(srv.queue.length, 0);
  const server = JSON.parse(srv.state);
  assert.equal(server.year, 2031, 'the other phone\'s edit survived');
  assert.equal(server.rp[3], 9);
});

test('a queued save that is refused does not leave the phone stuck on queued saves', async () => {
  const { app, srv } = room();
  online(false);
  app.S.ub = false;
  app._writeSharedState();
  online(true);
  srv.failSet = { code: 'permission-denied' };
  await srv.flush();
  app.S.rp[3] = 9;
  app._writeSharedState();
  await settle();
  assert.equal(srv.txCommits, 1, 'the next save uses the transaction');
  assert.equal(JSON.parse(srv.state).rp[3], 9);
});

test('a queued save for a room that has been left does not hold back saves in the next room', async () => {
  const { app, srv } = room();
  online(false);
  app.S.ub = false;
  app._writeSharedState();     // queued for AAAA
  online(true);
  // leave AAAA and enter BBBB (same shared state on the fake server, for simplicity)
  app.roomId = 'BBBB';
  vm.runInThisContext('_lastSyncedState = null; _syncBase = null; _sharedAtSync = null;');
  app._applyRoomSnapshot({ exists: true, data: () => ({ state: srv.state }), metadata: {} });
  app.S.rp[3] = 9;
  app._writeSharedState();
  await settle();
  assert.equal(srv.txCommits, 1, 'room BBBB saves through the transaction');
  assert.equal(srv.queue.length, 1, 'only the AAAA save is still queued');
  assert.equal(srv.queue[0].id, 'AAAA');
  online(true);
});
