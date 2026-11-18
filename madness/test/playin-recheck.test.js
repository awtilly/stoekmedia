const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A First Four slot ("UMBC / Howard") is settled from the NCAA.com bracket once its game is final. The check used
 * to arm a one-hour throttle for the whole session as soon as the bracket answered, final or not, and only opening
 * the Live tab ran it: a game that ended a few minutes after a check left the slot open for the rest of the hour
 * (and an open slot has no team id, so its next game matches nothing), and a second pool opened in that hour was
 * not checked. Now: every five minutes while a slot is open, per pool, and on a timer while the Live tab is open. */

const bracket2026 = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-bracket-2026.json'), 'utf8'));
/** The same bracket with the First Four still being played. */
function bracketBeforeFinal() {
  const data = bracket2026();
  for (const g of data.championships[0].games) {
    if (Math.floor(g.bracketId / 100) === 1) { g.gameState = 'I'; g.statusCodeDisplay = 'live'; g.teams.forEach(x => { x.isWinner = false; }); }
  }
  return data;
}
const playInTeam = () => ({
  id: 'West-16', name: 'UMBC / Howard', seed: 16, region: 'West',
  logo: '', abbr: '', ncaaId: '', color: '', record: '',
  playIn: true, playInResolved: false,
  playInTeams: [
    { name: 'UMBC', abbr: '', ncaaId: 'umbc', logo: '', color: '', record: '' },
    { name: 'Howard', abbr: '', ncaaId: 'howard', logo: '', color: '', record: '' }
  ]
});

const realNow = Date.now, realSetTimeout = globalThis.setTimeout;
let clock = 5_000_000_000;
let timers = [];
test.beforeEach(() => {
  clock += 10_000_000; // far from the last test's throttle
  Date.now = () => clock;
  timers = [];
  vm.runInThisContext('_lastAutoResolve = 0; _autoResolveRoom = null; _playInRecheck = null; _autoResolveFetching = false; liveRefreshTimer = null;');
});
test.after(() => { Date.now = realNow; globalThis.setTimeout = realSetTimeout; });

function pool(room) {
  const app = createApp();
  app.roomId = room;
  app.S.year = 2026;
  app.S.teams = app.S.teams.filter(t => t.id !== 'West-16').concat([playInTeam()]);
  // only the re-check timers are kept (a request may set a timer of its own for its time limit)
  app.setTimeout = (fn, ms) => { if (ms === 5 * 60 * 1000) timers.push({ fn, ms }); return 1; };
  return app;
}
function serve(app, answer) {
  const calls = [];
  app.fetch = async (url) => { calls.push(url); return { ok: true, json: async () => answer.data }; };
  return calls;
}
const slot = app => app.S.teams.find(t => t.id === 'West-16');

test('a game that ends after a check is settled by the next check five minutes later, not an hour later', async () => {
  const app = pool('POOLA');
  const answer = { data: bracketBeforeFinal() };
  const calls = serve(app, answer);
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1);
  assert.equal(slot(app).playInResolved, false, 'still being played');
  answer.data = bracket2026(); // the game ends
  clock += 4 * 60 * 1000;
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1, 'inside five minutes: no second request');
  clock += 61 * 1000;
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 2);
  assert.equal(slot(app).playInResolved, true);
  assert.equal(slot(app).name, 'Howard');
});

test('another pool opened right after a check gets its own check', async () => {
  let app = pool('POOLA');
  let calls = serve(app, { data: bracket2026() });
  await app.autoResolvePlayIns();
  assert.equal(slot(app).playInResolved, true);
  app = pool('POOLB'); // Home, then the other pool: same page
  calls = serve(app, { data: bracket2026() });
  clock += 30 * 1000;
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1, 'pool B is checked at once');
  assert.equal(slot(app).name, 'Howard');
});

test('a pool left while the bracket request is out: nothing is settled in the pool opened meanwhile', async () => {
  let app = pool('POOLA');
  let release;
  app.fetch = () => new Promise(r => { release = () => r({ ok: true, json: async () => bracket2026() }); });
  const first = app.autoResolvePlayIns();
  await new Promise(r => setImmediate(r));
  app = pool('POOLB');
  release();
  await first;
  assert.equal(slot(app).playInResolved, false, 'pool B is not written by pool A\'s check');
  assert.equal(app.__calls.saveState, 0);
  const calls = serve(app, { data: bracket2026() });
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1, 'and pool B\'s own check is not throttled by it');
  assert.equal(slot(app).playInResolved, true);
});

test('with the Live tab open and a slot still waiting, one re-check is scheduled; it settles the slot', async () => {
  const app = pool('POOLA');
  vm.runInThisContext('liveRefreshTimer = 1'); // the Live tab is open
  const answer = { data: bracketBeforeFinal() };
  const calls = serve(app, answer);
  await app.autoResolvePlayIns();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5 * 60 * 1000);
  clock += 60 * 1000;
  await app.autoResolvePlayIns(); // tab closed and opened again inside the five minutes
  assert.equal(timers.length, 1, 'still the one timer');
  answer.data = bracket2026();
  clock += 4 * 60 * 1000;
  timers[0].fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(calls.length, 2);
  assert.equal(slot(app).playInResolved, true);
  assert.equal(timers.length, 1, 'nothing left to wait for: no further timer');
});

test('no timer when the Live tab is not open, or once every slot is settled; a timer that fires off the Live tab does nothing', async () => {
  let app = pool('POOLA');
  let calls = serve(app, { data: bracketBeforeFinal() });
  await app.autoResolvePlayIns();
  assert.equal(timers.length, 0, 'not on the Live tab');

  app = pool('POOLC');
  vm.runInThisContext('liveRefreshTimer = 1');
  calls = serve(app, { data: bracket2026() });
  await app.autoResolvePlayIns();
  assert.equal(slot(app).playInResolved, true);
  assert.equal(timers.length, 0, 'all settled');

  app = pool('POOLD');
  calls = serve(app, { data: bracketBeforeFinal() });
  await app.autoResolvePlayIns();
  assert.equal(timers.length, 1);
  vm.runInThisContext('liveRefreshTimer = null'); // left the Live tab
  clock += 5 * 60 * 1000;
  timers[0].fn();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.length, 1, 'no request from a tab that is closed');
});
