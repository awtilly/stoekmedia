const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* 20-live.js remembers which finals it has reported and advanced. The page is not reloaded between rooms (Home,
 * then another pool), and those lists were kept for the whole session: somebody in two pools who watched a game
 * end in the first one had that game skipped in the second: no bracket advance and no report from that phone
 * until the app was restarted. The lists now start empty for every room. */

const results = {}; // room -> [game ids reported there]
let hold = null;    // when set, the next report waits for this promise

function enter(room) {
  const app = createApp({ phase: 'live' });
  app.roomId = room;
  app.db = { collection: () => ({ doc: (r) => ({
    get: async () => ({ exists: false, data: () => null }),
    collection: () => ({ doc: (id) => ({
      get: async () => ({ exists: (results[r] || []).includes(id) }),
      set: async () => { if (hold) await hold; (results[r] = results[r] || []).push(id); }
    }) })
  }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  return app;
}
const T = (app, id) => app.S.teams.find(t => t.id === id);
function game(app, id, loser, winner) {
  const g = finalGame(T(app, loser), T(app, winner), T(app, winner));
  g.id = id;
  return g;
}
async function feed(app, games) {
  globalThis.__games = games;
  vm.runInThisContext('liveScores = globalThis.__games');
  await app.checkGameFinals();
}

test('a final already handled in one pool is reported and advanced in the next pool too', async () => {
  let app = enter('poolA');
  await feed(app, [game(app, 'g1', 'South-16', 'South-1')]);
  assert.deepEqual(results.poolA, ['g1']);
  assert.equal(app.S.bracket.South[0], 'South-1');

  app = enter('poolB'); // Home, then the other pool: same page, fresh state for that room
  assert.equal(app.S.bracket.South[0], null);
  await feed(app, [game(app, 'g1', 'South-16', 'South-1')]);
  assert.equal(app.S.bracket.South[0], 'South-1', 'the slot is filled in pool B');
  assert.deepEqual(results.poolB, ['g1'], 'and the result is reported there');
  assert.equal(app.__calls.saveState, 1, 'the first reporter saves the bracket');
});

test('in the same room a final is still handled once', async () => {
  const app = enter('poolC');
  const g = game(app, 'g2', 'East-16', 'East-1');
  await feed(app, [g]);
  await feed(app, [g]);
  await feed(app, [g]);
  assert.deepEqual(results.poolC, ['g2']);
  assert.equal(app.__calls.saveState, 1);
});

test('leaving for another pool and coming back does not report a final twice', async () => {
  let app = enter('poolD');
  await feed(app, [game(app, 'g3', 'West-16', 'West-1')]);
  app = enter('poolE');
  await feed(app, [game(app, 'g3', 'West-16', 'West-1')]);
  app = enter('poolD');
  await feed(app, [game(app, 'g3', 'West-16', 'West-1')]);
  assert.deepEqual(results.poolD, ['g3'], 'the room already has the result: not written again');
  assert.equal(app.S.bracket.West[0], 'West-1', 'this phone still fills its own copy of the slot');
  assert.equal(app.__calls.saveState, 0, 'not the first reporter: no bracket save');
});

test('a room left while a report is on its way: the final is not marked as handled for the next room', async () => {
  let release;
  hold = new Promise(r => { release = r; });
  let app = enter('poolF');
  const first = feed(app, [game(app, 'g4', 'Midwest-16', 'Midwest-1')]);
  await new Promise(r => setImmediate(r)); // the report is out
  app = enter('poolG');                    // Home, other pool
  hold = null;
  release();
  await first;
  assert.equal(app.__calls.saveState, 0, 'the run that belonged to pool F saves nothing into pool G');
  await feed(app, [game(app, 'g4', 'Midwest-16', 'Midwest-1')]);
  assert.deepEqual(results.poolG, ['g4'], 'pool G gets its own report');
  assert.equal(app.S.bracket.Midwest[0], 'Midwest-1');
});
