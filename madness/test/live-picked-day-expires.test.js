const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createApp } = require('./_harness');

/*
 * A day picked on the Live tab ("back one day" to check a score) is stored with the device's view state. It was
 * restored in every later session, so the Live tab kept opening on that old day until somebody noticed and tapped
 * Today, and a phone showing an old day does not process today's finals. A picked day now lasts for the session
 * it was picked in, and not past four hours in the background.
 */
function setup() {
  const app = createApp({ phase: 'live' });
  const t = { app, subscribed: [] };
  app.db = { collection: () => ({ doc: (id) => ({ onSnapshot: () => { t.subscribed.push(id); return () => {}; } }) }) };
  app.autoResolvePlayIns = () => {};
  app.requestWakeLock = () => {};
  app.releaseWakeLock = () => {};
  const real = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval, now: Date.now };
  globalThis.setTimeout = () => 1; globalThis.setInterval = () => 2; globalThis.clearTimeout = () => {}; globalThis.clearInterval = () => {};
  t.done = () => { app.stopLiveRefresh(); Object.assign(globalThis, real); Date.now = real.now; vm.runInThisContext('_liveHiddenAt = 0'); };
  return t;
}

test('loadState: a stored picked day is dropped; the tab, the filter and the room data are kept', () => {
  const app = createApp();
  const stored = Object.assign({}, app.S, { phase: 'live', liveScoresDate: '20270318', liveScoresFilter: 'mine', year: 2027 });
  app.localStorage.setItem(app.stateKey(), JSON.stringify(stored));
  app.loadState();
  assert.equal(app.S.liveScoresDate, '');
  assert.equal(app.S.phase, 'live');
  assert.equal(app.S.liveScoresFilter, 'mine');
  assert.equal(app.S.teams.length, 64);
});

test('back after hours in the background: the picked day is dropped and Live subscribes to today', () => {
  const t = setup();
  try {
    let now = 1_800_000_000_000;
    Date.now = () => now;
    t.app.S.liveScoresDate = '20270318';
    t.app.startLiveRefresh();
    assert.deepEqual(t.subscribed, ['20270318'], 'a day picked in this session is shown');
    t.app.liveVisibilityChanged(false);
    now += 9 * 3600000; // overnight
    t.app.liveVisibilityChanged(true);
    assert.equal(t.app.S.liveScoresDate, '');
    assert.equal(t.subscribed.length, 2);
    assert.notEqual(t.subscribed[1], '20270318');
  } finally { t.done(); }
});

test('back after a short break: the picked day stays', () => {
  const t = setup();
  try {
    let now = 1_800_000_000_000;
    Date.now = () => now;
    t.app.S.liveScoresDate = '20270318';
    t.app.liveVisibilityChanged(false);
    now += 20 * 60000;
    t.app.liveVisibilityChanged(true);
    assert.equal(t.app.S.liveScoresDate, '20270318');
    assert.deepEqual(t.subscribed, ['20270318']);
  } finally { t.done(); }
});

test('coming back on another tab drops a stale picked day without starting the Live refresh', () => {
  const t = setup();
  try {
    let now = 1_800_000_000_000;
    Date.now = () => now;
    t.app.S.phase = 'bracket';
    t.app.S.liveScoresDate = '20270318';
    t.app.liveVisibilityChanged(false);
    now += 5 * 3600000;
    t.app.liveVisibilityChanged(true);
    assert.equal(t.app.S.liveScoresDate, '');
    assert.deepEqual(t.subscribed, []);
  } finally { t.done(); }
});
