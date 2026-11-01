const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * The 10-second alert (beep + haptic) must fire once per pick on EVERY device. It used to be gated by a
 * boolean that only the device making the pick reset, so a spectator or a later drafter heard it once
 * in the whole draft. A remote pick arrives as a new pickDeadline through the snapshot listener with no
 * local reset, which is what these tests simulate.
 */
let pagesLoaded = false;
function spectatorApp(deadlineMs) {
  const app = createApp({ ds: { order: ['p1', 'p2'], cp: 0, started: true, complete: false, pickDeadline: deadlineMs, timerPaused: false } });
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById: () => null };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.getMyPlayerId = () => 'p3';          // not the drafter: expiry never auto-picks here
  app.adminUnlocked = false;
  app.beeps = 0; app.haptics = 0;
  app.playTimerBeep = () => { app.beeps++; };
  app.triggerHaptic = () => { app.haptics++; };
  return app;
}

test('a device that did not make the previous pick still gets the 10 s alert on the next pick', () => {
  const realNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;
    const app = spectatorApp(now + 10_000);
    app.updateDraftClock();
    assert.equal(app.beeps, 1, 'first pick: alert at 10 s');
    now += 250; app.updateDraftClock();
    now += 500; app.updateDraftClock();
    assert.equal(app.beeps, 1, 'same pick, later ticks inside the 10 s second: no repeat');
    // Remote pick lands via the snapshot listener: new deadline, nothing reset locally.
    now += 5_000;
    app.S.ds.cp = 1;
    app.S.ds.pickDeadline = now + 10_000;
    app.updateDraftClock();
    assert.equal(app.beeps, 2, 'second pick: alert again');
    assert.equal(app.haptics, 2);
  } finally { Date.now = realNow; }
});

test('Firestore Timestamp deadlines (toMillis) key the alert the same way', () => {
  const realNow = Date.now;
  try {
    let now = 2_000_000;
    Date.now = () => now;
    const ts = ms => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000) });
    const app = spectatorApp(ts(now + 10_000));
    app.updateDraftClock(); app.updateDraftClock();
    assert.equal(app.beeps, 1);
    app.S.ds.pickDeadline = ts(now + 10_000);  // a re-rendered snapshot of the SAME deadline (new object)
    app.updateDraftClock();
    assert.equal(app.beeps, 1, 'same deadline, new wrapper object: still one alert');
    now += 20_000;
    app.S.ds.pickDeadline = ts(now + 10_000);
    app.updateDraftClock();
    assert.equal(app.beeps, 2, 'new deadline: alert again');
  } finally { Date.now = realNow; }
});

test('a local pick reset (_beeped = false) still allows the alert for the new deadline', () => {
  const realNow = Date.now;
  try {
    let now = 3_000_000;
    Date.now = () => now;
    const app = spectatorApp(now + 10_000);
    app.updateDraftClock();
    assert.equal(app.beeps, 1);
    app.eval('_beeped = false');
    now += 30_000;
    app.S.ds.pickDeadline = now + 10_000;
    app.updateDraftClock();
    assert.equal(app.beeps, 2);
  } finally { Date.now = realNow; }
});
