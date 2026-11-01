const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * updateDraftClock() stops the clock at expiry and hands off to autoPickHighestSeed(). When that Firestore
 * transaction threw (phone offline for a moment, contention), nothing ran again on the device until a snapshot
 * or a tab change called render(), and no snapshot arrives while the pick is unmade: the room stalled until the
 * commissioner happened to tap a tab. A failed auto-pick now restarts the clock after a pause, so the expired
 * deadline is seen again and the pick is retried.
 */
function setAdmin(v) { vm.runInThisContext('adminUnlocked = ' + v); }

let pagesLoaded = false;
function liveTabApp(ds) {
  const app = createApp({ phase: 'live', ds });
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById: () => null };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.playTimerBeep = () => {};
  app.triggerHaptic = () => {};
  app.updateAppBadge = () => {};
  app.roomId = 'room1';
  app.getMyPlayerId = () => 'p1';
  setAdmin(false);
  return app;
}

function fakeTimers() {
  const t = { timeouts: [], intervals: [] };
  t.realST = globalThis.setTimeout; t.realSI = globalThis.setInterval; t.realCI = globalThis.clearInterval;
  globalThis.setTimeout = (fn, ms) => { t.timeouts.push({ fn, ms }); return t.timeouts.length; };
  globalThis.setInterval = (fn, ms) => { t.intervals.push({ fn, ms }); return t.intervals.length; };
  globalThis.clearInterval = () => {};
  t.restore = () => { globalThis.setTimeout = t.realST; globalThis.setInterval = t.realSI; globalThis.clearInterval = t.realCI; };
  return t;
}

const expired = () => ({ order: ['p1', 'p2'], cp: 0, started: true, complete: false, pickDeadline: 1_000, timerPaused: false });

test('a failed auto-pick transaction restarts the clock after a pause so the pick is retried', async () => {
  const t = fakeTimers();
  const warn = console.warn; console.warn = () => {};
  try {
    const app = liveTabApp(expired());
    app.db = { runTransaction: async () => { throw new Error('Failed to get document because the client is offline.'); } };
    await app.autoPickHighestSeed(1);
    assert.equal(t.timeouts.length, 1, 'one retry scheduled');
    assert.ok(t.timeouts[0].ms >= 2_000 && t.timeouts[0].ms <= 30_000, 'retry pause is seconds, not a hot loop: ' + t.timeouts[0].ms);
    assert.equal(t.intervals.length, 0, 'clock not restarted before the pause');
    t.timeouts[0].fn();
    assert.equal(t.intervals.length, 1, 'the pause restarted the 250 ms clock, whose next tick re-fires the auto-pick');
    assert.equal(t.intervals[0].ms, 250);
  } finally { t.restore(); console.warn = warn; }
});

test('a second failure while a retry is pending does not stack another retry', async () => {
  const t = fakeTimers();
  const warn = console.warn; console.warn = () => {};
  try {
    const app = liveTabApp(expired());
    app.db = { runTransaction: async () => { throw new Error('unavailable'); } };
    await app.autoPickHighestSeed(1);
    await app.autoPickHighestSeed(1);
    assert.equal(t.timeouts.length, 1);
    t.timeouts[0].fn();
    await app.autoPickHighestSeed(1);
    assert.equal(t.timeouts.length, 2, 'after the pending retry fires, a new failure may schedule the next one');
    t.timeouts[1].fn();                 // drain so no retry is left pending for the next test
  } finally { t.restore(); console.warn = warn; }
});

test('the retry stands down if the draft finished or was paused meanwhile; a successful pick schedules nothing', async () => {
  const t = fakeTimers();
  const warn = console.warn; console.warn = () => {};
  try {
    const app = liveTabApp(expired());
    app.db = { runTransaction: async () => { throw new Error('unavailable'); } };
    await app.autoPickHighestSeed(1);
    app.S.ds.timerPaused = true;           // the commissioner paused the draft during the pause
    t.timeouts[0].fn();
    assert.equal(t.intervals.length, 0, 'paused draft: clock stays stopped');

    app.S.ds = expired();
    await app.autoPickHighestSeed(1);
    app.S.ds.complete = true;              // the last pick landed from another device
    t.timeouts[1].fn();
    assert.equal(t.intervals.length, 0, 'finished draft: clock stays stopped');

    app.S.ds = expired();
    app.db = { collection() { return { doc() { return {}; } }; }, runTransaction: async (fn) => { await fn({ get: async () => ({ exists: false }) }); } };
    await app.autoPickHighestSeed(1);
    assert.equal(t.timeouts.length, 2, 'a transaction that completes schedules no retry');
  } finally { t.restore(); console.warn = warn; }
});
