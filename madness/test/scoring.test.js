const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

function withPlayers(app, rosters) {
  app.S.players = Object.entries(rosters).map(([name, teamIds]) => ({ id: 'p-' + name, name, teamIds }));
}

// Fills one region so that `winnerSeed` wins every game through the Elite 8.
// Only the games on the winner's path plus the sibling games needed to feed them are set.
function fillRegion(b, region, winnerSeed) {
  const id = s => region + '-' + s;
  b[region][0] = id(1); b[region][1] = id(8); b[region][8] = id(1);
  b[region][2] = id(5); b[region][3] = id(4); b[region][9] = id(4);
  b[region][12] = id(1);
  b[region][4] = id(6); b[region][5] = id(3); b[region][10] = id(3);
  b[region][6] = id(7); b[region][7] = id(2); b[region][11] = id(2);
  b[region][13] = id(2);
  b[region][14] = id(winnerSeed);
}

test('scores: a Round of 64 win is worth the round-1 value with no upset bonus for the favorite', () => {
  const app = createApp();
  withPlayers(app, { Ann: ['South-1'], Bob: ['South-16'] });
  app.S.bracket.South[0] = 'South-1';   // 1 seed beats 16 seed
  app.syncGames();
  const sc = app.scores();
  assert.equal(sc[0].name, 'Ann');
  assert.equal(sc[0].tot, 1);
  assert.deepEqual(sc[0].rp, { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  assert.equal(sc[1].tot, 0);
});

test('scores: upset bonus adds the seed difference when enabled and nothing when disabled', () => {
  const app = createApp();
  withPlayers(app, { Ann: ['South-12'] });
  app.S.bracket.South[2] = 'South-12';  // game 2 is 5 vs 12
  app.syncGames();
  assert.equal(app.scores()[0].tot, 1 + 7);
  app.S.ub = false;
  assert.equal(app.scores()[0].tot, 1);
});

test('scores: points accumulate through every round and the per-round breakdown matches', () => {
  const app = createApp();
  withPlayers(app, { Ann: ['South-1'] });
  const b = app.S.bracket;
  fillRegion(b, 'South', 1);
  fillRegion(b, 'East', 1);
  b.Midwest[14] = 'Midwest-1'; b.West[14] = 'West-1';
  b.ff[0] = 'South-1';      // Final Four (South vs East)
  b.ff[1] = 'West-1';
  b.ff[2] = 'South-1';      // Champion
  app.syncGames();
  const ann = app.scores()[0];
  assert.deepEqual(ann.rp, { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 });
  assert.equal(ann.tot, 63);
});

test('scores: leaderboard is sorted descending by total', () => {
  const app = createApp();
  withPlayers(app, { Low: ['South-16'], High: ['South-1', 'East-1'], None: [] });
  app.S.bracket.South[0] = 'South-1';
  app.S.bracket.East[0] = 'East-1';
  app.syncGames();
  assert.deepEqual(app.scores().map(s => s.name), ['High', 'Low', 'None']);
});

test('scores: a losing team never scores', () => {
  const app = createApp();
  withPlayers(app, { Ann: ['South-16'] });
  app.S.bracket.South[0] = 'South-1';
  app.syncGames();
  assert.equal(app.scores()[0].tot, 0);
});

test('scores: custom round values are respected', () => {
  const app = createApp();
  withPlayers(app, { Ann: ['South-1'] });
  app.S.rp = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50, 6: 60 };
  app.S.ub = false;
  app.S.bracket.South[0] = 'South-1';
  app.syncGames();
  assert.equal(app.scores()[0].tot, 10);
});

test('scores: upset bonus in a later round uses the actual opponent, not the R64 opponent', () => {
  const app = createApp();
  withPlayers(app, { Ann: ['South-9'] });
  const b = app.S.bracket;
  b.South[0] = 'South-1';   // 1 beats 16
  b.South[1] = 'South-9';   // 9 beats 8  -> +1 upset
  b.South[8] = 'South-9';   // 9 beats 1  -> +8 upset
  app.syncGames();
  const ann = app.scores()[0];
  assert.equal(ann.rp[1], 1 + 1);
  assert.equal(ann.rp[2], 2 + 8);
  assert.equal(ann.tot, 12);
});
