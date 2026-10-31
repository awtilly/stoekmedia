const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* requireAdmin() on a room with no admin PIN used to read the doc, prompt, then set() the PIN. Two
 * commissioner devices doing that at once both saw "no PIN yet" and the second set() silently replaced
 * the first PIN. The write now runs in a transaction: if a PIN appeared since the read, this device is
 * told and asked for that PIN instead. */
function fakeDb(roomData, hooks = {}) {
  const writes = [];
  const state = { room: roomData };
  const docRef = {
    async get() { return { exists: state.room !== null, data: () => state.room }; },
    async set(data, opts) { writes.push({ via: 'set', data, opts }); state.room = Object.assign(state.room || {}, data); }
  };
  const db = {
    collection: () => ({ doc: () => docRef }),
    async runTransaction(fn) {
      if (hooks.beforeTx) hooks.beforeTx(state); // another device's write landing between our get() and the transaction
      if (hooks.failTx) throw new Error('unavailable');
      const tx = {
        async get(ref) { return { exists: state.room !== null, data: () => state.room }; },
        set(ref, data, opts) { writes.push({ via: 'tx', data, opts }); state.room = Object.assign(state.room || {}, data); }
      };
      await fn(tx);
    }
  };
  return { db, writes, state };
}

function adminApp(roomData, prompts, hooks) {
  const app = createApp();
  app.requireAdmin = app.__real.requireAdmin;
  app.roomId = 'ROOM1';
  const { db, writes, state } = fakeDb(roomData, hooks);
  app.db = db;
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } };
  const queue = prompts.slice();
  app.appPrompt = async () => queue.shift();
  return { app, writes, state };
}

test('no PIN yet: the PIN is written inside a transaction and the device unlocks', async () => {
  const { app, writes } = adminApp({ state: '{}' }, ['1234']);
  assert.equal(await app.requireAdmin(), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].via, 'tx');
  assert.match(writes[0].data.adminPin, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.deepEqual(writes[0].opts, { merge: true });
  assert.equal(app.eval('adminUnlocked'), true);
});

test('another device set a PIN first: ours is NOT written, we are told, and the existing PIN is asked for', async () => {
  let theirs;
  const { app, writes, state } = adminApp({ state: '{}' }, ['1234', '5678'], {
    beforeTx: async () => {} // placeholder, replaced below once hashPin is reachable
  });
  theirs = await app.hashPin('5678');
  app.db.runTransaction = (function (orig) {
    return function (fn) { state.room.adminPin = theirs; return orig.call(this, fn); };
  })(app.db.runTransaction);
  assert.equal(await app.requireAdmin(), true, 'second prompt answered with the other device\'s PIN');
  assert.equal(writes.length, 0, 'our PIN must not replace theirs');
  assert.equal(state.room.adminPin, theirs);
  assert.equal(app.__calls.alerts.length, 1);
  assert.match(app.__calls.alerts[0], /Someone else just set/);
  assert.equal(app.eval('adminUnlocked'), true);
});

test('another device set a PIN first and ours is wrong: locked, one failure counted', async () => {
  const { app, writes, state } = adminApp({ state: '{}' }, ['1234', '0000']);
  const theirs = await app.hashPin('5678');
  const orig = app.db.runTransaction;
  app.db.runTransaction = function (fn) { state.room.adminPin = theirs; return orig.call(this, fn); };
  assert.equal(await app.requireAdmin(), false);
  assert.equal(writes.length, 0);
  assert.equal(app.eval('adminUnlocked'), false);
  assert.equal(app.eval('_pinFailCount'), 1);
});

test('transaction failure (offline): toast, locked, nothing written', async () => {
  const { app, writes } = adminApp({ state: '{}' }, ['1234'], { failTx: true });
  assert.equal(await app.requireAdmin(), false);
  assert.equal(writes.length, 0);
  assert.equal(app.eval('adminUnlocked'), false);
  assert.equal(app.__calls.toasts.length, 1);
  assert.match(app.__calls.toasts[0], /save the PIN/);
});

test('invalid PIN entry still rejected before any write', async () => {
  const { app, writes } = adminApp({ state: '{}' }, ['12']);
  assert.equal(await app.requireAdmin(), false);
  assert.equal(writes.length, 0);
  assert.match(app.__calls.alerts[0], /exactly 4 digits/);
});
