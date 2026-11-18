const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* Opening the Live tab while the scoreboard document is missing or stale (always, until the server poll is on;
 * and during any outage) made two requests to the score relay: the document listener polled at once, and the
 * 1.5 s "document did not arrive" timer polled again. The listener's poll now cancels that timer. */

function fakeTimers() {
  const t = { timeouts: [], cleared: [] };
  const real = { setTimeout, clearTimeout, setInterval, clearInterval };
  globalThis.setTimeout = (fn, ms) => { t.timeouts.push({ fn, ms, id: 100 + t.timeouts.length + 1 }); return 100 + t.timeouts.length; };
  globalThis.clearTimeout = (id) => { t.cleared.push(id); };
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  t.restore = () => Object.assign(globalThis, real);
  return t;
}
function liveApp() {
  const app = createApp();
  app.autoResolvePlayIns = () => {};
  app.requestWakeLock = () => {};
  app.releaseWakeLock = () => {};
  const d = { ok: null, err: null };
  app.db = { collection: () => ({ doc: () => ({ onSnapshot: (ok, err) => { d.ok = ok; d.err = err; return () => {}; } }) }) };
  let polls = 0;
  app.refreshLiveScores = async () => { polls++; };
  return { app, d, polls: () => polls };
}
// What the browser would do with the 1.5 s timer: run it unless it was cleared.
function fireFallback(t) {
  const f = t.timeouts.find(x => x.ms === 1500);
  if (f && !t.cleared.includes(f.id)) f.fn();
}

test('document missing: one poll on open, not two', () => {
  const t = fakeTimers();
  try {
    const { app, d, polls } = liveApp();
    app.startLiveRefresh();
    d.ok({ exists: false, metadata: { fromCache: false } });
    fireFallback(t);
    assert.equal(polls(), 1);
  } finally { t.restore(); }
});

test('listener error: one poll on open, not two', () => {
  const t = fakeTimers();
  try {
    const { app, d, polls } = liveApp();
    app.startLiveRefresh();
    d.err({ code: 'permission-denied' });
    fireFallback(t);
    assert.equal(polls(), 1);
  } finally { t.restore(); }
});

test('the listener never answers (offline, nothing cached): the fallback still polls', () => {
  const t = fakeTimers();
  try {
    const { app, polls } = liveApp();
    app.startLiveRefresh();
    fireFallback(t);
    assert.equal(polls(), 1);
  } finally { t.restore(); }
});
