const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* ncaa._get(): a request the network never answers used to stay pending for as long as the browser allowed
 * (minutes on a phone that has just lost signal). The bracket import sat on "Importing..." with its button
 * disabled, and each 30 s poll opened one more request that never settled. The request is now abandoned after
 * ncaa.timeoutMs and treated like any other failure (null), which the callers already handle. */

// A fetch that only ever settles when its signal is aborted.
const hangingFetch = (seen) => (url, opts) => new Promise((_, reject) => {
  seen.push({ url, signal: opts && opts.signal });
  const sig = opts && opts.signal;
  if (!sig) return; // no signal: hangs for good (what the test guards against)
  sig.addEventListener('abort', () => reject(sig.reason || new Error('aborted')));
});

test('ncaa._get: a request that never answers is abandoned after timeoutMs and returns null', async () => {
  const app = createApp();
  const seen = [];
  app.fetch = hangingFetch(seen);
  const saved = app.ncaa.timeoutMs;
  app.ncaa.timeoutMs = 20;
  try {
    const t0 = Date.now();
    const result = await app.ncaa.fetchScoreboard('20270318');
    assert.equal(result, null);
    assert.ok(Date.now() - t0 < 2000, 'gave up quickly');
    assert.equal(seen.length, 1);
    assert.ok(seen[0].signal, 'fetch received an abort signal');
    assert.ok(seen[0].url.endsWith('/scoreboard/basketball-men/d1/2027/03/18'));
  } finally { app.ncaa.timeoutMs = saved; }
});

test('ncaa._get: a request that answers in time returns its JSON and the timer does not fire later', async () => {
  const app = createApp();
  let aborted = false;
  app.fetch = async (url, opts) => {
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => { aborted = true; });
    return { ok: true, json: async () => ({ championships: [] }) };
  };
  const saved = app.ncaa.timeoutMs;
  app.ncaa.timeoutMs = 20;
  try {
    const data = await app.ncaa.fetchBracket(2027);
    assert.deepEqual(data, { championships: [] });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(aborted, false, 'a settled request is not aborted afterwards');
  } finally { app.ncaa.timeoutMs = saved; }
});

test('ncaa._get: a bracket import whose request never answers resolves to [] instead of hanging', async () => {
  const app = createApp({ year: 2027 });
  app.fetch = hangingFetch([]);
  const saved = app.ncaa.timeoutMs;
  app.ncaa.timeoutMs = 20;
  try {
    assert.deepEqual(await app.ncaa.fetchTournamentTeams(), []);
  } finally { app.ncaa.timeoutMs = saved; }
});
