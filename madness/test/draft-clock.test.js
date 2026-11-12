const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * js/80-pages.js is loaded once on top of the harness (its only top-level statement is a
 * window 'beforeunload' listener). document.getElementById('draft-timer') returns a fake element
 * that counts every textContent / className assignment, which is what the clock tick must avoid
 * when nothing changed.
 */
let pagesLoaded = false;
function fakeTimerEl() {
  const el = { writes: 0, _text: '', _cls: 'draft-timer' };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el.writes++; el._text = v; } });
  Object.defineProperty(el, 'className', { get() { return el._cls; }, set(v) { el.writes++; el._cls = v; } });
  return el;
}

function clockApp(deadlineMs, el) {
  const app = createApp({ ds: { order: ['p1'], cp: 0, started: true, complete: false, pickDeadline: deadlineMs, timerPaused: false } });
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById: id => (id === 'draft-timer' ? el : null) };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.getMyPlayerId = () => 'p2';          // not the drafter: expiry never auto-picks here
  app.adminUnlocked = false;
  app.playTimerBeep = () => {};
  app.triggerHaptic = () => {};
  return app;
}

test('four ticks inside the same second write the timer element once (text + class), not four times', () => {
  const el = fakeTimerEl();
  const realNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;
    const app = clockApp(now + 45_000, el);
    app.updateDraftClock();
    assert.equal(el.textContent, '0:45');
    assert.equal(el.className, 'draft-timer');
    assert.equal(el.writes, 1, 'first tick fills the freshly rendered (empty) element');
    for (const step of [250, 250, 250]) { now += step; app.updateDraftClock(); }
    assert.equal(el.writes, 1, 'same second: no DOM writes');
    now += 250; app.updateDraftClock();
    assert.equal(el.textContent, '0:44');
    assert.equal(el.writes, 2, 'new second: text written, class unchanged');
  } finally { Date.now = realNow; }
});

test('the clock turns red at 15 seconds', () => {
  const el = fakeTimerEl();
  const realNow = Date.now;
  try {
    let now = 5_000_000;
    Date.now = () => now;
    const app = clockApp(now + 16_000, el);
    app.updateDraftClock();
    assert.equal(el.className, 'draft-timer');
    assert.equal(el.textContent, '0:16');
    now += 1_000; app.updateDraftClock();
    assert.equal(el.className, 'draft-timer timer-red');
    assert.equal(el.textContent, '0:15');
  } finally { Date.now = realNow; }
});

test('a re-rendered (empty) element is filled on the next tick even when the second did not change', () => {
  const realNow = Date.now;
  try {
    const now = 9_000_000;
    Date.now = () => now;
    const first = fakeTimerEl();
    const app = clockApp(now + 20_000, first);
    app.updateDraftClock();
    assert.equal(first.textContent, '0:20');
    const rebuilt = fakeTimerEl();            // render() replaced the DOM; same deadline, same second
    app.document.getElementById = id => (id === 'draft-timer' ? rebuilt : null);
    app.updateDraftClock();
    assert.equal(rebuilt.textContent, '0:20');
    assert.equal(rebuilt.className, 'draft-timer');
  } finally { Date.now = realNow; }
});

test('paused or finished drafts never touch the element', () => {
  const el = fakeTimerEl();
  const app = clockApp(Date.now() + 20_000, el);
  app.S.ds.timerPaused = true;
  app.updateDraftClock();
  app.S.ds.timerPaused = false; app.S.ds.complete = true;
  app.updateDraftClock();
  assert.equal(el.writes, 0);
});
