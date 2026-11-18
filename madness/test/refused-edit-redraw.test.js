const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* The year field and the six round-point fields are plain <input onchange="...">: the browser has already put the
 * typed value in the field when the handler runs. If the PIN prompt is then cancelled (or the PIN is wrong) the
 * handler used to return without redrawing, so the field kept showing a value the room does not have: Scoring
 * Settings says "Changes apply immediately" above a number that was never applied. A refused edit now redraws,
 * which rebuilds the field from S. */
let pagesLoaded = false;
function pagesApp(adminAnswer) {
  const stubs = { window: { addEventListener() {} }, document: { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } } };
  if (!pagesLoaded) {
    // 80-pages.js declares the real render(): load it before createApp() so createApp's counting stub wins.
    Object.assign(globalThis, stubs);
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  const app = createApp();
  Object.assign(app, stubs);
  app.requireAdmin = async () => adminAnswer;
  return app;
}

test('changeScoring: a refused edit changes nothing, saves nothing, and redraws', async () => {
  const app = pagesApp(false);
  const before = JSON.stringify(app.S.rp);
  await app.changeScoring(3, '99');
  assert.equal(JSON.stringify(app.S.rp), before);
  assert.equal(app.__calls.saveState, 0);
  assert.equal(app.__calls.render, 1, 'the redraw puts the real value back in the field');
});

test('changeScoring: an allowed edit is applied, saved and drawn once', async () => {
  const app = pagesApp(true);
  await app.changeScoring(3, '7');
  assert.equal(app.S.rp[3], 7);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.__calls.render, 1);
});

test('changeYear: a refused edit changes nothing, saves nothing, and redraws', async () => {
  const app = pagesApp(false);
  const before = app.S.year;
  await app.changeYear(String(before + 3));
  assert.equal(app.S.year, before);
  assert.equal(app.__calls.saveState, 0);
  assert.equal(app.__calls.render, 1, 'the redraw puts the real year back in the field');
});

test('changeYear: an allowed edit is applied, saved and drawn once', async () => {
  const app = pagesApp(true);
  await app.changeYear('2031');
  assert.equal(app.S.year, 2031);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.__calls.render, 1);
});
