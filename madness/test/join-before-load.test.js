const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* A first visit on a slow or absent connection shows the join screen before the room's document has arrived.
 * S is then only the blank default. Joining at that moment saved a room with one player and no teams, and that
 * save replaced the real room for everybody (straight away, or when the phone came back online). */

/** A device that has just entered ROOM1; `deliver(doc)` plays the role of Firestore's listener. */
function enteringApp(state) {
  const app = createApp(state);
  app.roomId = 'ROOM1';
  app.unsubRoom = null;
  app._roomGeneration = 0;
  app._pickInFlight = false;
  let listener = null;
  app.firebase = { firestore: { Timestamp: function (s, n) { this.seconds = s; this.nanoseconds = n; }, FieldValue: { serverTimestamp: () => 'TS' } } };
  app.db = { collection: () => ({ doc: () => ({ onSnapshot: fn => { listener = fn; return () => {}; } }) }) };
  app.hashPin = async p => 'h:' + p;
  app.setMyPlayerId = () => {};
  app.connectToRoom('ROOM1');
  return { app, deliver: doc => listener(doc) };
}

function joinForm(app, fields) {
  const page = { innerHTML: '' };
  app.document = { getElementById: id => (id === 'app' ? page : id in fields ? { value: fields[id] } : null), addEventListener() {}, querySelector() { return null; } };
  return page;
}

function roomDoc(state) {
  return { exists: true, metadata: { fromCache: false }, data: () => ({ state: JSON.stringify(state) }) };
}

const realRoom = {
  players: [{ id: 'p1', name: 'Ann', pinHash: 'h:1111', teamIds: [] }, { id: 'p2', name: 'Bob', pinHash: 'h:2222', teamIds: [] }],
  ds: { order: [], cp: 0, started: false, complete: false }
};

test('joining before the room has loaded adds nobody and saves nothing', async () => {
  const { app } = enteringApp({ players: [] });
  joinForm(app, { 'join-name': 'Cat', 'join-pin': '1234' });
  await app.selfRegister();
  assert.equal(app.S.players.length, 0);
  assert.equal(app.__calls.saveState, 0);
  assert.deepEqual(app.__calls.toasts, ['Still loading the room. Check your connection and try again in a moment.']);
});

test('once the room has arrived the same tap joins it, next to the players already there', async () => {
  const { app, deliver } = enteringApp({ players: [] });
  joinForm(app, { 'join-name': 'Cat', 'join-pin': '1234' });
  await app.selfRegister();
  deliver(roomDoc(realRoom));
  const savesBefore = app.__calls.saveState;
  await app.selfRegister();
  assert.deepEqual(app.S.players.map(p => p.name), ['Ann', 'Bob', 'Cat']);
  assert.equal(app.__calls.saveState, savesBefore + 1);
});

test('an empty answer from the offline cache is not the room: still waiting', async () => {
  const { app, deliver } = enteringApp({ players: [] });
  deliver({ exists: false, metadata: { fromCache: true }, data: () => undefined });
  joinForm(app, { 'join-name': 'Cat', 'join-pin': '1234' });
  await app.selfRegister();
  assert.equal(app.S.players.length, 0);
  assert.equal(app.__calls.saveState, 0);
});

test('entering another room waits again for that room', async () => {
  const { app, deliver } = enteringApp({ players: [] });
  deliver(roomDoc(realRoom));
  app.roomId = 'ROOM2';
  app.connectToRoom('ROOM2');
  joinForm(app, { 'join-name': 'Cat', 'join-pin': '1234' });
  await app.selfRegister();
  assert.equal(app.S.players.some(p => p.name === 'Cat'), false);
});

test('offline play (no room) and a room that is already loaded are not held up', async () => {
  const app = createApp({ players: [] });
  app.hashPin = async p => 'h:' + p;
  app.setMyPlayerId = () => {};
  require('node:vm').runInThisContext('_awaitingRoom = false'); // module-level flag in 50-auth.js outlives createApp()
  app.roomId = 'ROOM1'; // as after a room has loaded: nothing is being waited for
  joinForm(app, { 'join-name': 'Cat', 'join-pin': '1234' });
  await app.selfRegister();
  assert.equal(app.S.players.length, 1);
});

test('the join screen says the room is loading instead of "0 players"', () => {
  const { app, deliver } = enteringApp({ players: [] });
  const page = joinForm(app, {});
  app.renderJoinScreen();
  assert.match(page.innerHTML, /Loading the room/);
  assert.doesNotMatch(page.innerHTML, /0 players/);
  assert.doesNotMatch(page.innerHTML, /id="join-name"/, 'no form to fill in before the room is here');
  deliver(roomDoc(realRoom));
  app.renderJoinScreen();
  assert.match(page.innerHTML, /2 players/);
  assert.match(page.innerHTML, /id="join-name"/);
  assert.doesNotMatch(page.innerHTML, /Loading the room/);
});
