const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* The service worker (sw.js) answers any GET it has seen before from Cache Storage, for good. For the score relay
 * that froze the Live tab at the first scoreboard of the day and left a bracket import on the answer from before
 * Selection Sunday. ncaa._get() removes the stored answer before every request so it reaches the network. */

const RELAY = 'https://us-central1-march-madness-snake-draft.cloudfunctions.net/ncaa';

// A stand-in for Cache Storage plus a fetch that behaves like sw.js: stored answer first, else network + store.
function swWorld() {
  const stores = { 'mm-draft-v8': new Map(), 'other': new Map() };
  const log = [];
  let n = 0;
  const cachesApi = {
    keys: async () => Object.keys(stores),
    open: async name => ({ delete: async (url, opts) => { log.push('delete ' + name + ' ' + url + ' ' + JSON.stringify(opts)); return stores[name].delete(url); } })
  };
  const fetch = async url => {
    log.push('fetch ' + url);
    const store = stores['mm-draft-v8'];
    if (!store.has(url)) store.set(url, { n: n++ });
    const body = store.get(url);
    return { ok: true, json: async () => body };
  };
  return { cachesApi, fetch, log, stores };
}
function withCaches(value, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { value, configurable: true, writable: true });
  return fn().finally(() => { if (had) Object.defineProperty(globalThis, 'caches', had); else delete globalThis.caches; });
}

test('every relay request gets a fresh answer although the service worker stores each one', async () => {
  const app = createApp();
  const w = swWorld();
  app.fetch = w.fetch;
  await withCaches(w.cachesApi, async () => {
    const a = await app.ncaa.fetchScoreboard('20270318');
    const b = await app.ncaa.fetchScoreboard('20270318');
    const c = await app.ncaa.fetchScoreboard('20270318');
    assert.deepEqual([a.n, b.n, c.n], [0, 1, 2], 'not the stored first answer three times');
  });
  const url = RELAY + '/scoreboard/basketball-men/d1/2027/03/18';
  assert.equal(w.log[0], 'delete mm-draft-v8 ' + url + ' {"ignoreVary":true}', 'the stored answer goes before the request is made');
  assert.equal(w.log[1], 'delete other ' + url + ' {"ignoreVary":true}', 'whatever the cache is called');
  assert.equal(w.log[2], 'fetch ' + url);
});

test('the bracket route is covered too (an import tried before Selection Sunday must not stick)', async () => {
  const app = createApp();
  const w = swWorld();
  app.fetch = w.fetch;
  await withCaches(w.cachesApi, async () => {
    const a = await app.ncaa.fetchBracket(2027);
    const b = await app.ncaa.fetchBracket(2027);
    assert.deepEqual([a.n, b.n], [0, 1]);
  });
  assert.ok(w.log[0].startsWith('delete mm-draft-v8 ' + RELAY + '/brackets/basketball-men/d1/2027 '));
});

test('no Cache Storage (iOS app, old browsers), or one that throws or never answers: the request still goes out', async () => {
  const app = createApp();
  const calls = [];
  app.fetch = async url => { calls.push(url); return { ok: true, json: async () => ({ ok: 1 }) }; };
  assert.deepEqual(await app.ncaa.fetchScoreboard('20270318'), { ok: 1 }, 'no caches global at all');
  await withCaches({ keys: async () => { throw new Error('SecurityError'); } }, async () => {
    assert.deepEqual(await app.ncaa.fetchScoreboard('20270318'), { ok: 1 }, 'caches.keys() rejects');
  });
  await withCaches({ keys: async () => ['a'], open: async () => ({ delete: async () => { throw new Error('boom'); } }) }, async () => {
    assert.deepEqual(await app.ncaa.fetchScoreboard('20270318'), { ok: 1 }, 'delete rejects');
  });
  await withCaches({ keys: () => new Promise(() => {}) }, async () => {
    const t0 = Date.now();
    assert.deepEqual(await app.ncaa.fetchScoreboard('20270318'), { ok: 1 }, 'caches.keys() never settles');
    assert.ok(Date.now() - t0 < 3000, 'waited about a second, not for ever');
  });
  assert.equal(calls.length, 4);
});
