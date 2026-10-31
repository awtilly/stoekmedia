const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

const HEX64 = /^[0-9a-f]{64}$/;

/** Fake Firestore: one room doc. Records every set() call. */
function fakeDb(roomData) {
  const writes = [];
  const docRef = {
    async get() { return { exists: roomData !== null, data: () => roomData }; },
    async set(data, opts) { writes.push({ data, opts }); Object.assign(roomData || (roomData = {}), data); }
  };
  const db = { collection: () => ({ doc: () => docRef }) };
  return { db, writes };
}

/** Wire an app for requireAdmin tests. prompts are returned in order by appPrompt. */
function adminApp(roomData, prompts) {
  const app = createApp();
  app.requireAdmin = app.__real.requireAdmin; // createApp stubs it for the logic tests
  app.roomId = 'ROOM1';
  const { db, writes } = fakeDb(roomData);
  app.db = db;
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } };
  const queue = prompts.slice();
  app.appPrompt = async () => queue.shift();
  return { app, writes };
}

/* ── Hashing ── */

test('generateSalt returns hex of the requested byte length and is random', () => {
  const app = createApp();
  const a = app.generateSalt();
  const b = app.generateSalt();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.equal(app.generateSalt(8).length, 16);
});

test('rawHash is deterministic SHA-256 hex', async () => {
  const app = createApp();
  // Known vector: sha256("abc")
  assert.equal(await app.rawHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await app.rawHash('1234'), await app.rawHash('1234'));
});

test('hashPin yields salt:hash and two hashes of the same PIN differ', async () => {
  const app = createApp();
  const h1 = await app.hashPin('1234');
  const h2 = await app.hashPin('1234');
  const [salt, hash] = h1.split(':');
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.match(hash, HEX64);
  assert.notEqual(h1, h2, 'salt must differ per call');
});

test('verifyPin accepts the right PIN and rejects a wrong one (salted format)', async () => {
  const app = createApp();
  const stored = await app.hashPin('4321');
  assert.equal(await app.verifyPin('4321', stored), true);
  assert.equal(await app.verifyPin('4322', stored), false);
  assert.equal(await app.verifyPin('', stored), false);
});

test('verifyPin still accepts legacy unsalted sha256 hashes', async () => {
  const app = createApp();
  const legacy = await app.rawHash('9999');
  assert.equal(await app.verifyPin('9999', legacy), true);
  assert.equal(await app.verifyPin('9998', legacy), false);
});

test('migratePin re-hashes with a salt and the new value verifies', async () => {
  const app = createApp();
  const salted = await app.migratePin('5555');
  assert.ok(salted.includes(':'));
  assert.equal(await app.verifyPin('5555', salted), true);
});

/* ── Admin session (localStorage) ── */

test('checkAdminSession is locked with no room, no entry, or an expired entry', () => {
  const app = createApp();
  app.checkAdminSession();
  assert.equal(app.eval('adminUnlocked'), false, 'no roomId');

  app.roomId = 'R';
  app.checkAdminSession();
  assert.equal(app.eval('adminUnlocked'), false, 'no stored session');

  const fiveHoursAgo = Date.now() - 5 * 3600 * 1000;
  app.localStorage.setItem('mm4_admin_R', String(fiveHoursAgo));
  app.checkAdminSession();
  assert.equal(app.eval('adminUnlocked'), false, 'expired session');
  assert.equal(app.localStorage.getItem('mm4_admin_R'), null, 'expired entry is removed');
});

test('unlockAdmin persists a session that checkAdminSession honours; lockAdmin clears it', () => {
  const app = createApp();
  app.roomId = 'R';
  app.unlockAdmin();
  assert.equal(app.eval('adminUnlocked'), true);
  assert.match(app.localStorage.getItem('mm4_admin_R'), /^\d+$/);

  app.eval('adminUnlocked = false');
  app.checkAdminSession();
  assert.equal(app.eval('adminUnlocked'), true, 'fresh session restores unlock');

  app.lockAdmin();
  assert.equal(app.eval('adminUnlocked'), false);
  assert.equal(app.localStorage.getItem('mm4_admin_R'), null);
  assert.equal(app.__calls.render, 1, 'lockAdmin re-renders');
});

test('session keys are per room', () => {
  const app = createApp();
  app.roomId = 'A';
  app.unlockAdmin();
  app.roomId = 'B';
  app.eval('adminUnlocked = false');
  app.checkAdminSession();
  assert.equal(app.eval('adminUnlocked'), false, 'room B is not unlocked by room A session');
});

/* ── requireAdmin ── */

test('requireAdmin: no room or already unlocked returns true without touching Firestore', async () => {
  const app = createApp();
  app.requireAdmin = app.__real.requireAdmin;
  app.db = { collection() { throw new Error('must not hit db'); } };
  assert.equal(await app.requireAdmin(), true, 'no roomId');
  app.roomId = 'R';
  app.eval('adminUnlocked = true');
  assert.equal(await app.requireAdmin(), true, 'already unlocked');
});

test('requireAdmin: room without a PIN asks to set one, stores it salted, unlocks', async () => {
  const { app, writes } = adminApp({ name: 'Room' }, ['2468']);
  assert.equal(await app.requireAdmin(), true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].opts, { merge: true });
  assert.ok(writes[0].data.adminPin.includes(':'), 'stored as salt:hash');
  assert.equal(await app.verifyPin('2468', writes[0].data.adminPin), true);
  assert.equal(writes[0].data.updatedAt, 'SERVER_TS');
  assert.equal(app.eval('adminUnlocked'), true);
});

test('requireAdmin: setting a PIN rejects anything but 4 digits', async () => {
  for (const bad of ['12', 'abcd', '12345', null]) {
    const { app, writes } = adminApp({}, [bad]);
    assert.equal(await app.requireAdmin(), false, 'rejected ' + bad);
    assert.equal(writes.length, 0);
    assert.equal(app.eval('adminUnlocked'), false);
  }
});

test('requireAdmin: correct salted PIN unlocks and resets the failure counter', async () => {
  const app0 = createApp();
  const stored = await app0.hashPin('1357');
  const { app, writes } = adminApp({ adminPin: stored }, ['1357']);
  assert.equal(await app.requireAdmin(), true);
  assert.equal(writes.length, 0, 'already salted: no migration write');
  assert.equal(app.eval('adminUnlocked'), true);
  assert.equal(app.eval('_pinFailCount'), 0);
});

test('requireAdmin: wrong PIN alerts, stays locked, bumps the failure counter', async () => {
  const app0 = createApp();
  const stored = await app0.hashPin('1357');
  const { app, writes } = adminApp({ adminPin: stored }, ['0000']);
  assert.equal(await app.requireAdmin(), false);
  assert.equal(writes.length, 0);
  assert.equal(app.eval('adminUnlocked'), false);
  assert.equal(app.eval('_pinFailCount'), 1);
  assert.deepEqual(app.__calls.alerts, ['Incorrect PIN.']);
});

test('requireAdmin: cancelled prompt returns false without an alert or a failure', async () => {
  const app0 = createApp();
  const stored = await app0.hashPin('1357');
  const { app } = adminApp({ adminPin: stored }, [null]);
  assert.equal(await app.requireAdmin(), false);
  assert.equal(app.eval('_pinFailCount'), 0);
  assert.deepEqual(app.__calls.alerts, []);
});

test('requireAdmin: legacy unsalted hash is migrated to salted on success', async () => {
  const app0 = createApp();
  const legacy = await app0.rawHash('7777');
  const { app, writes } = adminApp({ adminPin: legacy }, ['7777']);
  assert.equal(await app.requireAdmin(), true);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].data.adminPin.includes(':'));
  assert.equal(await app.verifyPin('7777', writes[0].data.adminPin), true);
});

test('requireAdmin: legacy plaintext PIN is accepted once and migrated to salted', async () => {
  const { app, writes } = adminApp({ adminPin: '4444' }, ['4444']);
  assert.equal(await app.requireAdmin(), true);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].data.adminPin.includes(':'));
  assert.equal(await app.verifyPin('4444', writes[0].data.adminPin), true);
  assert.equal(app.eval('adminUnlocked'), true);
});

test('requireAdmin: wrong entry against a legacy plaintext PIN is rejected and counted', async () => {
  const { app, writes } = adminApp({ adminPin: '4444' }, ['4445']);
  assert.equal(await app.requireAdmin(), false);
  assert.equal(writes.length, 0);
  assert.equal(app.eval('_pinFailCount'), 1);
  assert.deepEqual(app.__calls.alerts, ['Incorrect PIN.']);
});

test('requireAdmin: backoff doubles per failure and caps at 8 s', async () => {
  const app0 = createApp();
  const stored = await app0.hashPin('1357');
  const { app } = adminApp({ adminPin: stored }, ['0000', '0000', '0000', '0000', '0000', '0000']);
  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { delays.push(ms); fn(); return 0; };
  try {
    for (let i = 0; i < 6; i++) await app.requireAdmin();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  // first attempt has no delay; then 1s, 2s, 4s, 8s, 8s
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 8000]);
  assert.equal(app.eval('_pinFailCount'), 6);
});

/* ── Player identity ── */

test('getMyPlayerId/setMyPlayerId are scoped to the room and no-ops without one', () => {
  const app = createApp();
  app.setMyPlayerId('p1');
  assert.equal(app.getMyPlayerId(), null, 'no room: nothing stored');
  app.roomId = 'R';
  app.setMyPlayerId('p1');
  assert.equal(app.getMyPlayerId(), 'p1');
  assert.equal(app.localStorage.getItem('mm4_me_R'), 'p1');
});

test('claimPlayer with a salted pinHash verifies the PIN and claims the seat', async () => {
  const app = createApp();
  app.roomId = 'R';
  const pinHash = await app.hashPin('1111');
  app.S.players = [{ id: 'p1', name: 'Ann', pinHash, teamIds: [] }];
  app.appPrompt = async () => '1111';
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), 'p1');
  assert.equal(app.__calls.saveState, 0, 'already salted: no re-save');
  assert.equal(app.__calls.render, 1);
});

test('claimPlayer with a wrong PIN alerts and does not claim', async () => {
  const app = createApp();
  app.roomId = 'R';
  app.S.players = [{ id: 'p1', name: 'Ann', pinHash: await app.hashPin('1111'), teamIds: [] }];
  app.appPrompt = async () => '2222';
  await app.claimPlayer('p1');
  assert.equal(app.getMyPlayerId(), null);
  assert.deepEqual(app.__calls.alerts, ['Incorrect PIN.']);
});

test('claimPlayer migrates an unsalted pinHash on success', async () => {
  const app = createApp();
  app.roomId = 'R';
  app.S.players = [{ id: 'p1', name: 'Ann', pinHash: await app.rawHash('1111'), teamIds: [] }];
  app.appPrompt = async () => '1111';
  await app.claimPlayer('p1');
  assert.ok(app.S.players[0].pinHash.includes(':'));
  assert.equal(app.__calls.saveState, 1);
  assert.equal(app.getMyPlayerId(), 'p1');
});

test('claimPlayer upgrades a legacy passphrase to a PIN', async () => {
  const app = createApp();
  app.roomId = 'R';
  app.S.players = [{ id: 'p1', name: 'Ann', passphraseHash: await app.rawHash('open sesame'), teamIds: [] }];
  const answers = ['open sesame', '3333'];
  app.appPrompt = async () => answers.shift();
  await app.claimPlayer('p1');
  const p = app.S.players[0];
  assert.equal(p.passphraseHash, undefined);
  assert.equal(await app.verifyPin('3333', p.pinHash), true);
  assert.equal(app.getMyPlayerId(), 'p1');
});

test('claimPlayer on an unknown id does nothing', async () => {
  const app = createApp();
  app.roomId = 'R';
  await app.claimPlayer('nope');
  assert.equal(app.getMyPlayerId(), null);
  assert.equal(app.__calls.render, 0);
});
