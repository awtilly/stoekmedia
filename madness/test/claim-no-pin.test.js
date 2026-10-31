const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* claimPlayer() for a seat that has neither pinHash nor passphraseHash: a 2026 room from before
 * PINs, or a state edited by hand. Every creation path sets a PIN, so claiming such a seat must
 * set one instead of handing the seat to whoever taps first. */

function seatWithoutPin() {
  const app = createApp();
  app.roomId = 'R';
  app.S.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  return app;
}

test('claimPlayer on a seat with no credential asks for a PIN, stores it salted, then claims', async () => {
  const app = seatWithoutPin();
  const prompts = [];
  app.appPrompt = async (msg) => { prompts.push(msg); return '4321'; };
  await app.claimPlayer('p1');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /no PIN yet/);
  const p = app.S.players[0];
  assert.ok(p.pinHash && p.pinHash.includes(':'), 'salted pinHash written');
  assert.equal(await app.verifyPin('4321', p.pinHash), true);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.getMyPlayerId(), 'p1');
  assert.equal(app.__calls.render, 1);
});

test('cancelling the PIN prompt leaves the seat unclaimed and unchanged', async () => {
  const app = seatWithoutPin();
  app.appPrompt = async () => null;
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), null);
  assert.equal(app.S.players[0].pinHash, undefined);
  assert.equal(app.__calls.saveState, 0);
  assert.equal(app.__calls.render, 0);
});

test('a PIN that is not exactly 4 digits is rejected with a toast and no claim', async () => {
  for (const bad of ['12', 'abcd', '12345', ' ']) {
    const app = seatWithoutPin();
    app.appPrompt = async () => bad;
    await app.claimPlayer('p1');
    assert.equal(app.getMyPlayerId(), null, JSON.stringify(bad));
    assert.deepEqual(app.__calls.toasts, ['PIN must be 4 digits']);
  }
});

test('the next claim of that seat verifies the PIN that was just set', async () => {
  const app = seatWithoutPin();
  app.appPrompt = async () => '9876';
  await app.claimPlayer('p1');
  app.localStorage.removeItem('mm4_me_R');
  app.appPrompt = async () => '0000';
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), null, 'wrong PIN rejected');
  assert.deepEqual(app.__calls.alerts, ['Incorrect PIN.']);
  app.appPrompt = async () => '9876';
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), 'p1');
});
