const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, finalGame } = require('./_harness');

const team = (app, id) => app.S.teams.find(t => t.id === id);

function fourRegionWinners(b) {
  b.South[14] = 'South-1'; b.East[14] = 'East-1'; b.Midwest[14] = 'Midwest-1'; b.West[14] = 'West-1';
}

test('getTeamForSlot: Round of 64 pairings follow the standard 1-16 ... 2-15 layout', () => {
  const app = createApp();
  assert.equal(app.getTeamForSlot('South', 0, 0).seed, 1);
  assert.equal(app.getTeamForSlot('South', 0, 1).seed, 16);
  assert.equal(app.getTeamForSlot('South', 2, 0).seed, 5);
  assert.equal(app.getTeamForSlot('South', 2, 1).seed, 12);
  assert.equal(app.getTeamForSlot('South', 7, 0).seed, 2);
  assert.equal(app.getTeamForSlot('South', 7, 1).seed, 15);
});

test('getTeamForSlot: later rounds are fed by earlier winners and are null until decided', () => {
  const app = createApp();
  assert.equal(app.getTeamForSlot('East', 8, 0), null);
  app.S.bracket.East[0] = 'East-16';
  app.S.bracket.East[1] = 'East-9';
  assert.equal(app.getTeamForSlot('East', 8, 0).id, 'East-16');
  assert.equal(app.getTeamForSlot('East', 8, 1).id, 'East-9');
  assert.equal(app.getTeamForSlot('East', 12, 0), null);
});

test('syncGames: assigns rounds 1-4 by game index, 5 for semis, 6 for the title game', () => {
  const app = createApp();
  const b = app.S.bracket;
  b.West[0] = 'West-1'; b.West[1] = 'West-8'; b.West[8] = 'West-1';
  b.West[2] = 'West-5'; b.West[3] = 'West-4'; b.West[9] = 'West-5'; b.West[12] = 'West-1';
  b.West[4] = 'West-6'; b.West[5] = 'West-3'; b.West[10] = 'West-3';
  b.West[6] = 'West-7'; b.West[7] = 'West-2'; b.West[11] = 'West-2'; b.West[13] = 'West-2';
  b.West[14] = 'West-1';
  b.Midwest[14] = 'Midwest-1'; b.South[14] = 'South-1'; b.East[14] = 'East-1';
  b.ff[1] = 'West-1'; b.ff[0] = 'South-1'; b.ff[2] = 'West-1';
  app.syncGames();
  const byId = Object.fromEntries(app.S.games.map(g => [g.id, g]));
  assert.equal(byId['West_0'].round, 1);
  assert.equal(byId['West_8'].round, 2);
  assert.equal(byId['West_12'].round, 3);
  assert.equal(byId['West_14'].round, 4);
  assert.equal(byId['ff_1'].round, 5);
  assert.deepEqual(byId['champ'], { id: 'champ', round: 6, t1: 'South-1', t2: 'West-1', wid: 'West-1' });
  // Region winners whose feeders are empty do not produce a game
  assert.equal(byId['South_14'], undefined);
});

test('advanceTeam: fills the slot, syncs games, persists, and is a no-op when re-picking the same winner', async () => {
  const app = createApp();
  await app.advanceTeam('South', 0, 'South-16');
  assert.equal(app.S.bracket.South[0], 'South-16');
  assert.equal(app.S.games.length, 1);
  assert.equal(app.__calls.saveState, 1);
  await app.advanceTeam('South', 0, 'South-16');
  assert.equal(app.__calls.saveState, 1, 'same winner should not write again');
});

test('advanceTeam: changing an earlier winner clears every downstream pick that depended on it', async () => {
  const app = createApp();
  const b = app.S.bracket;
  b.South[0] = 'South-1'; b.South[1] = 'South-8'; b.South[8] = 'South-1';
  b.South[2] = 'South-5'; b.South[3] = 'South-4'; b.South[9] = 'South-4';
  b.South[12] = 'South-1';
  await app.advanceTeam('South', 0, 'South-16');
  assert.equal(b.South[0], 'South-16');
  assert.equal(b.South[8], null, 'R32 winner depended on the 1 seed');
  assert.equal(b.South[12], null, 'Sweet 16 winner depended on the 1 seed');
  assert.equal(b.South[9], 'South-4', 'unrelated branch untouched');
  assert.equal(b.South[1], 'South-8', 'sibling R64 game untouched');
});

test('advanceTeam: a new region winner invalidates a Final Four pick and the champion', async () => {
  const app = createApp();
  const b = app.S.bracket;
  fourRegionWinners(b);
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1'; b.ff[2] = 'South-1';
  await app.advanceTeam('South', 14, 'South-2');
  assert.equal(b.ff[0], null);
  assert.equal(b.ff[2], null);
  assert.equal(b.ff[1], 'West-1', 'other semifinal untouched');
});

test('advanceFF: picking a new semifinal winner clears a champion that no longer appears in the final', async () => {
  const app = createApp();
  const b = app.S.bracket;
  fourRegionWinners(b);
  await app.advanceFF(0, 'South-1');
  await app.advanceFF(1, 'West-1');
  await app.advanceFF(2, 'South-1');
  assert.equal(b.ff[2], 'South-1');
  await app.advanceFF(0, 'East-1');
  assert.equal(b.ff[0], 'East-1');
  assert.equal(b.ff[2], null);
  assert.equal(b.ff[1], 'West-1');
});

test('clearBracketGame: clearing a region winner cascades through the Final Four', async () => {
  const app = createApp();
  const b = app.S.bracket;
  fourRegionWinners(b);
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1'; b.ff[2] = 'South-1';
  await app.clearBracketGame('South', 14);
  assert.equal(b.South[14], null);
  assert.equal(b.ff[0], null);
  assert.equal(b.ff[2], null);
  assert.equal(b.ff[1], 'West-1');
});

test('clearFFGame: clearing a semifinal also clears the champion; clearing the champion alone leaves semis', async () => {
  const app = createApp();
  const b = app.S.bracket;
  b.ff[0] = 'South-1'; b.ff[1] = 'West-1'; b.ff[2] = 'West-1';
  await app.clearFFGame(2);
  assert.deepEqual(b.ff, ['South-1', 'West-1', null]);
  b.ff[2] = 'West-1';
  await app.clearFFGame(1);
  assert.deepEqual(b.ff, ['South-1', null, null]);
});

test('autoAdvanceBracket: a reported final fills the matching Round of 64 slot', () => {
  const app = createApp();
  const g = finalGame(team(app, 'South-16'), team(app, 'South-1'), team(app, 'South-16'));
  assert.equal(app.autoAdvanceBracket(g), true);
  assert.equal(app.S.bracket.South[0], 'South-16');
});

test('autoAdvanceBracket: ignores games that are not a current bracket matchup or are already filled', () => {
  const app = createApp();
  // 1 vs 8 is not a R64 pairing and R32 game 8 has no feeders yet
  const notYet = finalGame(team(app, 'South-1'), team(app, 'South-8'), team(app, 'South-1'));
  assert.equal(app.autoAdvanceBracket(notYet), false);
  app.S.bracket.South[0] = 'South-1';
  const again = finalGame(team(app, 'South-1'), team(app, 'South-16'), team(app, 'South-16'));
  assert.equal(app.autoAdvanceBracket(again), false, 'slot already decided');
  assert.equal(app.S.bracket.South[0], 'South-1', 'existing pick preserved');
});

test('autoAdvanceBracket: advances Round of 32 once both feeders are decided', () => {
  const app = createApp();
  app.S.bracket.South[0] = 'South-1';
  app.S.bracket.South[1] = 'South-9';
  const g = finalGame(team(app, 'South-9'), team(app, 'South-1'), team(app, 'South-9'));
  assert.equal(app.autoAdvanceBracket(g), true);
  assert.equal(app.S.bracket.South[8], 'South-9');
});

test('autoAdvanceBracket: handles Final Four semifinals and the championship', () => {
  const app = createApp();
  const b = app.S.bracket;
  b.South[14] = 'South-1'; b.East[14] = 'East-2'; b.Midwest[14] = 'Midwest-3'; b.West[14] = 'West-4';
  assert.equal(app.autoAdvanceBracket(finalGame(team(app, 'East-2'), team(app, 'South-1'), team(app, 'East-2'))), true);
  assert.equal(b.ff[0], 'East-2');
  assert.equal(app.autoAdvanceBracket(finalGame(team(app, 'West-4'), team(app, 'Midwest-3'), team(app, 'Midwest-3'))), true);
  assert.equal(b.ff[1], 'Midwest-3');
  assert.equal(app.autoAdvanceBracket(finalGame(team(app, 'Midwest-3'), team(app, 'East-2'), team(app, 'East-2'))), true);
  assert.equal(b.ff[2], 'East-2');
});

test('autoAdvanceBracket: returns false for teams not in the room', () => {
  const app = createApp();
  const stranger = { id: 'x', name: 'Nobody', seed: 1, region: 'South', espnId: 'e-nobody', abbr: 'NB' };
  const g = finalGame(stranger, team(app, 'South-16'), stranger);
  assert.equal(app.autoAdvanceBracket(g), false);
});
