const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp } = require('./_harness');

/*
 * The empty-day guard keeps the scores a phone already has. A phone that opens the Live tab while the source is
 * failing has none: the first document it gets is the empty one, and it showed "No games found" on a game day.
 * The first empty document for a day is now confirmed once through the relay.
 */
const ts = (ms) => ({ toMillis: () => ms });
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const RESET = 'liveScores = []; _liveScoresDay = null; liveLastError = false; _reportedFinals.clear(); _pendingAdvance.clear(); ' +
  '_emptyDaysConfirmed.clear(); _emptyDayUnconfirmed = null; _emptyDayCheckedAt = 0; _emptyDaysChecking.clear();';

const FAILING = () => ({ ok: true, json: async () => ({ games: [], upstreamStatus: 404 }) }); // the relay: "upstream answered 404"
const OFF_DAY = () => ({ ok: true, json: async () => ({ games: [] }) });                      // a plain 200 with no games
const ONE_GAME = () => ({ ok: true, json: async () => ({ games: [{ game: {
  gameID: '991', gameState: 'live', currentPeriod: '2nd', contestClock: '5:00', bracketId: '201',
  away: { names: { short: 'Away U', seo: 'away-u', char6: 'AWAY' }, score: '50', seed: '16' },
  home: { names: { short: 'Home U', seo: 'home-u', char6: 'HOME' }, score: '61', seed: '1' }
} }] }) });

function setup() {
  const app = createApp({ phase: 'live' });
  vm.runInThisContext(RESET);
  const t = { app, listener: null, fetches: [], relay: FAILING };
  app.db = { collection: () => ({ doc: (id) => ({ onSnapshot: (ok) => { t.listener = ok; t.docId = id; return () => {}; } }) }) };
  app.autoResolvePlayIns = () => {};
  app.catchUpYesterdaysFinals = () => {};
  app.requestWakeLock = () => {};
  app.releaseWakeLock = () => {};
  app.syncGames = () => {};
  app.fetch = async (url) => { t.fetches.push(String(url)); const r = t.relay(); if (r instanceof Error) throw r; return r; };
  const real = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval };
  globalThis.setTimeout = () => 1; globalThis.setInterval = () => 2; globalThis.clearTimeout = () => {}; globalThis.clearInterval = () => {};
  t.doc = (events) => t.listener({ exists: true, metadata: { fromCache: false }, data: () => ({ events, fetchedAt: ts(Date.now()) }) });
  t.game = { id: 'g1', state: 'in', completed: false, tournament: true, away: { name: 'A', ncaaId: 'a' }, home: { name: 'B', ncaaId: 'b' } };
  t.outageCard = () => app.eval('liveLastError && liveScores.length === 0'); // renderLive: the "Scores unavailable" card instead of "No games found"
  t.done = () => { app.stopLiveRefresh(); Object.assign(globalThis, real); vm.runInThisContext(RESET); };
  return t;
}

test('opening Live during an outage: the first document is empty, the relay says the upstream is failing → "Scores unavailable", not "No games found"', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.fetches.length, 1, 'confirmed once through the relay');
    assert.match(t.fetches[0], /scoreboard\/basketball-men\/d1\/2027\/03\/19$/);
    assert.equal(t.outageCard(), true);
  } finally { t.done(); }
});

test('the relay cannot be reached at all → also "Scores unavailable"', async () => {
  for (const relay of [() => new Error('Failed to fetch'), () => ({ ok: false, status: 502, json: async () => ({}) })]) {
    const t = setup();
    try {
      t.relay = relay;
      t.app.S.liveScoresDate = '20270319';
      t.app.startLiveRefresh();
      t.doc([]);
      await tick();
      assert.equal(t.outageCard(), true);
    } finally { t.done(); }
  }
});

test('a real off day: the relay confirms it once, "No games found" stays, and it is not asked again', async () => {
  const t = setup();
  try {
    t.relay = OFF_DAY;
    t.app.S.liveScoresDate = '20270323';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.fetches.length, 1);
    assert.equal(t.app.eval('liveLastError'), false);
    assert.equal(t.outageCard(), false);
    t.doc([]); t.doc([]);                 // the next minutes' documents
    await tick();
    t.app.stopLiveRefresh();
    t.app.startLiveRefresh();             // back to the tab later in the session
    t.doc([]);
    await tick();
    assert.equal(t.fetches.length, 1, 'one relay request per off day per session');
    assert.equal(t.app.eval('liveLastError'), false);
  } finally { t.done(); }
});

test('while the outage lasts, the next documents keep the notice and the relay is asked at most every two minutes', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.outageCard(), true);
    t.doc([]);                            // one minute later
    assert.equal(t.outageCard(), true, 'an accepted empty document does not clear the notice');
    await tick();
    assert.equal(t.fetches.length, 1, 'not asked again inside two minutes');
    vm.runInThisContext('_emptyDayCheckedAt = Date.now() - 121000');
    t.doc([]);
    await tick();
    assert.equal(t.fetches.length, 2, 'asked again after two minutes');
    assert.equal(t.outageCard(), true);
    // the relay recovers and says it really is an off day
    t.relay = OFF_DAY;
    vm.runInThisContext('_emptyDayCheckedAt = Date.now() - 121000');
    t.doc([]);
    await tick();
    assert.equal(t.fetches.length, 3);
    assert.equal(t.app.eval('liveLastError'), false);
    assert.equal(t.outageCard(), false);
  } finally { t.done(); }
});

test('the first good document ends it: scores shown, notice gone', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.outageCard(), true);
    t.doc([t.game]);
    assert.equal(t.app.eval('liveScores.length'), 1);
    assert.equal(t.app.eval('liveLastError'), false);
    assert.equal(t.app.eval('_emptyDayUnconfirmed'), null);
  } finally { t.done(); }
});

test('the document is empty but the relay has the games: they are shown, and later empty documents keep them', async () => {
  const t = setup();
  try {
    t.relay = ONE_GAME;
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 1);
    assert.equal(t.app.eval('liveScores[0].home.name'), 'Home U');
    assert.equal(t.app.eval('liveLastError'), false);
    t.doc([]);                            // the function is still being told "nothing"
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 1, 'the empty-day guard keeps them');
    assert.equal(t.app.eval('liveLastError'), true);
    assert.equal(t.fetches.length, 1, 'and the phone stays on the cache');
  } finally { t.done(); }
});

test('a good document that lands while the relay request is out wins', async () => {
  const t = setup();
  try {
    let release;
    t.relay = () => new Promise(r => { release = () => r(FAILING()); });
    t.app.fetch = async (url) => { t.fetches.push(String(url)); return t.relay(); };
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    t.doc([t.game]);
    release();
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 1);
    assert.equal(t.app.eval('liveLastError'), false, 'the late "failing" answer does not mark a good screen');
  } finally { t.done(); }
});

test('moving to another day while the request is out: the answer is not applied to the new day, an off day is still remembered', async () => {
  const t = setup();
  try {
    let release;
    t.app.fetch = async (url) => { t.fetches.push(String(url)); return new Promise(r => { release = r; }); };
    t.app.S.liveScoresDate = '20270323';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.fetches.length, 1);
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([t.game]);
    release(OFF_DAY());
    await tick();
    assert.equal(t.app.eval('liveScores.length'), 1, 'the 19th keeps its game');
    assert.equal(t.app.eval('liveLastError'), false);
    assert.equal(t.app.eval('_emptyDaysConfirmed.has("20270323")'), true);

    // same, with a failing answer for the day that was left: nothing sticks to the new day
    vm.runInThisContext('_emptyDaysConfirmed.clear()');
    t.app.S.liveScoresDate = '20270324';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    const late = release;
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([t.game]);
    late(FAILING());
    await tick();
    assert.equal(t.app.eval('liveLastError'), false);
    assert.equal(t.app.eval('_emptyDayUnconfirmed'), null);
  } finally { t.done(); }
});

test('a request still out for one day does not swallow the first empty document of another day', async () => {
  const t = setup();
  try {
    const waiting = [];
    t.app.fetch = async (url) => { t.fetches.push(String(url)); return new Promise(r => { waiting.push(r); }); };
    t.app.S.liveScoresDate = '20270323';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    t.app.S.liveScoresDate = '20270319';
    t.app.startLiveRefresh();
    t.doc([]);
    await tick();
    assert.equal(t.fetches.length, 2);
    assert.match(t.fetches[1], /2027\/03\/19$/);
    waiting[0](OFF_DAY());
    waiting[1](FAILING());
    await tick();
    assert.equal(t.outageCard(), true, 'the 19th: unavailable');
    assert.equal(t.app.eval('_emptyDaysConfirmed.has("20270323")'), true, 'the 23rd: a known off day');
  } finally { t.done(); }
});
