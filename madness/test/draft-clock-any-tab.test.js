const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * The draft clock used to start only while S.phase === 'draft'. The commissioner's device is the autopick
 * fallback for a drafter who walked away, and it usually sits on Live or Leaderboard during the draft, so
 * an absent drafter stalled the whole room. render() now gates the clock on the draft state alone, and
 * updateDraftClock() copes with a tab that has no #draft-timer element.
 */
let pagesLoaded = false;
function offTabApp(ds) {
  const app = createApp({ phase: 'live', ds });
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById: () => null }; // Live tab: no timer element
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.playTimerBeep = () => {};
  app.triggerHaptic = () => {};
  return app;
}

test('draftClockShouldRun: started, unfinished, unpaused draft with a deadline, whatever the tab', () => {
  const live = { started: true, complete: false, pickDeadline: 1_700_000_000_000, timerPaused: false };
  const app = offTabApp(live);
  assert.equal(app.draftClockShouldRun(live), true);
  assert.equal(app.draftClockShouldRun({ ...live, started: false }), false, 'lobby');
  assert.equal(app.draftClockShouldRun({ ...live, complete: true }), false, 'finished draft');
  assert.equal(app.draftClockShouldRun({ ...live, pickDeadline: null }), false, 'no clock configured');
  assert.equal(app.draftClockShouldRun({ ...live, timerPaused: true }), false, 'paused by the commissioner');
  assert.equal(app.draftClockShouldRun(undefined), false);
});

test('render() starts the clock from the draft state alone, with no S.phase gate', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  const gate = src.indexOf('if(draftClockShouldRun(S.ds)){');
  assert.ok(gate > 0, 'render() uses draftClockShouldRun');
  assert.ok(src.slice(gate, gate + 120).includes('startDraftClock();'));
  assert.doesNotMatch(src, /S\.phase === 'draft' && S\.ds\.started/, 'old phase-gated clock start is gone');
  // The paused-time label is still only painted on the Draft tab, where #draft-timer lives.
  assert.match(src, /if\(S\.phase === 'draft' && S\.ds\.timerPaused && S\.ds\.pausedRemaining != null\)/);
});

test('the commissioner on the Live tab (no #draft-timer) still auto-picks for an absent drafter at expiry', () => {
  const realNow = Date.now;
  try {
    let now = 4_000_000;
    Date.now = () => now;
    const app = offTabApp({ order: ['p1', 'p2'], cp: 0, started: true, complete: false, pickDeadline: now + 1_000, timerPaused: false });
    app.getMyPlayerId = () => 'p2';   // not the drafter
    app.adminUnlocked = true;         // but the commissioner
    let picks = 0;
    app.autoPickHighestSeed = () => { picks++; };
    app.updateDraftClock();           // 1 s left: nothing yet
    assert.equal(picks, 0);
    now += 1_000; app.updateDraftClock();
    assert.equal(picks, 1, 'expiry fired the auto-pick with no timer element on the page');
    app.adminUnlocked = false;
    app.S.ds.pickDeadline = now + 500; now += 500; app.updateDraftClock();
    assert.equal(picks, 1, 'a plain spectator never auto-picks');
  } finally { Date.now = realNow; }
});
