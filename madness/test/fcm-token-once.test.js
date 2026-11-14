const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/*
 * js/30-state.js initialises Firebase at top level, so only the slice from `let _fcmRegistered`
 * through the end of initFCM() is evaluated here, in its own context with stubs for the globals it
 * reads (window/Notification, navigator.serviceWorker, firebase.messaging, db, roomId, getMyPlayerId).
 */
function fcmSandbox({ token = 'tok-1', failWrite = false } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '30-state.js'), 'utf8');
  const start = src.indexOf('let _fcmRegistered');
  const fnStart = src.indexOf('async function initFCM', start);
  const m = /\r?\n\}\r?\n/.exec(src.slice(fnStart)); // first top-level closing brace after initFCM (CRLF checkouts too)
  const end = m ? fnStart + m.index + m[0].length : -1;
  assert.ok(start > 0 && fnStart > start && end > fnStart, 'could not locate initFCM in 30-state.js');
  const writes = [];
  const ctx = {
    console: { warn() {} },
    window: { Notification: true },
    Notification: { permission: 'granted' },
    navigator: { serviceWorker: { ready: Promise.resolve({ scope: '/' }) } },
    firebase: {
      messaging: () => ({ getToken: async () => ctx.__token }),
      firestore: { FieldValue: { arrayUnion: v => ['union', v], serverTimestamp: () => 'SERVER_TS' } }
    },
    db: { collection: () => ({ doc: () => ({ collection: () => ({ doc: id => ({
      set(data, opts) { writes.push({ id, data, opts }); return failWrite ? Promise.reject(new Error('offline')) : Promise.resolve(); }
    }) }) }) }) },
    roomId: 'ROOM1',
    getMyPlayerId: () => 'p1',
    VAPID_KEY: 'k',
    __token: token
  };
  ctx.isNativeShell = false;
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end), ctx, { filename: '30-state.js#initFCM' });
  return { ctx, writes, initFCM: () => vm.runInContext('initFCM()', ctx) };
}

test('initFCM writes the token document once per room/player/token, not on every snapshot', async () => {
  const { initFCM, writes } = fcmSandbox();
  await initFCM(); await initFCM(); await initFCM();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, 'p1');
  assert.deepEqual(writes[0].data.tokens, ['union', 'tok-1']);
});

test('a new token, another room or another player is written again', async () => {
  const { ctx, initFCM, writes } = fcmSandbox();
  await initFCM();
  ctx.__token = 'tok-2'; await initFCM();
  ctx.roomId = 'ROOM2'; await initFCM();
  ctx.getMyPlayerId = () => 'p2'; await initFCM(); await initFCM();
  assert.equal(writes.length, 4);
});

test('a failed write is retried on the next call', async () => {
  const { initFCM, writes } = fcmSandbox({ failWrite: true });
  await initFCM();
  await new Promise(r => setImmediate(r)); // let the rejected set() settle and clear the guard
  await initFCM();
  assert.equal(writes.length, 2);
});

test('no write without a room or a claimed player', async () => {
  const { ctx, initFCM, writes } = fcmSandbox();
  ctx.roomId = null; await initFCM();
  ctx.roomId = 'ROOM1'; ctx.getMyPlayerId = () => null; await initFCM();
  assert.equal(writes.length, 0);
});
