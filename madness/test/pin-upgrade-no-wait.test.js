const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* A room whose admin PIN is stored in an older format gets it re-stored in the current one after a correct
 * entry. requireAdmin used to wait for that write. With no connection the write only settles once the server
 * has it, so a correct PIN never unlocked; and when the write was refused, the correct entry was thrown away
 * with an unhandled error. `setResult` is what the fake room document's set() returns. */
function legacyRoom(adminPin, entry, setResult) {
  const app = createApp();
  app.requireAdmin = app.__real.requireAdmin;
  app.roomId = 'ROOM1';
  const writes = [];
  app.db = { collection: () => ({ doc: () => ({
    get: async () => ({ exists: true, data: () => ({ adminPin }) }),
    set: data => { writes.push(data); return setResult(); }
  }) }) };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } };
  app.appPrompt = async () => entry;
  return { app, writes };
}
const never = () => new Promise(() => {});
const refused = () => Promise.reject({ code: 'permission-denied' });
const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r('still waiting'), ms))]);

test('older hashed format, upgrade write cannot reach the server: a correct PIN still unlocks', async () => {
  const stored = await createApp().rawHash('7777');
  const { app, writes } = legacyRoom(stored, '7777', never);
  assert.equal(await within(app.requireAdmin(), 500), true);
  assert.equal(app.eval('adminUnlocked'), true);
  assert.equal(writes.length, 1, 'the upgrade was still handed to Firestore');
  assert.equal(await app.verifyPin('7777', writes[0].adminPin), true);
});

test('oldest format, upgrade write cannot reach the server: a correct PIN still unlocks', async () => {
  const { app, writes } = legacyRoom('4444', '4444', never);
  assert.equal(await within(app.requireAdmin(), 500), true);
  assert.equal(app.eval('adminUnlocked'), true);
  assert.equal(writes.length, 1);
});

test('upgrade write refused: a correct PIN still unlocks and nothing is thrown', async () => {
  const stored = await createApp().rawHash('7777');
  let unhandled = null;
  const onUnhandled = e => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const pin of [stored, '7777']) {
      const { app } = legacyRoom(pin, '7777', refused);
      assert.equal(await app.requireAdmin(), true);
      assert.equal(app.eval('adminUnlocked'), true);
    }
    await new Promise(r => setImmediate(r));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(unhandled, null);
});

test('a wrong PIN against an older format writes nothing and stays locked', async () => {
  const stored = await createApp().rawHash('7777');
  for (const pin of [stored, '4444']) {
    const { app, writes } = legacyRoom(pin, '0000', never);
    assert.equal(await app.requireAdmin(), false);
    assert.equal(writes.length, 0);
    assert.equal(app.eval('adminUnlocked'), false);
  }
});
