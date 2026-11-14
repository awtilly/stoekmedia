const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* Opening the app straight onto the Live tab inside a room (the tab is remembered per device; the home-screen
 * shortcut asks for it) rendered the tab but never started the score updates: navigate() does that, and boot
 * does not go through navigate(). The boot script is run here against stubs that record what it calls. */
function boot({ search, savedPhase, shellUp }) {
  const calls = [];
  const sandbox = {
    window: { location: new URL('https://example.test/madness/' + search), history: { replaceState() {} }, addEventListener() {}, matchMedia: () => ({ matches: false }), navigator: {} },
    navigator: {},
    document: { getElementById: id => (id === 'c' && shellUp ? {} : null), querySelector: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
    URLSearchParams, URL, Array, setTimeout: () => 0, console,
    S: { phase: savedPhase, bracket: {}, bracketRegion: 'South', games: [] },
    roomId: null,
    sanitizeRoomCode: raw => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    getRecentRooms: () => [{ code: 'ROOM1' }],
    loadState() { calls.push('loadState'); },
    syncGames() {}, checkAdminSession() {},
    connectToRoom(code) { calls.push('connect:' + code); },
    render() { calls.push('render'); },
    renderLobby() { calls.push('lobby'); },
    startLiveRefresh() { calls.push('startLive'); },
    isIOSDevice: () => false,
    isNativeShell: false, rememberJoinKey() {}, // 00-constants / 70-logic globals that 90-boot.js reads since the invite-code change
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', '90-boot.js'), 'utf8'), sandbox, { filename: '90-boot.js' });
  return calls;
}

test('reopening a room whose remembered tab is Live starts the score updates', () => {
  const calls = boot({ search: '?room=ROOM1', savedPhase: 'live', shellUp: true });
  assert.deepEqual(calls, ['loadState', 'connect:ROOM1', 'render', 'startLive']);
});

test('the Live home-screen shortcut with a recent room starts the score updates', () => {
  const calls = boot({ search: '?tab=live', savedPhase: 'draft', shellUp: true });
  assert.deepEqual(calls, ['loadState', 'connect:ROOM1', 'render', 'startLive']);
});

test('any other tab does not start them', () => {
  for (const [search, savedPhase] of [['?room=ROOM1', 'draft'], ['?room=ROOM1&tab=bracket', 'live']]) {
    const calls = boot({ search, savedPhase, shellUp: true });
    assert.ok(!calls.includes('startLive'), search + ' / ' + savedPhase);
  }
});

test('behind the join screen (no app shell yet) nothing is started', () => {
  const calls = boot({ search: '?room=ROOM1', savedPhase: 'live', shellUp: false });
  assert.ok(!calls.includes('startLive'));
});
