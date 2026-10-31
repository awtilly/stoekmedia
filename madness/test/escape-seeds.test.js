const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Team seeds come from shared room state. sanitizeSharedState now coerces any non-number seed to a
 * number (0 if it is not one), so every template that prints a seed gets a number; the draft's
 * "Last: ... picked #<seed>" banner also escapes it. Honest numeric seeds look the same. */
const HOSTILE = '<img src=x onerror=alert(1)>';
let pagesLoaded = false;
function draftApp() {
  const app = createApp({
    phase: 'draft',
    players: [
      { id: 'p1', name: 'Ann', teamIds: ['South-1'] },
      { id: 'p2', name: 'Bob', teamIds: [] },
    ],
    ds: { order: ['p1', 'p2', 'p2', 'p1'], cp: 1, started: true, complete: false },
  });
  app.S.teams.find(t => t.id === 'South-1').seed = HOSTILE;
  globalThis.getMyPlayerId = () => null; globalThis.adminUnlocked = false; // 50-auth.js is not loaded by the harness
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  return app;
}

test('renderDraft: the last-pick banner escapes the team seed', () => {
  const app = draftApp();
  const c = { innerHTML: '' };
  app.renderDraft(c);
  assert.match(c.innerHTML, /class="last-pick"/, 'banner rendered');
  assert.doesNotMatch(c.innerHTML, /<img src=x/, 'raw seed must not reach the DOM');
  assert.match(c.innerHTML, /#&lt;img src=x onerror=alert\(1\)&gt;/, 'seed is shown escaped');
});

test('renderDraft: an honest numeric seed renders unchanged', () => {
  const app = draftApp();
  app.S.teams.find(t => t.id === 'South-1').seed = 1;
  const c = { innerHTML: '' };
  app.renderDraft(c);
  assert.match(c.innerHTML, /picked .*#1 /, 'numeric seed still shows as #1');
});

test('sanitizeSharedState: seeds from room state are always numbers', () => {
  const app = createApp({});
  const s = { teams: [
    { id: 'a', seed: HOSTILE },
    { id: 'b', seed: '5' },
    { id: 'c', seed: 7 },
    { id: 'd' },
  ] };
  app.sanitizeSharedState(s);
  assert.deepEqual(s.teams.map(t => t.seed), [0, 5, 7, undefined]);
});
