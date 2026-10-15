const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

// _lastAutoResolve is a script-scope `let` in 70-logic.js (same vm context as this process).
const resetThrottle = () => vm.runInThisContext('_lastAutoResolve = 0');

const playInTeam = (overrides) => Object.assign({
  id: 'West-16', name: 'Grambling / Montana St', seed: 16, region: 'West',
  logo: '', abbr: '', espnId: '', color: '', record: '',
  playIn: true, playInResolved: false,
  playInTeams: [
    { name: 'Grambling', logo: 'g.png', abbr: 'GRAM', espnId: '101', color: '111', record: '20-12' },
    { name: 'Montana St', logo: 'm.png', abbr: 'MTST', espnId: '102', color: '222', record: '25-9' }
  ]
}, overrides || {});

// Minimal site.api.espn.com scoreboard event.
function espnEvent({ id, away, home, state = 'post', completed = true }) {
  const competitor = (t, homeAway) => ({
    homeAway, winner: t.winner, score: t.score,
    team: { id: t.id, shortDisplayName: t.name, abbreviation: t.abbr }
  });
  return {
    id, shortName: away.abbr + ' @ ' + home.abbr, date: '2027-03-17T00:00Z',
    competitions: [{
      status: { type: { state, completed, name: completed ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS' } },
      notes: [{ headline: "NCAA Men's Basketball Championship - West Region - First Four" }],
      competitors: [competitor(home, 'home'), competitor(away, 'away')]
    }]
  };
}

/** fetch stub: answers `events` on the 17th only, empty payload on other dates; counts calls. */
function scoreboardFetch(app, events, { fail = false } = {}) {
  const calls = [];
  app.fetch = async (url) => {
    calls.push(url);
    if (fail) throw new Error('offline');
    const date = (url.match(/dates=(\d{8})/) || [])[1];
    return { ok: true, json: async () => (date === '20270317' ? { events } : { events: [] }) };
  };
  return calls;
}

function appWithPlayIn(stateOverrides) {
  const app = createApp(stateOverrides);
  app.S.teams = app.S.teams.filter(t => t.id !== 'West-16').concat([playInTeam()]);
  resetThrottle();
  return app;
}

test('teamDisplayName: unresolved play-in shows both names, resolved shows the winner', () => {
  const app = createApp();
  const t = playInTeam();
  assert.equal(app.teamDisplayName(t), 'Grambling / Montana St');
  t.playInResolved = true; t.name = 'Grambling';
  assert.equal(app.teamDisplayName(t), 'Grambling');
  assert.equal(app.teamDisplayName({ name: 'Duke' }), 'Duke');
});

test('resolvePlayIn: copies the winner onto the bracket slot, keeps id/seed/region, saves and renders', async () => {
  const app = appWithPlayIn();
  await app.resolvePlayIn('West-16', 1);
  const t = app.S.teams.find(x => x.id === 'West-16');
  assert.equal(t.playInResolved, true);
  assert.equal(t.name, 'Montana St');
  assert.equal(t.abbr, 'MTST');
  assert.equal(t.espnId, '102');
  assert.equal(t.logo, 'm.png');
  assert.equal(t.record, '25-9');
  assert.equal(t.seed, 16);
  assert.equal(t.region, 'West');
  assert.equal(t.id, 'West-16', 'drafted rosters reference the slot id, so it must not change');
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.__calls.render, 1);
});

test('resolvePlayIn: ignores unknown teams, non-play-in teams and out-of-range winner indexes', async () => {
  const app = appWithPlayIn();
  await app.resolvePlayIn('nope', 0);
  await app.resolvePlayIn('South-1', 0);
  await app.resolvePlayIn('West-16', 7);
  const t = app.S.teams.find(x => x.id === 'West-16');
  assert.equal(t.playInResolved, false);
  assert.equal(t.name, 'Grambling / Montana St');
  assert.equal(app.S.teams.find(x => x.id === 'South-1').name, 'South 1');
  assert.equal(app.__calls.saveState, 0);
});

test('autoResolvePlayIns: a final between the two play-in teams resolves the slot to the flagged winner', async () => {
  const app = appWithPlayIn();
  const calls = scoreboardFetch(app, [espnEvent({
    id: '1',
    away: { id: '101', name: 'Grambling', abbr: 'GRAM', score: '71', winner: false },
    home: { id: '102', name: 'Montana St', abbr: 'MTST', score: '78', winner: true }
  })]);
  await app.autoResolvePlayIns();
  const t = app.S.teams.find(x => x.id === 'West-16');
  assert.equal(t.playInResolved, true);
  assert.equal(t.name, 'Montana St');
  assert.equal(calls.length, 8, 'checks March 14-21 of S.year');
  assert.ok(calls.every(u => /dates=202703(1[4-9]|2[01])/.test(u)), calls.join('\n'));
});

test('autoResolvePlayIns: games still in progress, or between other teams, do not resolve anything', async () => {
  const app = appWithPlayIn();
  scoreboardFetch(app, [
    espnEvent({ id: '1', state: 'in', completed: false,
      away: { id: '101', name: 'Grambling', abbr: 'GRAM', score: '40' },
      home: { id: '102', name: 'Montana St', abbr: 'MTST', score: '38' } }),
    espnEvent({ id: '2',
      away: { id: '101', name: 'Grambling', abbr: 'GRAM', score: '60', winner: true },
      home: { id: '999', name: 'Someone', abbr: 'SOME', score: '50', winner: false } })
  ]);
  await app.autoResolvePlayIns();
  assert.equal(app.S.teams.find(x => x.id === 'West-16').playInResolved, false);
  assert.equal(app.__calls.saveState, 0);
});

test('autoResolvePlayIns: with no winner flags the score decides; a tie or missing score leaves it to the admin', async () => {
  let app = appWithPlayIn();
  scoreboardFetch(app, [espnEvent({ id: '1',
    away: { id: '101', name: 'Grambling', abbr: 'GRAM', score: '80' },
    home: { id: '102', name: 'Montana St', abbr: 'MTST', score: '79' } })]);
  await app.autoResolvePlayIns();
  assert.equal(app.S.teams.find(x => x.id === 'West-16').name, 'Grambling', 'away won on score');

  app = appWithPlayIn();
  scoreboardFetch(app, [espnEvent({ id: '1',
    away: { id: '101', name: 'Grambling', abbr: 'GRAM', score: '' },
    home: { id: '102', name: 'Montana St', abbr: 'MTST', score: '' } })]);
  await app.autoResolvePlayIns();
  assert.equal(app.S.teams.find(x => x.id === 'West-16').playInResolved, false, 'no flag and no score: do not guess home');
});

test('autoResolvePlayIns: a failed fetch does not arm the hourly throttle, a successful one does', async () => {
  const app = appWithPlayIn();
  const failed = scoreboardFetch(app, [], { fail: true });
  await app.autoResolvePlayIns();
  assert.equal(failed.length, 8, 'first attempt fetched');
  const again = scoreboardFetch(app, []);
  await app.autoResolvePlayIns();
  assert.equal(again.length, 8, 'retried immediately because nothing had been fetched successfully');
  const third = scoreboardFetch(app, []);
  await app.autoResolvePlayIns();
  assert.equal(third.length, 0, 'throttled for an hour after a real answer');
});

test('autoResolvePlayIns: nothing unresolved means no network call at all', async () => {
  const app = createApp();
  resetThrottle();
  const calls = scoreboardFetch(app, []);
  await app.autoResolvePlayIns();
  assert.equal(calls.length, 0);
});
