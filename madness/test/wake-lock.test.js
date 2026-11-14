// Screen wake lock on the Live tab (js/20-live.js): at most one lock is held, and a
// request that resolves after the tab was left releases itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

function fakeWakeLockApi() {
  const locks = [];
  const pending = [];
  const api = {
    locks, pending,
    request: () => new Promise((resolve) => {
      const lock = { released: false, listeners: {}, release() { this.released = true; },
        addEventListener(type, fn) { this.listeners[type] = fn; } };
      locks.push(lock);
      pending.push(() => resolve(lock));
    }),
    resolveNext() { const r = pending.shift(); r(); }
  };
  return api;
}
const flush = () => new Promise((r) => setImmediate(r));

function withNavigator(wakeLock) {
  Object.defineProperty(globalThis, 'navigator', { value: wakeLock ? { wakeLock } : {}, configurable: true, writable: true });
}

test('two overlapping requests end up holding exactly one lock', async () => {
  const app = createApp();
  const api = fakeWakeLockApi();
  withNavigator(api);
  app.requestWakeLock();
  app.requestWakeLock();
  api.resolveNext(); await flush();
  api.resolveNext(); await flush();
  assert.equal(api.locks.length, 2, 'both requests reached the browser');
  assert.deepEqual(api.locks.map((l) => l.released), [true, false], 'the superseded lock was released, the newest is held');
  app.releaseWakeLock();
  assert.deepEqual(api.locks.map((l) => l.released), [true, true], 'release lets the held lock go');
});

test('a request that resolves after releaseWakeLock releases itself', async () => {
  const app = createApp();
  const api = fakeWakeLockApi();
  withNavigator(api);
  app.requestWakeLock();
  app.releaseWakeLock();            // user left the Live tab before the browser answered
  api.resolveNext(); await flush();
  assert.equal(api.locks[0].released, true, 'late lock not kept');
  app.requestWakeLock();            // a later visit can acquire again
  api.resolveNext(); await flush();
  assert.equal(api.locks.length, 2);
  assert.equal(api.locks[1].released, false, 'fresh lock held');
  app.releaseWakeLock();
});

test('while a lock is held, further requests are no-ops; a system release allows a new one', async () => {
  const app = createApp();
  const api = fakeWakeLockApi();
  withNavigator(api);
  app.requestWakeLock();
  api.resolveNext(); await flush();
  app.requestWakeLock();
  app.requestWakeLock();
  await flush();
  assert.equal(api.locks.length, 1, 'no extra browser requests while held');
  api.locks[0].released = true;
  api.locks[0].listeners.release();  // browser released it (e.g. tab hidden)
  app.requestWakeLock();
  api.resolveNext(); await flush();
  assert.equal(api.locks.length, 2, 'new request goes through after the system release');
  assert.equal(api.locks[1].released, false);
  app.releaseWakeLock();
});

test('a rejected request is logged, not thrown, and does not block the next one', async () => {
  const app = createApp();
  let calls = 0;
  withNavigator({ request: async () => { calls++; if (calls === 1) throw new Error('NotAllowedError'); return { release() {}, addEventListener() {} }; } });
  const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
  try {
    await app.requestWakeLock();
    assert.equal(warned.length, 1);
    await app.requestWakeLock();
    assert.equal(calls, 2, 'second request attempted');
  } finally { console.warn = warn; app.releaseWakeLock(); }
});

test('without a Wake Lock API nothing happens', async () => {
  const app = createApp();
  withNavigator(null);
  await app.requestWakeLock();
  app.releaseWakeLock();
  assert.ok(true);
});
