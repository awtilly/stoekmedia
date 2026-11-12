const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./_harness');

function joinForm(app, fields){
  app.document = { getElementById: id => (id in fields ? { value: fields[id] } : null), addEventListener(){}, querySelector(){ return null; } };
  app.hashPin = async p => 'h:' + p;
  app.setMyPlayerId = () => {};
}

test('newJoinKey: 6 unambiguous characters', (t) => {
  const app = createApp();
  for(let i = 0; i < 50; i++) assert.match(app.newJoinKey(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
});

test('sanitizeSharedState drops a malformed joinKey and normalises a good one', () => {
  const app = createApp();
  assert.strictEqual(app.sanitizeSharedState({ joinKey: '"><img>' }).joinKey, undefined);
  assert.strictEqual(app.sanitizeSharedState({ joinKey: 'ab3k9q' }).joinKey, 'AB3K9Q');
});

test('inviteUrl points at the website with the key', () => {
  const app = createApp();
  assert.strictEqual(app.inviteUrl('POOL', 'AB3K9Q'), 'https://stoekmedia.com/madness/?room=POOL&key=AB3K9Q');
  assert.strictEqual(app.inviteUrl('POOL', ''), 'https://stoekmedia.com/madness/?room=POOL');
});

test('selfRegister: a keyed room refuses a wrong or missing code', async () => {
  const app = createApp({ joinKey: 'AB3K9Q', ds: { order: [], cp: 0, started: false, complete: false } });
  app.roomId = 'POOL';
  joinForm(app, { 'join-name': 'Ann', 'join-pin': '1234', 'join-key': 'ZZZZZZ' });
  await app.selfRegister();
  assert.strictEqual(app.S.players.length, 0);
  assert.deepStrictEqual(app.__calls.toasts, ['Wrong invite code']);
  joinForm(app, { 'join-name': 'Ann', 'join-pin': '1234' });
  await app.selfRegister();
  assert.strictEqual(app.S.players.length, 0);
});

test('selfRegister: the typed code, or one remembered from an invite link, lets a player in', async () => {
  const app = createApp({ joinKey: 'AB3K9Q' });
  app.roomId = 'POOL';
  joinForm(app, { 'join-name': 'Ann', 'join-pin': '1234', 'join-key': 'ab3k9q' });
  await app.selfRegister();
  assert.strictEqual(app.S.players.length, 1);
  assert.strictEqual(app.knownJoinKey('POOL'), 'AB3K9Q');

  app.rememberJoinKey('POOL', 'AB3K9Q');
  joinForm(app, { 'join-name': 'Bob', 'join-pin': '1234' });
  await app.selfRegister();
  assert.strictEqual(app.S.players.length, 2);
});

test('selfRegister: a room without a key stays open', async () => {
  const app = createApp();
  app.roomId = 'OLD';
  joinForm(app, { 'join-name': 'Ann', 'join-pin': '1234' });
  await app.selfRegister();
  assert.strictEqual(app.S.players.length, 1);
});
