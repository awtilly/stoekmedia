const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

test('owner: returns the name of the player holding a team, empty string when nobody does', () => {
  const app = createApp();
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: ['South-1'] }, { id: 'b', name: 'Bob', teamIds: [] }];
  assert.equal(app.owner('South-1'), 'Ann');
  assert.equal(app.owner('East-2'), '');
});

test('clearDownstream: a changed R64 winner wipes later-round winners that no longer come from that slot', () => {
  const app = createApp();
  const b = app.S.bracket;
  b.South[0] = 'South-1'; b.South[1] = 'South-8'; b.South[8] = 'South-1'; b.South[12] = 'South-1';
  b.South[2] = 'South-5'; b.South[3] = 'South-4'; b.South[9] = 'South-5';
  b.South[0] = 'South-16'; // admin flips game 0
  app.clearDownstream('South', 0);
  assert.equal(b.South[8], null, 'R32 winner fed by game 0 cleared');
  assert.equal(b.South[12], null, 'Sweet 16 winner cleared too');
  assert.equal(b.South[9], 'South-5', 'unrelated R32 game untouched');
  assert.equal(b.South[0], 'South-16');
});

test('cascadeFF: a changed region winner clears the Final Four and title picks that depended on it', () => {
  const app = createApp();
  const b = app.S.bracket;
  b.South[14] = 'South-1'; b.East[14] = 'East-1'; b.Midwest[14] = 'Midwest-1'; b.West[14] = 'West-1';
  b.ff[0] = 'South-1'; b.ff[1] = 'Midwest-1'; b.ff[2] = 'South-1';
  app.cascadeFF();
  assert.deepEqual(b.ff, ['South-1', 'Midwest-1', 'South-1'], 'consistent bracket left alone');
  b.South[14] = 'South-2';
  app.cascadeFF();
  assert.equal(b.ff[0], null, 'semifinal winner no longer a region winner');
  assert.equal(b.ff[1], 'Midwest-1', 'other semifinal untouched');
  assert.equal(b.ff[2], null, 'champion depended on the cleared semifinal');
});
