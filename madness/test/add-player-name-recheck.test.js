const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp } = require('./_harness');

/* The commissioner's "add a player" (and "join as player") check the name, then ask for a PIN. While that box is
 * open the person being added can join by themselves (join night: everybody is on their phone). The name check
 * was not repeated, so the pool had the same name twice and one of the two seats belonged to nobody. */
let pagesLoaded = false;
function pagesApp() {
  const app = createApp();
  app.window = { addEventListener() {}, matchMedia() { return { matches: false }; } };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById(id) { return id === 'pn' ? { value: 'Mike', focus() {} } : null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.render = () => { app.__calls.render++; };
  app.roomId = 'POOL';
  app.requireAdmin = async () => true;
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: [] }];
  return app;
}
const selfJoin = (app, name) => { app.S.players = app.S.players.concat([{ id: 'self', name, teamIds: [], pinHash: 'x:y' }]); };
const names = app => app.S.players.map(p => p.name);

test('addPlayer: the person joins by themselves while the PIN box is open -> no second entry', async () => {
  const app = pagesApp();
  app.appPrompt = async () => { selfJoin(app, 'mike'); return '1234'; };
  await app.addPlayer();
  assert.deepEqual(names(app), ['Ann', 'mike']);
  assert.equal(app.__calls.saveState, 0);
  assert.match(app.__calls.toasts[app.__calls.toasts.length - 1], /has just joined/);
});

test('addPlayer: nobody else joined -> the player is added as before', async () => {
  const app = pagesApp();
  app.appPrompt = async () => '1234';
  await app.addPlayer();
  assert.deepEqual(names(app), ['Ann', 'Mike']);
  assert.equal(app.__calls.saveState, 1);
});

test('adminJoinAsPlayer: the name is taken while the PIN box is open -> no second entry, no seat taken', async () => {
  const app = pagesApp();
  app.eval('adminUnlocked = true');
  const answers = ['Mike', '1234'];
  app.appPrompt = async () => { const a = answers.shift(); if (a === '1234') selfJoin(app, 'Mike'); return a; };
  await app.adminJoinAsPlayer();
  assert.deepEqual(names(app), ['Ann', 'Mike']);
  assert.equal(app.getMyPlayerId(), null);
  assert.equal(app.__calls.saveState, 0);
});

test('adminJoinAsPlayer: nobody else joined -> joined as before', async () => {
  const app = pagesApp();
  app.eval('adminUnlocked = true');
  const answers = ['Mike', '1234'];
  app.appPrompt = async () => answers.shift();
  await app.adminJoinAsPlayer();
  assert.deepEqual(names(app), ['Ann', 'Mike']);
  assert.equal(app.getMyPlayerId(), app.S.players[1].id);
  app.eval('adminUnlocked = false');
});
