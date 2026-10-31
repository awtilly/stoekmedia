const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./_harness');

/* Fixtures are trimmed copies of what ncaa-api returned for the real 2026 tournament
 * (bracket: all 67 games; scoreboard: three second-round finals from 3/21 plus two
 * regular-season games from 2/14 that carry no bracketId). */
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const bracket2026 = () => fixture('ncaa-bracket-2026.json');
const scoreboardSample = () => fixture('ncaa-scoreboard-sample.json');

/** Minimal ncaa.com scoreboard game: { game: {...} } */
function ncaaGame({ id = '1', state = 'final', away, home, bracketId, round, period = 'FINAL', clock = '0:00', epoch = '1773850200', network = 'CBS', startTime = '7:10 PM ET' }) {
  const side = t => ({ score: t.score == null ? '' : String(t.score), winner: !!t.winner, seed: t.seed == null ? '' : String(t.seed), rank: '',
    names: { char6: t.abbr || '', short: t.name, seo: t.seo || t.name.toLowerCase(), full: '' } });
  const g = { gameID: id, gameState: state, currentPeriod: period, contestClock: clock, startTimeEpoch: epoch, startTime, network,
    title: away.name + ' ' + home.name, url: '/game/' + id, finalMessage: state === 'final' ? 'FINAL' : '',
    away: side(away), home: side(home) };
  if (bracketId) { g.bracketId = bracketId; g.bracketRound = Math.floor(bracketId / 100); g.championshipId = 6393;
    g.championshipGame = { round: { roundNumber: g.bracketRound, title: round || 'First Round' } }; }
  else { g.bracketId = ''; g.bracketRound = ''; }
  return { game: g };
}

/* ── parseScoreboard ── */

test('parseScoreboard: returns [] for null, empty or foreign payloads', () => {
  const app = createApp();
  assert.deepEqual(app.ncaa.parseScoreboard(null), []);
  assert.deepEqual(app.ncaa.parseScoreboard({}), []);
  assert.deepEqual(app.ncaa.parseScoreboard({ games: [] }), []);
  assert.deepEqual(app.ncaa.parseScoreboard({ events: [{ id: 'espn-shaped' }] }), [], 'the old ESPN shape is not a scoreboard');
});

test('parseScoreboard: real 2026 payload keeps away/home, scores, seeds, winner and the tournament flag', () => {
  const app = createApp();
  const games = app.ncaa.parseScoreboard(scoreboardSample());
  assert.equal(games.length, 5);
  const g = games.find(x => x.id === '6534640');
  assert.equal(g.away.name, 'Saint Louis');
  assert.equal(g.home.name, 'Michigan');
  assert.equal(g.away.abbr, 'ST LOU');
  assert.equal(g.home.ncaaId, 'michigan');
  assert.equal(g.away.score, '72');
  assert.equal(g.home.score, '95');
  assert.equal(g.away.seed, 9);
  assert.equal(g.home.seed, 1);
  assert.equal(g.home.winner, true);
  assert.equal(g.away.winner, false);
  assert.equal(g.state, 'post');
  assert.equal(g.completed, true);
  assert.equal(g.tournament, true);
  assert.equal(g.note, 'NCAA Tournament - Second Round');
  assert.equal(g.broadcast, 'CBS');
  assert.equal(g.date, '2026-03-21T16:10:00.000Z');
  assert.equal(g.away.logo, '', 'no third-party logos');
  const reg = games.find(x => x.id === '6501921');
  assert.equal(reg.tournament, false, 'a regular-season game has no bracketId');
  assert.equal(reg.note, '');
  assert.equal(reg.away.seed, undefined);
  assert.equal(reg.completed, true);
  assert.equal(reg.home.winner, true, 'Notre Dame 89, Georgia Tech 74');
});

test('parseScoreboard: live, pre and final states map to in/pre/post with the clock in the detail', () => {
  const app = createApp();
  const [live, pre, fin] = app.ncaa.parseScoreboard({ games: [
    ncaaGame({ id: 'l', state: 'live', period: '2ND', clock: '4:32', away: { name: 'A', score: 40 }, home: { name: 'B', score: 38 } }),
    ncaaGame({ id: 'p', state: 'pre', period: '', clock: '', away: { name: 'C' }, home: { name: 'D' } }),
    ncaaGame({ id: 'f', state: 'final', away: { name: 'E', score: 70, winner: true }, home: { name: 'F', score: 60 } })
  ] });
  assert.equal(live.state, 'in');
  assert.equal(live.shortDetail, '2ND 4:32');
  assert.equal(live.period, 2);
  assert.equal(live.completed, false);
  assert.equal(live.away.winner, undefined, 'nobody is crowned while the game is on');
  assert.equal(pre.state, 'pre');
  assert.equal(pre.shortDetail, '7:10 PM ET');
  assert.equal(pre.away.score, '');
  assert.equal(fin.state, 'post');
  assert.equal(fin.completed, true);
  assert.equal(fin.away.winner, true);
});

test('parseScoreboard: a final with no winner flag takes the winner from the score', () => {
  const app = createApp();
  const [g] = app.ncaa.parseScoreboard({ games: [ncaaGame({ away: { name: 'A', score: 70 }, home: { name: 'B', score: 81 } })] });
  assert.equal(g.completed, true);
  assert.equal(g.home.winner, true);
  assert.equal(g.away.winner, false);
});

test('parseScoreboard: a postponed or tied "final" is listed under Final but is not a completed final', () => {
  const app = createApp();
  const [p, t, n] = app.ncaa.parseScoreboard({ games: [
    ncaaGame({ id: 'p', state: 'postponed', away: { name: 'A', score: 0 }, home: { name: 'B', score: 0 } }),
    ncaaGame({ id: 't', state: 'final', away: { name: 'C', score: 55 }, home: { name: 'D', score: 55 } }),
    ncaaGame({ id: 'n', state: 'final', away: { name: 'E' }, home: { name: 'F' } })
  ] });
  for (const g of [p, t, n]) {
    assert.equal(g.state, 'post');
    assert.equal(g.completed, false);
    assert.ok(!g.away.winner && !g.home.winner, 'nobody is crowned');
  }
});

test('parseScoreboard: drops games missing a team and unknown wrappers', () => {
  const app = createApp();
  const half = ncaaGame({ id: 'h', away: { name: 'A' }, home: { name: 'B' } });
  half.game.home = { names: {} };
  const ok = ncaaGame({ id: 'ok', away: { name: 'A' }, home: { name: 'B' } });
  assert.deepEqual(app.ncaa.parseScoreboard({ games: [half, {}, null, ok] }).map(g => g.id), ['ok']);
});

/* ── fetchScoreboard / fetchBracket go through the proxy function ── */

test('fetchScoreboard: asks the ncaa proxy for the YYYY/MM/DD route and returns null on any failure', async () => {
  const app = createApp();
  const urls = [];
  app.fetch = async (u) => { urls.push(u); return { ok: true, json: async () => ({ games: [] }) }; };
  assert.deepEqual(await app.ncaa.fetchScoreboard('20270318'), { games: [] });
  assert.equal(urls[0], 'https://us-central1-march-madness-snake-draft.cloudfunctions.net/ncaa/scoreboard/basketball-men/d1/2027/03/18');
  app.fetch = async () => ({ ok: false, status: 502 });
  assert.equal(await app.ncaa.fetchScoreboard('20270318'), null);
  app.fetch = async () => { throw new Error('offline'); };
  assert.equal(await app.ncaa.fetchScoreboard('20270318'), null);
  app.fetch = async (u) => { urls.push(u); return { ok: true, json: async () => ({ championships: [] }) }; };
  await app.ncaa.fetchBracket(2027);
  assert.equal(urls[urls.length - 1], 'https://us-central1-march-madness-snake-draft.cloudfunctions.net/ncaa/brackets/basketball-men/d1/2027');
});

/* ── fetchTournamentTeams (bracket import) ── */

test('fetchTournamentTeams: the real 2026 bracket yields 64 slots, 16 per region, with NCAA.com slugs and no logos', async () => {
  const app = createApp();
  app.S.year = 2026;
  app.fetch = async () => ({ ok: true, json: async () => bracket2026() });
  const teams = await app.ncaa.fetchTournamentTeams();
  assert.equal(teams.length, 64);
  for (const r of app.REGIONS) assert.equal(teams.filter(t => t.region === r).length, 16, r);
  assert.deepEqual(teams.slice(0, 3).map(t => t.region + ':' + t.seed + ':' + t.name), ['South:1:Florida', 'South:2:Houston', 'South:3:Illinois']);
  const duke = teams.find(t => t.name === 'Duke');
  assert.equal(duke.region, 'East');
  assert.equal(duke.seed, 1);
  assert.equal(duke.ncaaId, 'duke');
  assert.equal(duke.logo, '');
  // every First Four was final in this payload, so the winners sit in the slots and nothing is a play-in
  assert.equal(teams.filter(t => t.playIn).length, 0);
  assert.equal(teams.find(t => t.region === 'Midwest' && t.seed === 16).name, 'Howard');
  assert.equal(teams.find(t => t.region === 'West' && t.seed === 11).name, 'Texas');
});

test('fetchTournamentTeams: a First Four game that is not final becomes one unresolved play-in entry', async () => {
  const app = createApp();
  app.S.year = 2026;
  const data = bracket2026();
  const champ = data.championships[0];
  const ff = champ.games.find(g => g.bracketId === 101); // UMBC vs Howard -> Midwest 16 seed
  ff.gameState = 'P'; ff.statusCodeDisplay = 'pre'; ff.teams.forEach(t => { t.isWinner = false; t.score = ''; });
  app.fetch = async () => ({ ok: true, json: async () => data });
  const teams = await app.ncaa.fetchTournamentTeams();
  assert.equal(teams.length, 64);
  const slot = teams.find(t => t.region === 'Midwest' && t.seed === 16);
  assert.equal(slot.playIn, true);
  assert.equal(slot.playInResolved, false);
  assert.deepEqual(slot.playInTeams.map(t => t.name).sort(), ['Howard', 'UMBC']);
  assert.deepEqual(slot.playInTeams.map(t => t.ncaaId).sort(), ['howard', 'umbc']);
  assert.equal(slot.name, 'UMBC / Howard');
  assert.equal(slot.ncaaId, '');
});

test('fetchTournamentTeams: returns [] before the bracket is published (proxy answers an empty championships list or null)', async () => {
  const app = createApp();
  app.S.year = 2027;
  app.fetch = async () => ({ ok: true, json: async () => ({ championships: [], upstreamStatus: 404 }) });
  assert.deepEqual(await app.ncaa.fetchTournamentTeams(), []);
  app.fetch = async () => ({ ok: false, status: 502 });
  assert.deepEqual(await app.ncaa.fetchTournamentTeams(), []);
});

test('firstFourWinners: lists decided First Four games by NCAA.com slug', () => {
  const app = createApp();
  const w = app.ncaa.firstFourWinners(bracket2026());
  assert.equal(w.length, 4);
  const umbc = w.find(x => x.ncaaIds.includes('umbc'));
  assert.deepEqual(umbc, { ncaaIds: ['umbc', 'howard'], winner: 'howard' });
  assert.deepEqual(app.ncaa.firstFourWinners(null), []);
});

test('autoResolvePlayIns: settles an unresolved play-in slot from a final First Four game', async () => {
  const app = createApp();
  app.S.year = 2026;
  app.S.teams = [{ id: 'mw16', name: 'UMBC / Howard', seed: 16, region: 'Midwest', ncaaId: '', abbr: '', logo: '', record: '',
    playIn: true, playInResolved: false, playInTeams: [{ name: 'UMBC', ncaaId: 'umbc', abbr: '' }, { name: 'Howard', ncaaId: 'howard', abbr: '' }] }];
  app.fetch = async () => ({ ok: true, json: async () => bracket2026() });
  app.eval('_lastAutoResolve = 0');
  await app.autoResolvePlayIns();
  const t = app.S.teams[0];
  assert.equal(t.playInResolved, true);
  assert.equal(t.name, 'Howard');
  assert.equal(t.ncaaId, 'howard');
  assert.equal(t.logo, '');
  assert.equal(app.__calls.saveState, 1);
});

/* ── checkGameFinals keys on the tournament flag and ncaaId ── */

test('checkGameFinals: a postponed tournament game never advances the bracket or writes a result', async () => {
  const vm = require('node:vm');
  const app = createApp({ players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }] });
  app.roomId = 'R';
  app.getMyPlayerId = () => 'p1';
  let dbCalls = 0;
  app.db = { collection: () => { dbCalls++; return { doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) }) }) }; } };
  const t = id => app.S.teams.find(x => x.id === id);
  const g = ncaaGame({ id: 'pp', state: 'postponed', bracketId: 201,
    away: { name: 'S16', seo: t('South-16').ncaaId, seed: 16, score: 0 }, home: { name: 'S1', seo: t('South-1').ncaaId, seed: 1, score: 0 } });
  vm.runInThisContext('(v) => { liveScores = v; }')(app.ncaa.parseScoreboard({ games: [g] }));
  await app.checkGameFinals();
  assert.equal(app.S.bracket.South[0], null);
  assert.equal(dbCalls, 0);
  assert.equal(app.__calls.render, 0);
});

test('checkGameFinals: a real-shaped tournament final advances the slot of the two matching ncaaIds', async () => {
  const vm = require('node:vm');
  const app = createApp({ players: [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }] });
  app.roomId = 'R';
  app.getMyPlayerId = () => 'p1';
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.syncGames = () => {};
  const writes = [];
  app.db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: (id) => ({ get: async () => ({ exists: false }), set: async (d) => { writes.push({ id, ...d }); } }) }) }) }) };
  const t = id => app.S.teams.find(x => x.id === id);
  const g = ncaaGame({ id: 'r1', state: 'final', bracketId: 201,
    away: { name: 'S16', seo: t('South-16').ncaaId, seed: 16, score: 60 }, home: { name: 'S1', seo: t('South-1').ncaaId, seed: 1, score: 80, winner: true } });
  vm.runInThisContext('(v) => { liveScores = v; }')(app.ncaa.parseScoreboard({ games: [g] }));
  await app.checkGameFinals();
  assert.equal(app.S.bracket.South[0], 'South-1');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].winnerName, 'S1');
  assert.equal(writes[0].isUpset, false);
});
