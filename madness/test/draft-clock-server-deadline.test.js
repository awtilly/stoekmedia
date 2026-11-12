const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * draft-clock-server-offset made every device READ the pick clock on Firestore's clock. The deadlines
 * themselves were still WRITTEN from the picker's Date.now(), so a picker whose clock was 40 s slow gave
 * themselves 100 s. Every `Timestamp.fromDate(new Date(... + duration))` in js/80-pages.js now starts
 * from serverNow(). 80-pages.js is loaded once on top of the harness (draft-clock.test.js pattern).
 */
const PAGES_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
let pagesLoaded = false;
function clockApp(ds) {
  const app = createApp({ phase: 'draft', ds });
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  app.firebase = { firestore: { Timestamp: { fromDate: d => ({ toMillis: () => d.getTime() }) } } };
  if (!pagesLoaded) {
    vm.runInThisContext(PAGES_SRC, { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.playTimerBeep = () => {};
  app.triggerHaptic = () => {};
  return app;
}
function snap(updatedAtMs) {
  return { exists: true, metadata: { hasPendingWrites: false, fromCache: false }, data: () => ({ state: '{}', updatedAt: { toMillis: () => updatedAtMs } }) };
}

test('resuming a paused clock writes the new deadline from server time, not the device clock', async () => {
  const realNow = Date.now;
  try {
    let now = 50_000_000;                 // this device is 40 s FAST
    Date.now = () => now;
    const app = clockApp({ order: ['p1', 'p2'], cp: 0, started: true, complete: false, pickDeadline: null, timerPaused: true, pausedRemaining: 30_000, timerDuration: 60 });
    app.roomId = 'ROOM5';
    vm.runInThisContext('_serverOffsetMs = 0; _serverOffsetRoom = null; _serverLastUpdatedAt = null;');
    app.noteServerTime(snap(now - 40_000 - 500));
    app.noteServerTime(snap(now - 40_000));
    await app.resumeDraftClock();         // async once clock-admin-gate (PIN check, stubbed true) is in the tree
    app.stopDraftClock();                 // resume started the real interval
    assert.equal(app.S.ds.timerPaused, false);
    assert.equal(app.S.ds.pickDeadline.toMillis(), now - 40_000 + 30_000, 'deadline = server now + remaining');
    assert.equal(app.__calls.saveState, 1);
  } finally { Date.now = realNow; }
});

test('tripwire: no deadline in 80-pages.js is built from Date.now() any more', () => {
  assert.equal((PAGES_SRC.match(/new Date\(Date\.now\(\)/g) || []).length, 0);
  assert.equal((PAGES_SRC.match(/new Date\(serverNow\(\)/g) || []).length, 8, 'start, pick, undo, auto-pick, skip, timer change, resume');
});
