const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* Player and team names are compared as text: "is that name taken?" when somebody joins or is added, and the
 * Live tab's lookup of a score's team by name. Every device writes the whole room, so the shape of a record is
 * checked where it arrives (sanitizeSharedState), like ids and seeds. A name that was not text made Join do
 * nothing at all for everybody in that room. */

test('sanitizeSharedState turns a name that is not text into text, and leaves ordinary names alone', () => {
  const app = createApp();
  const s = app.sanitizeSharedState({
    players: [
      { id: 'p1', name: 'Ann', teamIds: [] },
      { id: 'p2', name: 42, teamIds: [] },
      { id: 'p3', teamIds: [] },
      { id: 'p4', name: null, teamIds: [] },
      { id: 'p5', name: { first: 'Bob' }, teamIds: [] }
    ],
    teams: [{ id: 't1', name: 'Duke', seed: 1 }, { id: 't2', name: 7, seed: 2 }, { id: 't3', seed: 3 }]
  });
  assert.deepEqual(s.players.map(p => p.name), ['Ann', '42', '', '', '[object Object]']);
  assert.deepEqual(s.teams.map(t => t.name), ['Duke', '7', '']);
  for (const r of s.players.concat(s.teams)) assert.equal(typeof r.name, 'string');
});

test('a room holding such a record can still be joined', async () => {
  const app = createApp();
  app.sanitizeSharedState(Object.assign(app.S, { players: [{ id: 'p1', name: 42, teamIds: [] }, { id: 'p2', teamIds: [] }] }));
  app.roomId = 'POOL';
  app.document = { getElementById: id => ({ 'join-name': { value: 'Cat' }, 'join-pin': { value: '1234' } }[id] || null), addEventListener() {}, querySelector() { return null; } };
  app.hashPin = async p => 'h:' + p;
  app.setMyPlayerId = () => {};
  await app.selfRegister();
  assert.deepEqual(app.S.players.map(p => p.name), ['42', '', 'Cat']);
});

test('the default state and a state with no players or teams pass through untouched', () => {
  const app = createApp();
  const before = JSON.stringify(app.S);
  app.sanitizeSharedState(app.S);
  assert.equal(JSON.stringify(app.S), before);
  assert.deepEqual(app.sanitizeSharedState({ joinKey: 'AB3K9Q' }), { joinKey: 'AB3K9Q' });
});
