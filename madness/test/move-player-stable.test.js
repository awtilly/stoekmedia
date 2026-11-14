const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp } = require('./_harness');

/* movePlayer(i, d) in js/80-pages.js receives the ROW INDEX of the arrow that was tapped and swaps after
 * `await requireAdmin()`. That await is a PIN prompt on the first admin action of a session, and a room snapshot
 * that lands meanwhile can reorder or remove players: the swap then moved whoever had slid into that row.
 * The tapped player is now looked up again after the await. */
let pagesLoaded = false;
function pagesApp(players) {
  const app = createApp({ players });
  app.window = { addEventListener() {}, matchMedia() { return { matches: false }; } };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.render = () => { app.__calls.render++; }; // loading 80-pages.js replaced the harness stub
  return app;
}
const P = (id) => ({ id, name: id, teamIds: [] });
const names = (app) => app.S.players.map(p => p.id);

test('movePlayer: a snapshot that reorders the players during the PIN prompt does not move the wrong player', async () => {
  const app = pagesApp([P('a'), P('b'), P('c'), P('d')]);
  app.requireAdmin = async () => { app.S.players = [P('d'), P('a'), P('b'), P('c')]; return true; }; // snapshot during the prompt
  await app.movePlayer(1, 1); // the admin tapped "down" on b (row 1 at tap time)
  assert.deepEqual(names(app), ['d', 'a', 'c', 'b'], 'b moved down, not whoever now sits in row 1');
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.__calls.render, 1);
});

test('movePlayer: a player removed during the PIN prompt is not moved and nothing is saved', async () => {
  const app = pagesApp([P('a'), P('b'), P('c'), P('d')]);
  app.requireAdmin = async () => { app.S.players = [P('a'), P('c'), P('d')]; return true; };
  await app.movePlayer(1, 1); // tapped "down" on b, which is gone by the time the PIN is in
  assert.deepEqual(names(app), ['a', 'c', 'd'], 'c and d (now rows 1 and 2) stay where they are');
  assert.equal(app.__calls.saveState, 0);
});

test('movePlayer: the ordinary case (admin already unlocked) still swaps and clamps at the ends', async () => {
  const app = pagesApp([P('a'), P('b'), P('c')]);
  await app.movePlayer(0, 1);
  assert.deepEqual(names(app), ['b', 'a', 'c']);
  await app.movePlayer(2, 1); // last row down: nothing
  assert.deepEqual(names(app), ['b', 'a', 'c']);
  await app.movePlayer(0, -1); // first row up: nothing
  assert.deepEqual(names(app), ['b', 'a', 'c']);
  assert.equal(app.__calls.saveState, 1);
});
