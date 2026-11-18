const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* Leaving a room for the lobby (goHome) stopped the Live polling and flushed the pending write, but not the
 * 250 ms draft-clock tick or the autopick retry timer: render() is what stops the tick, and the lobby never
 * calls render(). Both kept firing in the lobby as no-ops against the default state. 80-pages.js is run
 * against stubs here; the real timers are used and checked through the module's own variables. */
function load() {
  const calls = [];
  const sandbox = {
    window: { addEventListener() {}, location: new URL('https://example.test/madness/?room=AAAA'), history: { replaceState() {} }, AudioContext: undefined },
    document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} }, activeElement: null },
    navigator: {},
    URL, URLSearchParams, setInterval, clearInterval, setTimeout, clearTimeout, console, Date, Math, JSON,
    requestAnimationFrame: () => 0,
    S: { ds: { started: true, complete: false, pickDeadline: { toMillis: () => Date.now() + 60000 }, timerPaused: false, order: ['p1'], cp: 0 }, players: [], teams: [], phase: 'draft', rp: {}, games: [] },
    roomId: 'AAAA', unsubRoom: null, adminUnlocked: false,
    firebase: { firestore: { Timestamp: function () {} } },
    stopLiveRefresh() { calls.push('stopLive'); },
    flushFirestoreWrite() { calls.push('flush'); },
    loadState() { calls.push('loadState'); sandbox.S = { ds: {}, players: [], teams: [] }; },
    renderLobby() { calls.push('lobby'); },
    getMyPlayerId: () => 'p1',
    showToast() {}, escapeHtml: s => String(s),
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), sandbox, { filename: '80-pages.js' });
  const get = expr => vm.runInContext(expr, sandbox);
  return { sandbox, calls, get };
}

test('goHome stops the draft-clock tick that render() started', () => {
  const { sandbox, get } = load();
  sandbox.startDraftClock();
  assert.ok(get('_draftClockInterval') !== null, 'the tick is running in the room');
  sandbox.goHome();
  assert.equal(get('_draftClockInterval'), null, 'and stopped on leaving it');
});

test('goHome clears a pending autopick retry', () => {
  const { sandbox, get } = load();
  sandbox.scheduleAutoPickRetry();
  assert.ok(get('_autoPickRetry') !== null, 'a retry is pending');
  sandbox.goHome();
  assert.equal(get('_autoPickRetry'), null);
});

test('goHome still flushes the write before clearing the room, then shows the lobby', () => {
  const { sandbox, calls } = load();
  sandbox.goHome();
  assert.deepEqual(calls, ['stopLive', 'flush', 'loadState', 'lobby']);
  assert.equal(sandbox.roomId, null);
});
