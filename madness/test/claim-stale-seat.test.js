const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* claimPlayer() looks the player up, then waits on a prompt. A room update that arrives while the prompt is open
 * (on join night: every few seconds) replaces S.players with new objects, so the player found before the prompt
 * is no longer the one in S. What the claim stores must land on the seat as the room has it now. */

/** What a room snapshot does to the roster: the same players as new objects, changed by fn. */
function roomUpdate(app, fn) {
  const next = JSON.parse(JSON.stringify(app.S.players));
  app.S.players = fn ? (fn(next) || next) : next;
}

function room(players) {
  const app = createApp();
  app.roomId = 'R';
  app.S.players = players;
  return app;
}

test('a seat with no PIN: the PIN typed while a room update arrived is stored on the seat', async () => {
  const app = room([{ id: 'p1', name: 'Ann', teamIds: [] }]);
  app.appPrompt = async () => { roomUpdate(app); return '4321'; };
  await app.claimPlayer('p1');
  const p = app.S.players[0];
  assert.ok(p.pinHash, 'the seat in S has the PIN');
  assert.equal(await app.verifyPin('4321', p.pinHash), true);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.getMyPlayerId(), 'p1');
});

test('a seat with no PIN that another phone gave a PIN while the prompt was open is not taken', async () => {
  const app = room([{ id: 'p1', name: 'Ann', teamIds: [] }]);
  const theirs = await app.hashPin('1111');
  app.appPrompt = async () => { roomUpdate(app, ps => { ps[0].pinHash = theirs; }); return '4321'; };
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), null, 'not seated');
  assert.equal(app.S.players[0].pinHash, theirs, 'the PIN set first stands');
  assert.equal(app.__calls.saveState, 0);
  assert.equal(app.__calls.toasts.length, 1);
  assert.match(app.__calls.toasts[0], /just got a PIN/);
  // tapping the name again asks for that PIN
  app.appPrompt = async () => '1111';
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), 'p1');
});

test('a player removed while the PIN prompt was open is not claimed', async () => {
  const pinHash = await createApp().hashPin('1234');
  const app = room([{ id: 'p1', name: 'Ann', teamIds: [], pinHash }, { id: 'p2', name: 'Bob', teamIds: [], pinHash }]);
  app.appPrompt = async () => { roomUpdate(app, ps => ps.filter(p => p.id !== 'p1')); return '1234'; };
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), null);
  assert.deepEqual(app.__calls.toasts, ['That player is no longer in this pool.']);
  assert.equal(app.__calls.render, 0);
});

test('a seat without a PIN removed while the prompt was open: nothing is saved, nothing is claimed', async () => {
  const app = room([{ id: 'p1', name: 'Ann', teamIds: [] }]);
  app.appPrompt = async () => { roomUpdate(app, () => []); return '4321'; };
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), null);
  assert.equal(app.__calls.saveState, 0);
  assert.deepEqual(app.__calls.toasts, ['That player is no longer in this pool.']);
});

test('a passphrase seat: the new PIN is stored on the seat in S and the passphrase is dropped', async () => {
  const app = room([]);
  const passphraseHash = await app.hashPin('open sesame');
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [], passphraseHash }];
  const answers = ['open sesame', '2468'];
  app.appPrompt = async () => { roomUpdate(app); return answers.shift(); };
  await app.claimPlayer('p1');
  const p = app.S.players[0];
  assert.equal(await app.verifyPin('2468', p.pinHash || 'x:y'), true, 'new PIN on the seat');
  assert.equal(p.passphraseHash, undefined);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.getMyPlayerId(), 'p1');
});

test('an old-format PIN is upgraded on the seat in S', async () => {
  const app = room([]);
  const old = await app.rawHash('1234'); // unsalted, 64 hex characters
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [], pinHash: old }];
  app.appPrompt = async () => { roomUpdate(app); return '1234'; };
  await app.claimPlayer('p1');
  const p = app.S.players[0];
  assert.ok(p.pinHash.includes(':'), 'salted format on the seat');
  assert.equal(await app.verifyPin('1234', p.pinHash), true);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.getMyPlayerId(), 'p1');
});

test('with no room update in between, a claim works as before', async () => {
  const pinHash = await createApp().hashPin('1234');
  const app = room([{ id: 'p1', name: 'Ann', teamIds: [], pinHash }]);
  app.appPrompt = async () => '1234';
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), 'p1');
  assert.equal(app.__calls.saveState, 0, 'nothing to store');
  assert.equal(app.__calls.render, 1);
  assert.deepEqual(app.__calls.toasts, []);
});
