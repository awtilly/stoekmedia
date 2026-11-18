const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* Coming back to the app restarts the Live tab's updates. It did so whenever the remembered tab was Live, also
 * with no Live tab on screen: at the lobby, and behind the join screen of a pool this phone is not seated in.
 * There it meant a score request every 30 s, the screen kept awake, and the check for finished games running
 * for somebody who is not in the pool. Like the same step at page load, it now needs the app shell on screen. */

function app(phase, shellUp) {
  const a = createApp({ phase });
  const calls = [];
  a.document = { getElementById: id => (id === 'c' && shellUp ? {} : null), addEventListener() {}, querySelector() { return null; } };
  a.startLiveRefresh = () => { calls.push('start'); };
  a.stopLiveRefresh = () => { calls.push('stop'); };
  return { a, calls };
}

test('back in the app with the Live tab on screen: the updates start again', () => {
  const { a, calls } = app('live', true);
  a.liveVisibilityChanged(true);
  assert.deepEqual(calls, ['start']);
});

test('back in the app at the lobby or behind the join screen (Live only remembered): nothing starts', () => {
  const { a, calls } = app('live', false);
  a.liveVisibilityChanged(true);
  assert.deepEqual(calls, []);
});

test('back in the app on another tab: nothing starts', () => {
  for (const phase of ['draft', 'bracket', 'leaderboard']) {
    const { a, calls } = app(phase, true);
    a.liveVisibilityChanged(true);
    assert.deepEqual(calls, [], phase);
  }
});

test('going to the background always stops the updates', () => {
  for (const shellUp of [true, false]) {
    const { a, calls } = app('live', shellUp);
    a.liveVisibilityChanged(false);
    assert.deepEqual(calls, ['stop']);
  }
});
