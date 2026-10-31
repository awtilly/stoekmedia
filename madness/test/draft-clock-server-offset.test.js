const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * The draft clock counted down against each device's own Date.now(). noteServerTime(doc) in js/80-pages.js
 * learns the device's offset from Firestore's clock out of the room doc's server-stamped updatedAt, and
 * updateDraftClock() / pauseDraftClock() measure the remaining time with serverNow() instead.
 * 80-pages.js is loaded once on top of the harness (draft-clock.test.js pattern).
 */
function setAdmin(v) { vm.runInThisContext('adminUnlocked = ' + v); }

let pagesLoaded = false;
function clockApp(ds, el) {
  const app = createApp({ phase: 'draft', ds });
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById: id => (id === 'draft-timer' ? (el || null) : null) };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.getMyPlayerId = () => 'p2';
  setAdmin(false);
  app.playTimerBeep = () => {};
  app.triggerHaptic = () => {};
  return app;
}

/** A Firestore-like room snapshot. updatedAt is server millis; flags mirror doc.metadata. */
function snap(updatedAtMs, { pending = false, fromCache = false, exists = true } = {}) {
  return {
    exists,
    metadata: { hasPendingWrites: pending, fromCache },
    data: () => ({ state: '{}', updatedAt: updatedAtMs === null ? null : { toMillis: () => updatedAtMs } })
  };
}

function resetOffset() { vm.runInThisContext('_serverOffsetMs = 0; _serverOffsetRoom = null; _serverLastUpdatedAt = null;'); }
const offsetMs = () => vm.runInThisContext('_serverOffsetMs');

test('noteServerTime: the first server snapshot only sets a baseline; a later write calibrates; junk snapshots are ignored', () => {
  const realNow = Date.now;
  try {
    const app = clockApp({ order: ['p1'], cp: 0, started: false, complete: false, pickDeadline: null, timerPaused: false });
    app.roomId = 'ROOM1';
    resetOffset();
    let now = 10_000_000;                 // this device runs 40 s FAST: server time is now - 40_000
    Date.now = () => now;
    app.noteServerTime(snap(now - 40_000 - 3_600_000)); // initial listen: the doc is an hour old
    assert.equal(offsetMs(), 0, 'first snapshot: age unknown, no calibration');
    assert.equal(app.serverNow(), now);
    now += 5_000;
    app.noteServerTime(snap(now - 40_000, { pending: true }));   // local echo of an own write
    assert.equal(offsetMs(), 0, 'pending-write snapshot ignored');
    app.noteServerTime(snap(now - 40_000, { fromCache: true }));
    assert.equal(offsetMs(), 0, 'cache snapshot ignored');
    app.noteServerTime(snap(null));
    assert.equal(offsetMs(), 0, 'snapshot without updatedAt ignored');
    app.noteServerTime(snap(now - 40_000));                      // a write landed while listening
    assert.equal(offsetMs(), -40_000, 'offset learned from the fresh commit');
    assert.equal(app.serverNow(), now - 40_000);
    app.noteServerTime(snap(now - 40_000 - 1));                  // older or equal updatedAt: not newer
    assert.equal(offsetMs(), -40_000, 'stale updatedAt ignored');
    now += 1_000;
    app.noteServerTime(snap(now + 10 * 60_000));                 // nonsense: 10 min in the future
    assert.equal(offsetMs(), -40_000, 'offsets beyond 5 min are rejected');
  } finally { Date.now = realNow; }
});

test('noteServerTime: switching rooms re-baselines instead of trusting the new room\'s old updatedAt', () => {
  const realNow = Date.now;
  try {
    const app = clockApp({ order: ['p1'], cp: 0, started: false, complete: false, pickDeadline: null, timerPaused: false });
    resetOffset();
    let now = 20_000_000;
    Date.now = () => now;
    app.roomId = 'A';
    app.noteServerTime(snap(now - 100));
    now += 2_000;
    app.noteServerTime(snap(now - 100));
    assert.equal(offsetMs(), -100);
    app.roomId = 'B';                                            // room B last changed days ago
    app.noteServerTime(snap(now - 2 * 86_400_000));
    assert.equal(offsetMs(), -100, 'kept the known offset; did not learn from an old doc');
    now += 3_000;
    app.noteServerTime(snap(now - 250));                         // first write in room B while listening
    assert.equal(offsetMs(), -250);
  } finally { Date.now = realNow; }
});

test('a device 40 s fast shows the real remaining time and does not auto-pick early', () => {
  const realNow = Date.now;
  try {
    let now = 30_000_000;                 // local clock; true server time = now - 40_000
    Date.now = () => now;
    const el = { textContent: '', className: '' };
    const serverDeadline = (now - 40_000) + 60_000;             // picker (on server time) wrote a 60 s deadline
    const app = clockApp({ order: ['p1', 'p2'], cp: 0, started: true, complete: false, pickDeadline: serverDeadline, timerPaused: false }, el);
    app.roomId = 'ROOM3';
    resetOffset();
    setAdmin(true);                       // commissioner's tab = autopick fallback
    let picks = 0;
    app.autoPickHighestSeed = () => { picks++; };
    // Uncalibrated (old behaviour): the fast clock already thinks only 20 s remain.
    app.updateDraftClock();
    assert.equal(el.textContent, '20s');
    // Two snapshots (baseline, then the start-draft write) calibrate the device.
    app.noteServerTime(snap(now - 40_000 - 1_000));
    app.noteServerTime(snap(now - 40_000));
    app.updateDraftClock();
    assert.equal(el.textContent, '60s', 'calibrated: the full minute shows');
    now += 20_000; app.updateDraftClock();
    assert.equal(el.textContent, '40s');
    assert.equal(picks, 0, 'local clock passed the deadline 20 s ago; no early auto-pick');
    now += 40_000; app.updateDraftClock();
    assert.equal(picks, 1, 'auto-pick fires when server time reaches the deadline');
  } finally { Date.now = realNow; setAdmin(false); }
});

test('pauseDraftClock stores the remaining time measured on server time', async () => {
  const realNow = Date.now;
  try {
    let now = 40_000_000;
    Date.now = () => now;
    const app = clockApp({ order: ['p1', 'p2'], cp: 0, started: true, complete: false, pickDeadline: (now - 40_000) + 50_000, timerPaused: false });
    app.roomId = 'ROOM4';
    resetOffset();
    app.noteServerTime(snap(now - 40_000 - 500));
    app.noteServerTime(snap(now - 40_000));
    await app.pauseDraftClock();           // async once clock-admin-gate (PIN check, stubbed true) is in the tree
    assert.equal(app.S.ds.timerPaused, true);
    assert.equal(app.S.ds.pausedRemaining, 50_000, '50 s left on server time (the fast clock would have said 10 s)');
    assert.equal(app.S.ds.pickDeadline, null);
  } finally { Date.now = realNow; }
});
