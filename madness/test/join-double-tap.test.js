const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* "Join" hashes the PIN before it adds the player, and hashing is asynchronous. A second tap during that moment
 * (a double tap, an impatient thumb on a slow phone) ran the "that name is taken" check before the first tap had
 * added anybody: the room got the same person twice, and the phone was seated as the second one. */

function joinApp(fields) {
  const app = createApp();
  app.roomId = 'POOL';
  app.S.players = [];
  app.document = { getElementById: id => (id in fields ? { value: fields[id] } : null), addEventListener(){}, querySelector(){ return null; } };
  return app;
}

test('two taps on Join add one player', async () => {
  const app = joinApp({ 'join-name': 'Bob', 'join-pin': '1234' });
  await Promise.all([app.selfRegister(), app.selfRegister()]);
  assert.deepEqual(app.S.players.map(p => p.name), ['Bob']);
  assert.equal(app.getMyPlayerId(), app.S.players[0].id, 'this phone holds that one seat');
});

test('a second, separate join still works: the guard is released when the first is done', async () => {
  const fields = { 'join-name': 'Bob', 'join-pin': '1234' };
  const app = joinApp(fields);
  await app.selfRegister();
  fields['join-name'] = 'Carol';
  await app.selfRegister();
  assert.deepEqual(app.S.players.map(p => p.name), ['Bob', 'Carol']);
});

test('the guard is released when hashing the PIN fails', async () => {
  const fields = { 'join-name': 'Bob', 'join-pin': '1234' };
  const app = joinApp(fields);
  const realHash = app.hashPin;
  app.hashPin = async () => { throw new Error('no crypto'); };
  await assert.rejects(() => app.selfRegister());
  assert.deepEqual(app.S.players, []);
  app.hashPin = realHash;
  await app.selfRegister();
  assert.deepEqual(app.S.players.map(p => p.name), ['Bob']);
});
