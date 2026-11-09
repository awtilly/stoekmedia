const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/*
 * A failing upstream must not blank the Live tab. ncaa-api answers 404 when its own fetch of the NCAA feed fails
 * (for the current season a day without games is a plain 200 with an empty list), the pollScoreboard function
 * writes a 404 as an empty day, and the relay turns it into 200 { games: [], upstreamStatus: 404 }. Before this
 * guard one bad minute replaced every phone's scores with "No games found".
 */
const ts = (ms) => ({ toMillis: () => ms });
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

function setup() {
  const app = createApp({ phase: 'live' });
  vm.runInThisContext('liveScores = []; _liveScoresDay = null; liveLastError = false; _reportedFinals.clear(); _pendingAdvance.clear();');
  const T = id => app.S.teams.find(t => t.id === id);
  const game = finalGame(T('South-16'), T('South-1'), T('South-1'));
  game.state = 'in'; game.completed = false;
  const t = { app, game, listener: null, fetches: [] };
  app.db = { collection: () => ({ doc: (id) => ({ onSnapshot: (ok) => { t.listener = ok; t.docId = id; return () => {}; } }) }) };
  app.autoResolvePlayIns = () => {};
  app.requestWakeLock = () => {};
  app.releaseWakeLock = () => {};
  app.syncGames = () => {};
  t.relay = { ok: true, json: async () => ({ games: [], upstreamStatus: 404 }) };
  app.fetch = async (url) => { t.fetches.push(String(url)); return t.relay; };
  const real = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval };
  globalThis.setTimeout = () => 1; globalThis.setInterval = () => 2; globalThis.clearTimeout = () => {}; globalThis.clearInterval = () => {};
  t.doc = (events) => t.listener({ exists: true, metadata: { fromCache: false }, data: () => ({ events, fetchedAt: ts(Date.now()) }) });
  t.done = () => { app.stopLiveRefresh(); Object.assign(globalThis, real); vm.runInThisContext('liveScores = []; _liveScoresDay = null; liveLastError = false;'); };
  return t;
}

test('an empty doc for the day on screen does not wipe the games; the direct poll is asked instead', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([t.game]);
    assert.equal(t.app.eval('liveScores.length'), 1);
    assert.equal(t.fetches.length, 0, 'a good doc: no direct poll');
    t.doc([]);
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 1, 'the last scores stay on screen');
    assert.equal(t.fetches.length, 1, 'the relay is asked');
    assert.equal(t.app.eval('liveLastError'), true, 'and its "upstream said 404" answer is shown as unavailable, not as an empty day');
  } finally { t.done(); }
});

test('when the direct poll confirms the day really is empty, the empty day is shown', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([t.game]);
    t.relay = { ok: true, json: async () => ({ games: [] }) }; // a plain 200 with no games: upstream answered
    t.doc([]);
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 0);
    assert.equal(t.app.eval('liveLastError'), false);
    const before = t.fetches.length;
    t.doc([]); // the next minute's empty doc is now consistent with the screen: accepted, no poll
    await tick();
    assert.equal(t.fetches.length, before);
  } finally { t.done(); }
});

test('the next good doc is taken as usual and clears the notice', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([t.game]);
    t.doc([]);
    await tick();
    const g2 = JSON.parse(JSON.stringify(t.game)); g2.id = 'second';
    t.doc([t.game, g2]);
    assert.equal(t.app.eval('liveScores.length'), 2);
    assert.equal(t.app.eval('liveLastError'), false);
  } finally { t.done(); }
});

test('an empty doc for a different day is still accepted (day picker, overnight rollover)', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([t.game]);
    t.app.S.liveScoresDate = '20270323'; // an off day; liveScores still holds the 19th until the doc lands
    t.app.startLiveRefresh();
    assert.equal(t.docId, '20270323');
    t.doc([]);
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 0);
    assert.equal(t.fetches.length, 0);
  } finally { t.done(); }
});

test('an empty doc on first load is accepted', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270323';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 0);
    assert.equal(t.fetches.length, 0);
    assert.equal(t.app.eval('liveLastError'), false);
  } finally { t.done(); }
});

test('fetchScoreboard: an answer carrying upstreamStatus is a failure, a plain empty day is not', async () => {
  const app = createApp();
  app.fetch = async () => ({ ok: true, json: async () => ({ games: [], upstreamStatus: 403 }) });
  assert.equal(await app.ncaa.fetchScoreboard('20270319'), null);
  app.fetch = async () => ({ ok: true, json: async () => ({ games: [] }) });
  assert.deepEqual(await app.ncaa.fetchScoreboard('20270319'), { games: [] });
});

test('the direct poll failing keeps the scores it already had', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.relay = { ok: true, json: async () => ({ games: [] }) };
    vm.runInThisContext('liveScores = ' + JSON.stringify([t.game]) + '; _liveScoresDay = "20270319"');
    t.relay = { ok: true, json: async () => ({ games: [], upstreamStatus: 404 }) };
    await t.app.refreshLiveScores();
    assert.equal(t.app.eval('liveScores.length'), 1);
    assert.equal(t.app.eval('liveLastError'), true);
  } finally { t.done(); }
});
