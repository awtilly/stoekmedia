const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

// _lastAutoResolve is a script-scope `let` in 70-logic.js (same vm context as this process).
const resetThrottle = () => vm.runInThisContext('_lastAutoResolve = 0');
const throttle = () => vm.runInThisContext('_lastAutoResolve');

/* The real 2026 bracket as ncaa-api returned it (test/fixtures). Its First Four has four final games;
 * 101 is UMBC (16) vs Howard (16) in the region whose first-round slot is bracketPositionId 225, Howard won. */
const bracket2026 = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-bracket-2026.json'), 'utf8'));

const playInTeam = (overrides) => Object.assign({
  id: 'West-16', name: 'UMBC / Howard', seed: 16, region: 'West',
  logo: '', abbr: '', ncaaId: '', color: '', record: '',
  playIn: true, playInResolved: false,
  playInTeams: [
    { name: 'UMBC', abbr: '', ncaaId: 'umbc', logo: '', color: '', record: '' },
    { name: 'Howard', abbr: '', ncaaId: 'howard', logo: '', color: '', record: '' }
  ]
}, overrides || {});

/** fetch stub for the bracket route: answers `data` (or throws when fail), counts calls. */
function bracketFetch(app, data, { fail = false } = {}) {
  const calls = [];
  app.fetch = async (url) => {
    calls.push(url);
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => data };
  };
  return calls;
}

function appWithPlayIn(stateOverrides) {
  const app = createApp(stateOverrides);
  app.S.year = 2026;
  app.S.teams = app.S.teams.filter(t => t.id !== 'West-16').concat([playInTeam()]);
  resetThrottle();
  return app;
}

test('resolvePlayIn: copies the winner onto the bracket slot, keeps id/seed/region, saves and renders', async () => {
  const app = appWithPlayIn();
  await app.resolvePlayIn('West-16', 1);
  const t = app.S.teams.find(x => x.id === 'West-16');
  assert.equal(t.playInResolved, true);
  assert.equal(t.name, 'Howard');
  assert.equal(t.ncaaId, 'howard');
  assert.equal(t.logo, '', 'no logos after the NCAA.com switch');
  assert.equal(t.seed, 16);
  assert.equal(t.region, 'West');
  assert.equal(t.id, 'West-16', 'drafted rosters reference the slot id, so it must not change');
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.__calls.render, 1);
});

test('resolvePlayIn: ignores unknown teams, non-play-in teams, out-of-range indexes and a slot without a pair', async () => {
  const app = appWithPlayIn();
  await app.resolvePlayIn('nope', 0);
  await app.resolvePlayIn('East-1', 0);
  await app.resolvePlayIn('West-16', 2);
  await app.resolvePlayIn('West-16', -1);
  const t = app.S.teams.find(x => x.id === 'West-16');
  assert.equal(t.playInResolved, false);
  assert.equal(t.name, 'UMBC / Howard');
  t.playInTeams = undefined; // a hand-edited slot flagged playIn with no pair must not throw
  await app.resolvePlayIn('West-16', 0);
  assert.equal(t.playInResolved, false);
  assert.equal(app.__calls.saveState, 0);
  assert.equal(app.__calls.render, 0);
});

test('autoResolvePlayIns: settles the slot from the real 2026 bracket with one fetch, then arms the hourly throttle', async () => {
  const app = appWithPlayIn();
  const calls = bracketFetch(app, bracket2026());
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1, 'one bracket fetch, not one scoreboard fetch per date');
  assert.match(calls[0], /\/brackets\/basketball-men\/d1\/2026$/);
  const t = app.S.teams.find(x => x.id === 'West-16');
  assert.equal(t.playInResolved, true);
  assert.equal(t.name, 'Howard');
  assert.ok(throttle() > 0, 'throttle armed after a successful fetch');
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1, 'second call within the hour does not fetch');
});

test('autoResolvePlayIns: a failed fetch leaves the throttle unarmed so the next call tries again', async () => {
  const app = appWithPlayIn();
  const calls = bracketFetch(app, null, { fail: true });
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1);
  assert.equal(throttle(), 0, 'a dead network must not lock auto-resolve out for an hour');
  assert.equal(app.S.teams.find(x => x.id === 'West-16').playInResolved, false);
  bracketFetch(app, bracket2026());
  await app.autoResolvePlayIns();
  assert.equal(app.S.teams.find(x => x.id === 'West-16').playInResolved, true, 'retry after the network is back');
});

test('autoResolvePlayIns: an unfinished First Four game leaves its slot alone; nothing to do when all slots are resolved', async () => {
  const app = appWithPlayIn();
  const data = bracket2026();
  for (const g of data.championships[0].games) {
    if (Math.floor(g.bracketId / 100) === 1) { g.gameState = 'I'; g.statusCodeDisplay = 'live'; g.teams.forEach(x => { x.isWinner = false; }); }
  }
  const calls = bracketFetch(app, data);
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1);
  assert.equal(app.S.teams.find(x => x.id === 'West-16').playInResolved, false);
  // all resolved: no fetch at all
  resetThrottle();
  app.S.teams.find(x => x.id === 'West-16').playInResolved = true;
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 1, 'no slots left: no network call');
});
