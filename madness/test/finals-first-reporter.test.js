const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/* A final's bracket advance happens locally BEFORE the gameResult report, and only the first reporter saves the
 * bracket to Firestore. When the report threw (offline blip, permission hiccup) the advance stayed in localStorage
 * and the final stayed out of _reportedFinals, so the next poll retried the report. That retry could make this
 * device the first reporter, but the slot was already filled (autoAdvanceBracket returned false), so the save
 * never happened: the gameResult existed, no other device could ever be "first", and the room only caught up
 * through another device's 30 s unsynced-advance repair. The retry now saves when it turns out to be first. */
function liveApp() {
  const app = createApp({ phase: 'live' });
  vm.runInThisContext('_unsyncedAdvances.clear(); _pendingAdvance.clear()');
  const writes = [];
  const pendingGets = []; // resolvers for resultRef.get(): call with an Error to make Firestore fail
  app.roomId = 'room1';
  app.db = { collection: () => ({ doc: () => ({
    get: async () => ({ exists: true, data: () => ({ state: JSON.stringify({ bracket: app.S.bracket }) }) }),
    collection: () => ({ doc: (id) => ({
      get: () => new Promise((res, rej) => pendingGets.push((err) => err ? rej(err) : res({ exists: writes.some(w => w.id === id) }))),
      set: async (d) => { writes.push({ id, ...d }); } }) })
  }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  const T = id => app.S.teams.find(t => t.id === id);
  const setFeed = (games) => { globalThis.__games = games; vm.runInThisContext('liveScores = globalThis.__games'); };
  return { app, writes, pendingGets, T, setFeed };
}
const withId = (g, id) => { g.id = id; return g; };
const tick = () => new Promise(r => setImmediate(r));

test('checkGameFinals: a final advanced on a poll whose report threw is saved once the retry reports it first', async () => {
  const { app, writes, pendingGets, T, setFeed } = liveApp();
  setFeed([withId(finalGame(T('Midwest-16'), T('Midwest-1'), T('Midwest-1')), 'late-report')]);
  const quiet = console.warn; console.warn = () => {};
  try {
    const poll1 = app.checkGameFinals();
    await tick();
    assert.equal(pendingGets.length, 1);
    pendingGets.shift()(new Error('unavailable')); // the gameResults read fails
    await poll1;
    assert.equal(app.S.bracket.Midwest[0], 'Midwest-1', 'the slot was filled locally before the report');
    assert.equal(writes.length, 0, 'no gameResult written');
    assert.equal(app.__calls.saveState, 0, 'nothing saved to the room yet');

    const poll2 = app.checkGameFinals(); // the final is not in _reportedFinals, so the report is retried
    await tick();
    assert.equal(pendingGets.length, 1, 'the retry reads gameResults again');
    pendingGets.shift()(); // exists: false
    await poll2;
    assert.equal(writes.length, 1, 'the retry writes the gameResult: this device is the first reporter');
    assert.equal(app.S.bracket.Midwest[0], 'Midwest-1');
    assert.equal(app.__calls.saveState, 1, 'and the bracket is saved to the room');

    const poll3 = app.checkGameFinals(); // already reported: nothing more happens
    await tick();
    assert.equal(pendingGets.length, 0, 'no further read');
    await poll3;
    assert.equal(app.__calls.saveState, 1, 'no second save');
  } finally { console.warn = quiet; }
});

test('checkGameFinals: a non-first reporter whose slot was already filled still does not save', async () => {
  const { app, writes, pendingGets, T, setFeed } = liveApp();
  writes.push({ id: 'late-other' }); // another device reported this final first
  setFeed([withId(finalGame(T('West-16'), T('West-1'), T('West-1')), 'late-other')]);
  const poll1 = app.checkGameFinals();
  await tick();
  pendingGets.shift()();
  await poll1;
  assert.equal(app.S.bracket.West[0], 'West-1', 'advanced locally');
  assert.equal(app.__calls.saveState, 0, 'not the first reporter: no save (the 30 s unsynced-advance check owns it)');
  const poll2 = app.checkGameFinals();
  await tick();
  assert.equal(pendingGets.length, 0, 'already in _reportedFinals: no read');
  await poll2;
  assert.equal(app.__calls.saveState, 0);
});
