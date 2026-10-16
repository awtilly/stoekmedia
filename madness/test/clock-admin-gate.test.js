const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* pauseDraftClock()/resumeDraftClock() are commissioner controls (the buttons only render when adminUnlocked)
 * but, unlike undoDraft/resetDraft/setDraftClock, they never asked requireAdmin(): anyone in the room could
 * call them from the console and freeze or restart everybody's pick clock. */
let pagesLoaded = false;
function clockApp(adminAnswer) {
  const app = createApp();
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.requireAdmin = async () => adminAnswer;
  app.firebase = { firestore: { Timestamp: { fromDate: d => d.getTime() } } };
  app.S.ds = { started: true, complete: false, cp: 0, order: ['a', 'b'], timerDuration: 60, pickDeadline: Date.now() + 30000, timerPaused: false, pausedRemaining: null };
  return app;
}

test('pause and resume do nothing when the admin check fails', async () => {
  const app = clockApp(false);
  await app.pauseDraftClock();
  assert.equal(app.S.ds.timerPaused, false);
  assert.equal(app.__calls.saveState, 0);
  app.S.ds.timerPaused = true; app.S.ds.pickDeadline = null; app.S.ds.pausedRemaining = 5000;
  await app.resumeDraftClock();
  assert.equal(app.S.ds.timerPaused, true);
  assert.equal(app.__calls.saveState, 0);
});

test('pause and resume still work for the commissioner', async () => {
  const app = clockApp(true);
  await app.pauseDraftClock();
  assert.equal(app.S.ds.timerPaused, true);
  assert.ok(app.S.ds.pausedRemaining > 0 && app.S.ds.pausedRemaining <= 30000);
  assert.equal(app.S.ds.pickDeadline, null);
  await app.resumeDraftClock();
  assert.equal(app.S.ds.timerPaused, false);
  assert.ok(app.S.ds.pickDeadline > Date.now());
  assert.equal(app.__calls.saveState, 2);
});

test('every draft control asks requireAdmin before touching state (source check)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  for (const fn of ['pauseDraftClock', 'resumeDraftClock', 'undoDraft', 'resetDraft', 'setDraftClock', 'startDraft']) {
    const body = src.slice(src.indexOf('async function ' + fn + '('));
    const admin = body.indexOf('if(!await requireAdmin()) return;');
    assert.ok(admin >= 0 && admin < body.indexOf('S.ds'), fn + ' checks requireAdmin before S.ds');
  }
});
