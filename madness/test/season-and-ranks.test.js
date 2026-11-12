const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

test('tournamentYear: January to April is this year, May onward is next March', () => {
  const app = createApp();
  assert.equal(app.tournamentYear(new Date(2027, 0, 15)), 2027);
  assert.equal(app.tournamentYear(new Date(2027, 3, 7)), 2027);   // title game week
  assert.equal(app.tournamentYear(new Date(2026, 4, 1)), 2027);
  assert.equal(app.tournamentYear(new Date(2026, 10, 10)), 2027); // a room created in November
});

test('withRanks: players level on points share a rank and the next rank skips', () => {
  const app = createApp();
  const ranked = app.withRanks([{ tot: 92 }, { tot: 88 }, { tot: 55 }, { tot: 55 }, { tot: 30 }]);
  assert.deepEqual(ranked.map(s => s.rank), [1, 2, 3, 3, 5]);
});

test('teamPoints and teamWins match what scores() credits the owner', () => {
  const app = createApp();
  app.S.players = [{ id: 'p-Ann', name: 'Ann', teamIds: ['South-12', 'South-1'] }];
  app.S.bracket.South[2] = 'South-12';  // 12 over 5: round value + 7 upset bonus
  app.S.bracket.South[0] = 'South-1';
  app.syncGames();
  assert.equal(app.teamWins('South-12'), 1);
  assert.equal(app.teamPoints('South-12'), 1 + 7);
  assert.equal(app.teamPoints('South-12') + app.teamPoints('South-1'), app.scores()[0].tot);
  assert.equal(app.teamEliminated('South-5'), true);
  assert.equal(app.teamEliminated('South-12'), false);
});

test('ownerCode: first three letters or digits, upper case', () => {
  const app = createApp();
  assert.equal(app.ownerCode('Riley'), 'RIL');
  assert.equal(app.ownerCode("O'Neil"), 'ONE');
  assert.equal(app.ownerCode('Al'), 'AL');
});
