const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp } = require('./_harness');
const serverParse = require('../functions/ncaa-parse');

/* Selection Sunday weekend: ncaa.com lists the conference tournament games with a bracketRound (1-6, their own
 * bracket) but an EMPTY bracketId; only NCAA tournament games carry a numeric bracketId. Keying `tournament` on
 * bracketRound as well made every conference semi/final a "tournament" game, so on 3/14-3/15/2026 a replay of the
 * real scoreboards wrote 23 bogus gameResults (push alerts, "UPSET!" flags) and left 8 conference games between two
 * bracket teams waiting in _pendingAdvance, where they would have filled a later slot with the conference result
 * had the two teams met again. The fixture is five untouched games from the proxy: four Big Ten / SEC games from
 * 3/14-3/15 and First Four game 101 (UMBC-Howard, 3/17) as the positive control. */
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-scoreboard-selection-sunday.json'), 'utf8'));
const CONF_IDS = ['6593973', '6593955', '6593746', '6593954'];
const FIRST_FOUR_ID = '6534592';

test('fixture: the conference games carry a bracketRound and no bracketId; the First Four game carries bracketId 101', () => {
  const games = fixture().games.map(w => w.game);
  const conf = games.filter(g => CONF_IDS.includes(String(g.gameID)));
  assert.equal(conf.length, 4);
  for (const g of conf) {
    assert.equal(g.bracketId, '', g.title);
    assert.ok(Number(g.bracketRound) >= 1, g.title + ' bracketRound');
    assert.equal(g.gameState, 'final');
  }
  const ff = games.find(g => g.bracketId === 101);
  assert.ok(ff, 'First Four game present');
  assert.equal(String(ff.gameID), FIRST_FOUR_ID);
});

test('parseScoreboard: a conference tournament game is final and decided but not a tournament game', () => {
  const app = createApp();
  const evs = app.ncaa.parseScoreboard(fixture());
  assert.equal(evs.length, 5);
  for (const e of evs.filter(e => CONF_IDS.includes(e.id))) {
    assert.equal(e.state, 'post', e.name);
    assert.equal(e.completed, true, e.name + ' is still a decided final for the Live tab');
    assert.equal(e.tournament, false, e.name + ' must not be flagged as an NCAA tournament game');
    assert.equal(e.note, '');
  }
  const ff = evs.find(e => e.id === FIRST_FOUR_ID);
  assert.equal(ff.tournament, true, 'First Four game keeps the flag');
  assert.equal(ff.note, 'NCAA Tournament - First Four', 'ncaa.com sends "First Four&#174;"; the entity is stripped so the Live tab does not print it');
});

test('parseScoreboard: bracketRound or championshipId alone never set the tournament flag; a numeric bracketId does', () => {
  const app = createApp();
  const base = fixture().games.find(w => w.game.bracketId === 101).game;
  const variant = (over) => app.ncaa.parseScoreboard({ games: [{ game: Object.assign({}, base, over) }] })[0];
  assert.equal(variant({ bracketId: '', bracketRound: 6, championshipId: '' }).tournament, false, 'bracketRound only');
  assert.equal(variant({ bracketId: '', bracketRound: '', championshipId: 6393 }).tournament, false, 'championshipId only');
  assert.equal(variant({ bracketId: '', bracketRound: '', championshipId: '' }).tournament, false, 'none');
  assert.equal(variant({ bracketId: 707, bracketRound: 7 }).tournament, true, 'numeric bracketId');
  assert.equal(variant({ bracketId: '202', bracketRound: 2 }).tournament, true, 'bracketId as a digit string');
  assert.equal(variant({ bracketId: 0 }).tournament, false, 'zero is not a bracket slot');
});

test('checkGameFinals: the real Selection Sunday games write nothing and leave nothing pending; the First Four final is reported', async () => {
  const app = createApp({ phase: 'live', year: 2026 });
  // A room holding both teams of every conference game plus the First Four winner (the loser went home), keyed by
  // the ncaa.com slugs the parser emits.
  const evs = app.ncaa.parseScoreboard(fixture());
  const slugs = [...new Set(evs.flatMap(e => e.id === FIRST_FOUR_ID ? [e.away.winner ? e.away.ncaaId : e.home.ncaaId] : [e.away.ncaaId, e.home.ncaaId]))];
  slugs.forEach((slug, i) => { app.S.teams[i].ncaaId = slug; app.S.teams[i].name = slug; });
  const writes = [];
  app.roomId = 'room1';
  app.db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: (id) => ({
    get: async () => ({ exists: false }), set: async (d) => { writes.push({ id, ...d }); } }) }) }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
  app.getMyPlayerId = () => 'p1';
  app.syncGames = () => {};
  globalThis.__games = evs; vm.runInThisContext('liveScores = globalThis.__games');
  await app.checkGameFinals();
  assert.deepEqual(writes.map(w => w.id), [FIRST_FOUR_ID], 'only the First Four game becomes a gameResult');
  assert.equal(app.eval('_pendingAdvance.size'), 0, 'no conference game is parked for a later bracket slot');
  assert.equal(app.eval('_reportedFinals.has("6593954")'), false, 'the Big Ten final is not remembered as reported');
});

/* functions/ncaa-parse.js is the server copy of the parser (Joe-only file, see docs/proposed-joe-only-changes.md
 * section 10). During the tournament phones read ITS output from scoreboard/{date}, so it needs the same one-line
 * change or the bug stays live. Marked todo until that line lands; drop the todo option then. */
test('ncaa-parse (server copy): the conference games are not tournament games either', { todo: 'apply docs/proposed-joe-only-changes.md section 10 to functions/ncaa-parse.js' }, () => {
  const evs = serverParse.parseScoreboard(fixture());
  for (const e of evs.filter(e => CONF_IDS.includes(e.id))) assert.equal(e.tournament, false, e.name);
  assert.equal(evs.find(e => e.id === FIRST_FOUR_ID).tournament, true);
});
