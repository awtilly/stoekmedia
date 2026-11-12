const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* The page reads S.players, S.teams, S.games, S.ds.order and the five bracket lists without checking them.
 * Every device writes the whole room, and a snapshot replaces these keys wholesale, so their SHAPE is checked
 * where the room arrives (sanitizeSharedState), like ids, seeds and names. One room document with a list
 * missing or of the wrong type used to stop every phone in that pool from drawing the room. */

const snapshot = state => ({ exists: true, metadata: { fromCache: false }, data: () => ({ state: JSON.stringify(state) }) });
function roomApp() {
  const app = createApp();
  app.roomId = 'POOL';
  app.unsubRoom = null; app._roomGeneration = 0; app._pickInFlight = false;
  return app;
}
// What every page does on each draw, in the logic layer: standings, the games list, the draft order.
function drawLogic(app) {
  app.syncGames();
  app.scores();
  return app.S.ds.order.length + app.S.players.length + app.S.teams.length;
}

test('lists that arrive as the wrong type become empty lists', () => {
  const app = createApp();
  const s = app.sanitizeSharedState({ players: 'nope', teams: { 0: { id: 't1' } }, games: 7, ds: { order: 'p1', cp: 2, started: true } });
  assert.deepEqual(s.players, []);
  assert.deepEqual(s.teams, []);
  assert.deepEqual(s.games, []);
  assert.deepEqual(s.ds, { order: [], cp: 2, started: true }, 'the rest of the draft state is kept');
});

test('a draft state that is not an object is replaced by a fresh one; entries of games that are not records are dropped', () => {
  const app = createApp();
  for (const bad of [null, 'x', 5, ['p1']]) {
    assert.deepEqual(app.sanitizeSharedState({ ds: bad }).ds, { order: [], cp: 0, started: false, complete: false });
  }
  assert.deepEqual(app.sanitizeSharedState({ ds: {} }).ds.order, []);
  const g = { id: 'South-0', round: 1, t1: 'a', t2: 'b', wid: 'a' };
  assert.deepEqual(app.sanitizeSharedState({ games: [g, null, 'x', [g]] }).games, [g]);
});

test('a bracket always has four regions and the Final Four as lists; good lists are kept as they are', () => {
  const app = createApp();
  for (const bad of [null, 'nope', 3, []]) {
    const b = app.sanitizeSharedState({ bracket: bad }).bracket;
    assert.deepEqual(Object.keys(b), ['South', 'East', 'Midwest', 'West', 'ff']);
    assert.deepEqual([b.South.length, b.East.length, b.Midwest.length, b.West.length, b.ff.length], [15, 15, 15, 15, 3]);
  }
  const south = Array(15).fill(null); south[0] = 'South-1';
  const b = app.sanitizeSharedState({ bracket: { South: south, East: 'x', West: null, ff: { 0: 'South-1' } } }).bracket;
  assert.deepEqual(b.South, south);
  assert.deepEqual([b.East.length, b.Midwest.length, b.West.length], [15, 15, 15]);
  assert.deepEqual(b.ff, [null, null, null]);
});

test('a room snapshot with broken containers still leaves a state the pages can draw', () => {
  for (const remote of [
    { players: null, teams: null, games: null, ds: null, bracket: null },
    { players: null, teams: 'x', games: {}, ds: [], bracket: [] },
    { ds: {}, bracket: { South: [] } },
    { bracket: { South: null, East: null, Midwest: null, West: null, ff: null } }
  ]) {
    const app = roomApp();
    app._applyRoomSnapshot(snapshot(remote));
    assert.doesNotThrow(() => drawLogic(app), JSON.stringify(remote));
    assert.equal(app.__calls.render, 1);
    // ...and tapping a winner into the repaired bracket works.
    assert.doesNotThrow(() => app.autoAdvanceBracket({ id: 'g' + Math.random(), away: {}, home: {} }), JSON.stringify(remote));
  }
});

test('an ordinary room is left exactly as it was', () => {
  const app = createApp();
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }];
  app.S.ds = { order: ['p1'], cp: 1, started: true, complete: false };
  app.S.bracket.South[0] = 'South-1';
  app.syncGames();
  const before = JSON.stringify(app.S);
  app.sanitizeSharedState(app.S);
  assert.equal(JSON.stringify(app.S), before);
});
