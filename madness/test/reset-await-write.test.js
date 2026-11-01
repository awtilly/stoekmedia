const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* resetAll() must not reload the page until the room reset has reached Firestore (or a bounded
 * timeout has passed). 80-pages.js is loaded once on top of the harness; its only top-level
 * statements are a const and a window 'beforeunload' listener. */
let pagesLoaded = false;
function resetApp(update) {
  const app = createApp();
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  const calls = { reload: 0, update: 0, unsub: 0 };
  app.location = { reload() { calls.reload++; } };
  app.roomId = 'R';
  app.unsubRoom = () => { calls.unsub++; };
  app.stateKey = () => 'mm4_R';
  app.VIEW_LOCAL = ['phase', 'bracketRegion', 'fr', 'fs', 'liveScoresDate', 'liveScoresFilter'];
  app.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  app.appConfirm = async () => true;
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } };
  app.db = { collection: () => ({ doc: () => ({ update(data) { calls.update++; calls.written = JSON.parse(data.state); return update(); } }) }) };
  return { app, calls };
}

test('resetAll waits for the Firestore write to settle, then clears local state and reloads', async () => {
  let resolveWrite;
  const { app, calls } = resetApp(() => new Promise(r => { resolveWrite = r; }));
  const done = app.resetAll();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.update, 1);
  assert.equal(calls.reload, 0, 'no reload while the write is pending');
  assert.deepEqual(calls.written.players, []);
  assert.equal(calls.written.ds.started, false);
  resolveWrite();
  await done;
  assert.equal(calls.reload, 1);
  assert.equal(calls.unsub, 1);
});

test('a rejected write still reloads (the SDK keeps the queued write)', async () => {
  const { app, calls } = resetApp(() => Promise.reject(new Error('offline')));
  await app.resetAll();
  assert.equal(calls.reload, 1);
});

test('a write that never settles reloads after the bounded timeout', async () => {
  const { app, calls } = resetApp(() => new Promise(() => {}));
  const TIMEOUT = vm.runInThisContext('RESET_WRITE_TIMEOUT_MS'); // top-level const: not reachable through the proxy
  const realSetTimeout = globalThis.setTimeout;
  const fired = [];
  // 80-pages.js reads setTimeout from the global at call time: fire the reset timeout at once, record its delay.
  globalThis.setTimeout = (fn, ms, ...rest) => { fired.push(ms); return realSetTimeout(fn, ms === TIMEOUT ? 0 : ms, ...rest); };
  try {
    await app.resetAll();
  } finally { globalThis.setTimeout = realSetTimeout; }
  assert.ok(fired.includes(TIMEOUT), 'bounded by RESET_WRITE_TIMEOUT_MS');
  assert.equal(calls.reload, 1);
});

test('without a room nothing is written and the page reloads at once', async () => {
  const { app, calls } = resetApp(() => Promise.resolve());
  app.roomId = null;
  await app.resetAll();
  assert.equal(calls.update, 0);
  assert.equal(calls.reload, 1);
});
