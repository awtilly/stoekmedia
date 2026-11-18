const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp, finalGame } = require('./_harness');

/*
 * A final nobody watched. The late game ends around 12:30 am ET with every phone in the room closed. In the morning
 * the Live tab opens on the new scoreboard day, and checkGameFinals only walks the day on screen, so the bracket slot
 * stayed empty until somebody tapped back a day. With no day picked, the Live tab now reads the day before once per
 * room and session and runs the same check over it, without the push (no gameResult is written hours late).
 */
const ts = (ms) => ({ toMillis: () => ms });
const tick = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise(r => setImmediate(r)); };

function setup(opts) {
  const o = Object.assign({ reported: false, docs: null, fromCache: false, snapshotArrived: true }, opts || {});
  const app = createApp({ phase: 'live' });
  vm.runInThisContext('_unsyncedAdvances.clear(); _pendingAdvance.clear(); _reportedFinals.clear(); _advancedFinals.clear();' +
    ' _catchUpDone = null; _catchUpBusy = false; liveScores = []; _checkFinalsChain = Promise.resolve();');
  vm.runInThisContext('_lastSyncedState = ' + (o.snapshotArrived ? '"{}"' : 'null'));
  const T = id => app.S.teams.find(t => t.id === id);
  const late = finalGame(T('South-16'), T('South-1'), T('South-1'));
  late.id = 'late-game-0030et';
  const docs = o.docs || {
    '20270320': { events: [], fetchedAt: ts(Date.now()) },                     // today: nothing yet
    '20270319': { events: [late], fetchedAt: ts(Date.now() - 4 * 3600000) },   // the night before
  };
  const t = { app, late, docs, reads: [], sets: [], relay: [], intervals: [] };
  app.roomId = 'room1';
  t.realDay = app.scoreboardDay;
  app.scoreboardDay = () => '20270320';
  app.db = { collection: (name) => ({ doc: (id) => ({
    onSnapshot: (ok) => { ok({ exists: !!docs[id], metadata: { fromCache: false }, data: () => docs[id] }); return () => {}; },
    get: async () => {
      t.reads.push(name + '/' + id);
      if (name === 'scoreboard') return { exists: !!docs[id], metadata: { fromCache: o.fromCache }, data: () => docs[id] };
      return { exists: true, data: () => ({ state: JSON.stringify({ bracket: app.S.bracket }) }) };
    },
    collection: () => ({ doc: (gid) => ({
      get: async () => ({ exists: o.reported }),
      set: async (v) => { t.sets.push(gid); }
    }) })
  }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  app.autoResolvePlayIns = () => {};
  app.requestWakeLock = () => {};
  app.releaseWakeLock = () => {};
  t.realFetch = app.ncaa.fetchScoreboard;
  app.ncaa.fetchScoreboard = async (day) => { t.relay.push(day); return null; };
  const realTimers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout };
  globalThis.setTimeout = () => 1;
  globalThis.setInterval = (fn) => { t.intervals.push(fn); return 2; };
  globalThis.clearInterval = () => {}; globalThis.clearTimeout = () => {};
  t.done = () => {
    app.stopLiveRefresh();
    Object.assign(globalThis, realTimers);
    app.scoreboardDay = t.realDay;
    app.ncaa.fetchScoreboard = t.realFetch;
    vm.runInThisContext('_lastSyncedState = null; _catchUpDone = null; _unsyncedAdvances.clear(); _pendingAdvance.clear(); _reportedFinals.clear(); _advancedFinals.clear(); liveScores = [];');
  };
  return t;
}

test('a final from the night before advances the bracket when Live opens on the new day, with no late push', async () => {
  const t = setup();
  try {
    t.app.startLiveRefresh();
    await tick();
    assert.ok(t.reads.includes('scoreboard/20270319'), 'the day before is read; reads: ' + t.reads.join(','));
    assert.equal(t.app.S.bracket.South[0], 'South-1', 'the winner is in the bracket');
    assert.equal(t.app.__calls.saveState, 1, 'nobody reported it, so this device saves the slot');
    assert.deepEqual(t.sets, [], 'no gameResult is written hours later (that document is what sends the push)');
    assert.deepEqual(t.relay, [], 'the cached doc was enough: no relay call');
  } finally { t.done(); }
});

test('a final somebody already reported is advanced locally and left to the reporter to save', async () => {
  const t = setup({ reported: true });
  try {
    t.app.startLiveRefresh();
    await tick();
    assert.equal(t.app.S.bracket.South[0], 'South-1');
    assert.equal(t.app.__calls.saveState, 0, 'not the first reporter: no room write now');
    assert.deepEqual(t.sets, []);
    assert.equal(t.app.eval('_unsyncedAdvances.has("late-game-0030et")'), true, 'kept for the 30 s check that the reporter\'s save landed');
  } finally { t.done(); }
});

test('the day before is read once per room and session, and the caught-up final is not reported on a later visit to that day', async () => {
  const t = setup();
  try {
    t.app.startLiveRefresh();
    await tick();
    t.app.startLiveRefresh();
    await tick();
    for (const fn of t.intervals) fn();
    await tick();
    assert.equal(t.reads.filter(r => r === 'scoreboard/20270319').length, 1);
    // Tapping back to that day runs the normal (reporting) check over the same game.
    vm.runInThisContext('liveScores = ' + JSON.stringify([t.late]));
    await t.app.checkGameFinals();
    assert.deepEqual(t.sets, [], 'still no gameResult from this device');
    assert.equal(t.app.__calls.saveState, 1);
  } finally { t.done(); }
});

test('another room gets its own catch-up', async () => {
  const t = setup();
  try {
    t.app.startLiveRefresh();
    await tick();
    t.app.roomId = 'room2';
    t.app.S.bracket.South[0] = null;
    vm.runInThisContext('_reportedFinals.clear(); _advancedFinals.clear();'); // connectToRoom-equivalent: a different room has its own finals
    t.app.startLiveRefresh();
    await tick();
    assert.equal(t.reads.filter(r => r === 'scoreboard/20270319').length, 2);
    assert.equal(t.app.S.bracket.South[0], 'South-1');
  } finally { t.done(); }
});

test('no catch-up while a day is picked, after the champion is crowned, or with no teams', async () => {
  const t = setup();
  try {
    t.app.S.liveScoresDate = '20270318';
    t.app.startLiveRefresh();
    await tick();
    t.app.S.liveScoresDate = '';
    t.app.S.bracket.ff[2] = 'South-1';
    t.app.startLiveRefresh();
    await tick();
    t.app.S.bracket.ff[2] = null;
    const teams = t.app.S.teams; t.app.S.teams = [];
    t.app.startLiveRefresh();
    await tick();
    t.app.S.teams = teams;
    assert.deepEqual(t.reads.filter(r => r === 'scoreboard/20270319'), []);
    assert.equal(t.app.S.bracket.South[0], null);
  } finally { t.done(); }
});

test('the catch-up waits for the room document, then runs on the 30 s tick', async () => {
  const t = setup({ snapshotArrived: false });
  try {
    t.app.startLiveRefresh();
    await tick();
    assert.deepEqual(t.reads.filter(r => r === 'scoreboard/20270319'), [], 'not before the room has arrived');
    assert.equal(t.app.__calls.saveState, 0);
    vm.runInThisContext('_lastSyncedState = "{}"');
    assert.equal(t.intervals.length, 1);
    t.intervals[0]();
    await tick();
    assert.equal(t.app.S.bracket.South[0], 'South-1');
  } finally { t.done(); }
});

test('no cached doc for the day before: the relay is asked once', async () => {
  const t = setup({ docs: { '20270320': { events: [], fetchedAt: ts(Date.now()) } } });
  try {
    const late = t.late;
    t.app.ncaa.fetchScoreboard = async (day) => { t.relay.push(day); return { games: 'raw' }; };
    const realParse = t.app.ncaa.parseScoreboard;
    t.app.ncaa.parseScoreboard = (data) => (data && data.games === 'raw' ? [late] : realParse.call(t.app.ncaa, data));
    try {
      t.app.startLiveRefresh();
      await tick();
      t.app.startLiveRefresh();
      await tick();
    } finally { t.app.ncaa.parseScoreboard = realParse; }
    assert.deepEqual(t.relay.filter(d => d === '20270319'), ['20270319']);
    assert.equal(t.app.S.bracket.South[0], 'South-1');
  } finally { t.done(); }
});

test('nothing readable (offline): nothing changes and the next tick tries again', async () => {
  const t = setup({ docs: {} });
  try {
    t.app.startLiveRefresh();
    await tick();
    const before = t.relay.filter(d => d === '20270319').length;
    assert.equal(before, 1);
    for (const fn of t.intervals) fn();
    await tick();
    assert.equal(t.relay.filter(d => d === '20270319').length, 2);
    assert.equal(t.app.S.bracket.South[0], null);
    assert.equal(t.app.__calls.saveState, 0);
  } finally { t.done(); }
});

test('a copy from the on-device cache is used but not trusted as final: the next tick reads again', async () => {
  const t = setup({ fromCache: true });
  try {
    t.app.startLiveRefresh();
    await tick();
    assert.equal(t.app.S.bracket.South[0], 'South-1');
    for (const fn of t.intervals) fn();
    await tick();
    assert.equal(t.reads.filter(r => r === 'scoreboard/20270319').length, 2);
    assert.equal(t.app.__calls.saveState, 1, 'the second pass finds nothing new');
  } finally { t.done(); }
});

test('leaving the Live tab before the read returns stops the catch-up; the next visit does it', async () => {
  const t = setup();
  try {
    t.app.startLiveRefresh();
    t.app.stopLiveRefresh();
    await tick();
    assert.equal(t.app.S.bracket.South[0], null, 'nothing is advanced off-tab');
    assert.equal(t.app.__calls.saveState, 0);
    t.app.startLiveRefresh();
    await tick();
    assert.equal(t.app.S.bracket.South[0], 'South-1');
  } finally { t.done(); }
});

test('dayBefore crosses month, leap-day and year boundaries', () => {
  const app = createApp();
  assert.equal(app.dayBefore('20270320'), '20270319');
  assert.equal(app.dayBefore('20270401'), '20270331');
  assert.equal(app.dayBefore('20270301'), '20270228');
  assert.equal(app.dayBefore('20280301'), '20280229');
  assert.equal(app.dayBefore('20270101'), '20261231');
});

test('the normal check is unchanged: a final on the shown day is still reported', async () => {
  const t = setup({ docs: {} });
  try {
    vm.runInThisContext('_catchUpDone = "room1|20270319"');
    vm.runInThisContext('liveScores = ' + JSON.stringify([t.late]));
    await t.app.checkGameFinals();
    assert.deepEqual(t.sets, ['late-game-0030et']);
    assert.equal(t.app.S.bracket.South[0], 'South-1');
    assert.equal(t.app.__calls.saveState, 1);
  } finally { t.done(); }
});
