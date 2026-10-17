const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

// Minimal shape of an ESPN site.api.espn.com scoreboard event.
function espnEvent({ id, note, away, home, state = 'post', completed = true, broadcast = 'CBS' }) {
  const competitor = (t, homeAway) => ({
    homeAway,
    winner: t.winner,
    score: t.score,
    curatedRank: t.seed ? { current: t.seed } : undefined,
    records: [{ summary: t.record || '20-10' }],
    team: { id: t.id, shortDisplayName: t.name, displayName: t.name + ' Univ', abbreviation: t.abbr, logo: 'l.png', color: '000' }
  });
  return {
    id, shortName: away.abbr + ' @ ' + home.abbr, name: away.name + ' at ' + home.name, date: '2027-03-18T17:00Z',
    competitions: [{
      status: { type: { state, completed, name: completed ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', detail: 'Final', shortDetail: 'Final' }, displayClock: '0:00', period: 2 },
      notes: note ? [{ headline: note }] : [],
      broadcasts: broadcast ? [{ names: [broadcast] }] : [],
      venue: { fullName: 'Arena' },
      competitors: [competitor(home, 'home'), competitor(away, 'away')] // home listed first on purpose
    }]
  };
}

test('parseScoreboardEvents: returns [] for null or empty payloads', () => {
  const app = createApp();
  assert.deepEqual(app.espn.parseScoreboardEvents(null), []);
  assert.deepEqual(app.espn.parseScoreboardEvents({}), []);
  assert.deepEqual(app.espn.parseScoreboardEvents({ events: [] }), []);
});

test('parseScoreboardEvents: puts the away team first regardless of ESPN competitor order', () => {
  const app = createApp();
  const data = { events: [espnEvent({
    id: '1', note: "NCAA Men's Basketball Championship - East Region - 1st Round",
    away: { id: '10', name: 'Oakland', abbr: 'OAK', seed: 14, score: '80', winner: true },
    home: { id: '20', name: 'Kentucky', abbr: 'UK', seed: 3, score: '76', winner: false }
  })] };
  const [g] = app.espn.parseScoreboardEvents(data);
  assert.equal(g.away.name, 'Oakland');
  assert.equal(g.home.name, 'Kentucky');
  assert.equal(g.away.winner, true);
  assert.equal(g.away.seed, 14);
  assert.equal(g.home.seed, 3);
  assert.equal(g.state, 'post');
  assert.equal(g.completed, true);
  assert.equal(g.broadcast, 'CBS');
  assert.equal(g.venue, 'Arena');
  assert.match(g.note, /East Region/);
});

test('parseScoreboardEvents: drops events with no competition block', () => {
  const app = createApp();
  const data = { events: [{ id: 'x' }, espnEvent({ id: '2', away: { id: '1', name: 'A', abbr: 'A' }, home: { id: '2', name: 'B', abbr: 'B' } })] };
  assert.equal(app.espn.parseScoreboardEvents(data).length, 1);
});

test('fetchTournamentTeams: only keeps NCAA Championship regional games and ignores conference tournaments', async () => {
  const app = createApp();
  app.S.year = 2027;
  const ncaa = espnEvent({
    id: '1', note: "NCAA Men's Basketball Championship - South Region - 1st Round",
    away: { id: '101', name: 'Vermont', abbr: 'UVM', seed: 15 },
    home: { id: '102', name: 'Duke', abbr: 'DUKE', seed: 2 }
  });
  const bigEast = espnEvent({
    id: '2', note: 'Big East Tournament - Championship',
    away: { id: '201', name: 'UConn', abbr: 'CONN', seed: 1 },
    home: { id: '202', name: 'Marquette', abbr: 'MARQ', seed: 3 }
  });
  const finalFour = espnEvent({
    id: '3', note: "NCAA Men's Basketball Championship - Final Four",
    away: { id: '301', name: 'Houston', abbr: 'HOU', seed: 1 },
    home: { id: '302', name: 'Purdue', abbr: 'PUR', seed: 1 }
  });
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [ncaa, bigEast, finalFour] }) }; };
  const teams = await app.espn.fetchTournamentTeams();
  assert.equal(fetches, 12, 'probes March 14-25');
  assert.deepEqual(teams.map(t => t.name + ':' + t.seed + ':' + t.region), ['Duke:2:South', 'Vermont:15:South']);
  assert.equal(teams[0].espnId, '102');
});

test('fetchTournamentTeams: two teams on the same seed line become one unresolved play-in entry', async () => {
  const app = createApp();
  const a = espnEvent({
    id: '1', note: "NCAA Men's Basketball Championship - West Region - First Four",
    away: { id: '1', name: 'Grambling', abbr: 'GRAM', seed: 16 },
    home: { id: '2', name: 'Montana St', abbr: 'MTST', seed: 16 }
  });
  app.fetch = async () => ({ ok: true, json: async () => ({ events: [a] }) });
  const teams = await app.espn.fetchTournamentTeams();
  assert.equal(teams.length, 1);
  assert.equal(teams[0].playIn, true);
  assert.equal(teams[0].playInResolved, false);
  // pair order follows ESPN competitor order, so compare as sets
  assert.deepEqual(teams[0].name.split(' / ').sort(), ['Grambling', 'Montana St']);
  assert.deepEqual(teams[0].playInTeams.map(t => t.abbr).sort(), ['GRAM', 'MTST']);
});

test('fetchTournamentTeams: tolerates failed dates and sorts by region order then seed', async () => {
  const app = createApp();
  const mk = (id, name, seed, region) => espnEvent({
    id, note: "NCAA Men's Basketball Championship - " + region + ' Region - 1st Round',
    away: { id: id + 'a', name, abbr: name.toUpperCase().slice(0, 4), seed },
    home: { id: id + 'b', name: 'Foe' + id, abbr: 'F' + id, seed: 17 - seed }
  });
  let n = 0;
  app.fetch = async () => {
    n++;
    if (n % 2 === 0) return { ok: false };
    return { ok: true, json: async () => ({ events: [mk('w', 'Gonzaga', 4, 'West'), mk('s', 'Auburn', 1, 'South'), mk('e', 'Iowa', 9, 'East')] }) };
  };
  const teams = await app.espn.fetchTournamentTeams();
  assert.deepEqual(teams.map(t => t.region), ['South', 'South', 'East', 'East', 'West', 'West']);
  assert.deepEqual(teams.filter(t => t.region === 'South').map(t => t.seed), [1, 16]);
});

/* ── Final-detection guards (parseScoreboardEvents) ── */

test('parseScoreboardEvents: a final with no winner flag takes the winner from the score', () => {
  const app = createApp();
  const [g] = app.espn.parseScoreboardEvents({ events: [espnEvent({
    id: '3', away: { id: '1', name: 'A', abbr: 'A', score: '70' }, home: { id: '2', name: 'B', abbr: 'B', score: '81' }
  })] });
  assert.equal(g.completed, true);
  assert.equal(g.home.winner, true);
  assert.equal(g.away.winner, false);
});

test('parseScoreboardEvents: a "post" game with no decided winner is not a completed final', () => {
  const app = createApp();
  const postponed = espnEvent({ id: '4', away: { id: '1', name: 'A', abbr: 'A', score: '0' }, home: { id: '2', name: 'B', abbr: 'B', score: '0' } });
  postponed.competitions[0].status.type.name = 'STATUS_POSTPONED';
  const noScores = espnEvent({ id: '5', away: { id: '3', name: 'C', abbr: 'C' }, home: { id: '4', name: 'D', abbr: 'D' } });
  const [p, n] = app.espn.parseScoreboardEvents({ events: [postponed, noScores] });
  for (const g of [p, n]) {
    assert.equal(g.state, 'post', 'still listed under Final for display');
    assert.equal(g.completed, false);
    assert.ok(!g.away.winner && !g.home.winner, 'nobody is crowned');
  }
});

test('parseScoreboardEvents: an explicit ESPN winner flag beats the score', () => {
  const app = createApp();
  const [g] = app.espn.parseScoreboardEvents({ events: [espnEvent({
    id: '6', away: { id: '1', name: 'A', abbr: 'A', score: '2', winner: true }, home: { id: '2', name: 'B', abbr: 'B', score: '0', winner: false }
  })] });
  assert.equal(g.away.winner, true);
  assert.equal(g.completed, true);
});

test('parseScoreboardEvents: drops events with fewer than two competitors', () => {
  const app = createApp();
  const one = espnEvent({ id: '7', away: { id: '1', name: 'A', abbr: 'A' }, home: { id: '2', name: 'B', abbr: 'B' } });
  one.competitions[0].competitors = one.competitions[0].competitors.slice(0, 1);
  const none = espnEvent({ id: '8', away: { id: '1', name: 'A', abbr: 'A' }, home: { id: '2', name: 'B', abbr: 'B' } });
  none.competitions[0].competitors = [];
  const ok = espnEvent({ id: '9', away: { id: '1', name: 'A', abbr: 'A' }, home: { id: '2', name: 'B', abbr: 'B' } });
  assert.deepEqual(app.espn.parseScoreboardEvents({ events: [one, none, ok] }).map(g => g.id), ['9']);
});

test('checkGameFinals: a postponed tournament game never advances the bracket or writes a result', async () => {
  const vm = require('node:vm');
  const app = createApp({ players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }] });
  app.roomId = 'R';
  app.getMyPlayerId = () => 'p1';
  let dbCalls = 0;
  app.db = { collection: () => { dbCalls++; return { doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) }) }) }; } };
  const t = id => app.S.teams.find(x => x.id === id);
  const ev = espnEvent({
    id: 'pp', away: { id: t('South-16').espnId, name: 'S16', abbr: 'S16', score: '0' },
    home: { id: t('South-1').espnId, name: 'S1', abbr: 'S1', score: '0' }
  });
  ev.competitions[0].status.type.name = 'STATUS_POSTPONED';
  vm.runInThisContext('(v) => { liveScores = v; }')(app.espn.parseScoreboardEvents({ events: [ev] }));
  await app.checkGameFinals();
  assert.equal(app.S.bracket.South[0], null);
  assert.equal(dbCalls, 0);
  assert.equal(app.__calls.render, 0);
});
