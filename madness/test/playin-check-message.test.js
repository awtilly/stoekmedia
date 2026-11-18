const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp } = require('./_harness');

/* The manual "check play-ins" button reported a failed bracket request (offline, relay error) as
 * "N play-in games not final yet". On First Four night that reads as "wait", when the right move is to try again. */
let pagesLoaded = false;
function playInApp() {
  const app = createApp();
  app.window = { addEventListener() {}, matchMedia() { return { matches: false }; } };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.render = () => { app.__calls.render++; };
  app.S.teams = [{ id: 'pi', name: 'UMBC / Howard', seed: 16, region: 'South', playIn: true, playInResolved: false,
    playInTeams: [{ name: 'UMBC', ncaaId: 'umbc' }, { name: 'Howard', ncaaId: 'howard' }] }];
  vm.runInThisContext('_lastAutoResolve = 0');
  return app;
}
const lastToast = (app) => app.__calls.toasts[app.__calls.toasts.length - 1];

test('checkPlayIns: a failed request says "could not reach", not "not final yet", and the next check is not made to wait', async () => {
  const app = playInApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: false, status: 502 }; };
  await app.checkPlayIns();
  assert.match(lastToast(app), /Could not reach NCAA\.com/);
  assert.equal(await app.autoResolvePlayIns(), false); // the automatic check on the next Live open
  assert.equal(fetches, 2);
});

test('checkPlayIns: the bracket answers but the game is not decided: "not final yet", and the hourly wait applies', async () => {
  const app = playInApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ championships: [{ games: [] }] }) }; };
  await app.checkPlayIns();
  assert.match(lastToast(app), /1 play-in game not final yet/);
  await app.autoResolvePlayIns();
  assert.equal(fetches, 1);
  vm.runInThisContext('_lastAutoResolve = 0');
});
