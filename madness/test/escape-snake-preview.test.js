const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* The draft lobby's "Snake: A -> B -> B -> A" preview joined raw player names into innerHTML. A player
 * who joined with a name like <img src=x onerror=...> ran script on every device that opened the lobby,
 * including the commissioner's unlocked one. The preview now escapes names like every other row does. */
let pagesLoaded = false;
function lobbyApp() {
  const app = createApp({ phase: 'draft', players: [
    { id: 'p1', name: 'Ann', teamIds: [] },
    { id: 'p2', name: '<img src=x onerror=alert(1)>', teamIds: [] },
  ] });
  globalThis.getMyPlayerId = () => null; globalThis.adminUnlocked = false; // 50-auth.js is not loaded by the harness
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  return app;
}

test('renderDraft: the snake-order preview escapes player names', () => {
  const app = lobbyApp();
  const c = { innerHTML: '' };
  app.renderDraft(c);
  assert.match(c.innerHTML, /Snake: /, 'preview rendered');
  assert.doesNotMatch(c.innerHTML, /<img src=x/, 'raw name must not reach the DOM');
  assert.match(c.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/, 'name is shown escaped');
});
