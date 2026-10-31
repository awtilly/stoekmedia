const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/*
 * Two loose ends in the cached-scoreboard Live tab (js/20-live.js):
 *  - startLiveRefresh() armed a 1.5 s "cached doc did not arrive, poll ESPN" timer that stopLiveRefresh() never
 *    cleared, so leaving Live quickly still fired one stray ESPN request (and ran checkGameFinals) off-tab.
 *  - the scoreboard listener stayed on the date it was subscribed with. When "Today" rolled over while the tab
 *    stayed open, the Cloud Function stopped writing that doc and the device fell to direct ESPN polling for the
 *    rest of the day. refreshLiveScores() now moves the listener to the new day's doc.
 */
const ts = (ms) => ({ toMillis: () => ms });

function fakeTimers() {
  const t = { timeouts: [], cleared: [], intervals: [] };
  const real = { setTimeout, clearTimeout, setInterval, clearInterval };
  globalThis.setTimeout = (fn, ms) => { t.timeouts.push({ fn, ms }); return 100 + t.timeouts.length; };
  globalThis.clearTimeout = (id) => { t.cleared.push(id); };
  globalThis.setInterval = (fn, ms) => { t.intervals.push({ fn, ms }); return 200 + t.intervals.length; };
  globalThis.clearInterval = () => {};
  t.restore = () => Object.assign(globalThis, real);
  return t;
}

function fakeDb() {
  const d = { paths: [], unsubscribed: 0, listener: null };
  d.db = { collection: (c) => ({ doc: (x) => ({ onSnapshot: (ok) => { d.paths.push(c + '/' + x); d.listener = ok; return () => { d.unsubscribed++; }; } }) }) };
  return d;
}

test('stopLiveRefresh clears the 1.5 s fallback poll armed by startLiveRefresh', () => {
  const t = fakeTimers();
  try {
    const app = createApp();
    app.autoResolvePlayIns = () => {};
    app.requestWakeLock = () => {};
    app.releaseWakeLock = () => {};
    app.db = fakeDb().db;
    app.startLiveRefresh();
    const fallback = t.timeouts.find(x => x.ms === 1500);
    assert.ok(fallback, 'fallback poll armed');
    assert.equal(t.cleared.length, 0);
    app.stopLiveRefresh();
    assert.deepEqual(t.cleared, [100 + t.timeouts.indexOf(fallback) + 1], 'leaving Live cleared exactly that timer');
  } finally { t.restore(); }
});

test('the fallback poll runs when the cached doc has not arrived, and polls nothing once it has', async () => {
  const t = fakeTimers();
  try {
    const app = createApp();
    app.autoResolvePlayIns = () => {};
    app.requestWakeLock = () => {};
    app.releaseWakeLock = () => {};
    const d = fakeDb();
    app.db = d.db;
    let fetches = 0;
    app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [] }) }; };
    app.startLiveRefresh();
    d.listener({ exists: true, metadata: { fromCache: false }, data: () => ({ events: [], fetchedAt: ts(Date.now()) }) });
    t.timeouts.find(x => x.ms === 1500).fn();
    await new Promise(r => setImmediate(r));
    assert.equal(fetches, 0, 'fresh doc arrived in time: no direct poll');
    app.stopLiveRefresh();

    app.startLiveRefresh();
    t.timeouts.filter(x => x.ms === 1500).pop().fn();
    await new Promise(r => setImmediate(r));
    assert.equal(fetches, 1, 'no doc yet: the fallback polled ESPN directly');
  } finally { t.restore(); }
});

test('refreshLiveScores moves the listener to the new day when the selected date no longer matches it', async () => {
  const app = createApp();
  const d = fakeDb();
  app.db = d.db;
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [] }) }; };
  app.S.liveScoresDate = '20270318';
  app.subscribeScoreboard('20270318');
  assert.deepEqual(d.paths, ['scoreboard/20270318']);

  await app.refreshLiveScores();
  assert.deepEqual(d.paths, ['scoreboard/20270318'], 'same date: listener left alone');
  assert.equal(d.unsubscribed, 0);

  app.S.liveScoresDate = '20270319'; // midnight passed (or the user stepped a day)
  await app.refreshLiveScores();
  assert.deepEqual(d.paths, ['scoreboard/20270318', 'scoreboard/20270319'], 're-subscribed to the new day');
  assert.equal(d.unsubscribed, 1, 'old listener released');
  assert.equal(fetches, 2, 'the direct poll that triggered it still ran (cache for the new day not here yet)');

  app.unsubscribeScoreboard();
  await app.refreshLiveScores();
  assert.equal(d.paths.length, 2, 'not listening (tab left / no Firestore): nothing to move');
});
