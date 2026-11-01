const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function snap(state) {
  return { exists: true, metadata: { fromCache: false, hasPendingWrites: false }, data: () => ({ state: JSON.stringify(state) }) };
}

/** Connected room app whose listener callback is captured in app.__handler. */
function connectedApp() {
  const app = createApp();
  app.localStorage = memStorage();
  app.firebase = { firestore: { Timestamp: function (s, n) { this.seconds = s; this.nanoseconds = n; } } };
  app.unsubRoom = null;
  app._roomGeneration = 0;
  app._pickInFlight = false;
  vm.runInThisContext('_lastSyncedState = null; _droppedDuringPick = null');
  const handlers = [];
  app.db = { collection: () => ({ doc: () => ({ onSnapshot: (cb) => { handlers.push(cb); return () => {}; } }) }) };
  app.roomId = 'ROOM1';
  app.connectToRoom('ROOM1');
  return { app, handler: (doc) => handlers[handlers.length - 1](doc), connect: (code) => { app.roomId = code; app.connectToRoom(code); } };
}

const stateA = { players: [{ id: 'p1', name: 'Ann', teamIds: [] }, { id: 'p2', name: 'Bob', teamIds: [] }], ds: { order: ['p1', 'p2'], cp: 0, started: true, complete: false } };
const stateB = { players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }, { id: 'p2', name: 'Bob', teamIds: [] }], ds: { order: ['p1', 'p2'], cp: 1, started: true, complete: false } };
const stateC = { players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }, { id: 'p2', name: 'Bob', teamIds: ['East-1'] }], ds: { order: ['p1', 'p2'], cp: 2, started: true, complete: true } };

test('snapshots during a pick are held, and the newest one is applied once the pick settles', () => {
  const { app, handler } = connectedApp();
  handler(snap(stateA));
  assert.equal(app.__calls.render, 1);
  app._pickInFlight = true;
  handler(snap(stateB));
  handler(snap(stateC));
  assert.equal(app.__calls.render, 1, 'nothing applied while the transaction is in flight');
  assert.equal(app.S.ds.cp, 0);
  app._pickInFlight = false;
  app.replayDroppedSnapshot();
  assert.equal(app.__calls.render, 2, 'exactly one replay, of the newest snapshot');
  assert.equal(app.S.ds.cp, 2);
  assert.equal(app.S.ds.complete, true);
  app.replayDroppedSnapshot();
  assert.equal(app.__calls.render, 2, 'replay is one-shot');
});

test('replay is a no-op when nothing was dropped or the room changed mid-pick', () => {
  const { app, handler, connect } = connectedApp();
  handler(snap(stateA));
  app.replayDroppedSnapshot();
  assert.equal(app.__calls.render, 1, 'nothing dropped, nothing replayed');
  app._pickInFlight = true;
  handler(snap(stateB));
  connect('ROOM2'); // user left for another room while the pick was settling
  app._pickInFlight = false;
  app.replayDroppedSnapshot();
  assert.equal(app.__calls.render, 1, 'a snapshot from the previous room is never applied');
  assert.equal(app.S.ds.cp, 0);
});

test('a replayed snapshot that the listener already delivered after the pick is skipped by the dedupe guard', () => {
  const { app, handler } = connectedApp();
  handler(snap(stateA));
  app._pickInFlight = true;
  handler(snap(stateB));
  app._pickInFlight = false;
  handler(snap(stateB)); // the commit's own update arrives normally after the promise resolved
  assert.equal(app.__calls.render, 2);
  app.replayDroppedSnapshot();
  assert.equal(app.__calls.render, 2, 'same string, no second render');
});

test('pickTeam releases the in-flight flag and replays in its finally block', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  assert.match(src, /finally\s*\{\s*_pickInFlight = false;\s*replayDroppedSnapshot\(\);\s*\}/);
});
