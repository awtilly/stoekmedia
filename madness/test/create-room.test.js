const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/**
 * Fake Firestore for createRoom: `taken` says whether the courtesy get() sees the doc;
 * `takenInTx` says whether the transaction's get() sees it (simulates a racing creator).
 */
function fakeDb({ taken = false, takenInTx = false } = {}) {
  const writes = [];
  const ref = { id: 'ref' };
  return {
    writes,
    db: {
      collection: () => ({ doc: () => ({ ...ref, get: async () => ({ exists: taken }) }) }),
      runTransaction: async fn => fn({
        get: async () => ({ exists: takenInTx }),
        set: (r, data) => { writes.push(data); }
      })
    }
  };
}

function creatorApp(dbOpts, roomName = 'My Room 1') {
  const app = createApp();
  const { db, writes } = fakeDb(dbOpts);
  app.db = db;
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
  app.document = { getElementById: id => (id === 'room-name' ? { value: roomName } : null), addEventListener() {}, querySelector() { return null; } };
  app.window = { location: 'https://stoekmedia.com/madness/', history: { replaceState() {} } };
  app.appPrompt = async () => '1234';
  const alerts = [];
  app.appAlert = async m => { alerts.push(m); };
  app.hashPin = async pin => 'salt:' + pin;
  let unlocked = 0, connected = [];
  app.unlockAdmin = () => { unlocked++; };
  app.connectToRoom = code => { connected.push(code); };
  app.roomId = null;
  return { app, writes, alerts, state: { get unlocked() { return unlocked; }, connected } };
}

test('createRoom writes the new room inside a transaction, unlocks admin and connects', async () => {
  const { app, writes, alerts, state } = creatorApp({});
  await app.createRoom();
  assert.deepEqual(alerts, []);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].adminPin, 'salt:1234');
  assert.equal(typeof writes[0].state, 'string');
  assert.equal(app.roomId, 'MYROOM1', 'code is upper-cased letters/digits only');
  assert.equal(state.unlocked, 1);
  assert.deepEqual(state.connected, ['MYROOM1']);
  assert.equal(app.__calls.render, 1);
});

test('createRoom refuses a code the courtesy check already sees', async () => {
  const { app, writes, alerts, state } = creatorApp({ taken: true });
  await app.createRoom();
  assert.equal(writes.length, 0);
  assert.match(alerts[0], /already taken/);
  assert.equal(app.roomId, null);
  assert.equal(state.unlocked, 0);
});

test('createRoom loses the race cleanly: no overwrite, roomId reverted, user told', async () => {
  const { app, writes, alerts, state } = creatorApp({ taken: false, takenInTx: true });
  await app.createRoom();
  assert.equal(writes.length, 0, 'the other creator\'s room and PIN survive');
  assert.match(alerts[0], /just taken/);
  assert.equal(app.roomId, null, 'not left pointing at someone else\'s room');
  assert.equal(state.unlocked, 0, 'no admin session for a room we do not own');
  assert.deepEqual(state.connected, []);
});

test('createRoom validates the name and PIN before touching Firestore', async () => {
  const bad = creatorApp({}, 'x');
  await bad.app.createRoom();
  assert.match(bad.alerts[0], /2-20/);
  assert.equal(bad.writes.length, 0);

  const noPin = creatorApp({});
  noPin.app.appPrompt = async () => '12';
  await noPin.app.createRoom();
  assert.match(noPin.alerts[0], /4 digits/);
  assert.equal(noPin.writes.length, 0);
});
