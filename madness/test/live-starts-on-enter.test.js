const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* A room opens on the tab this phone last used in it. Entering one from the lobby (a recent room, or a typed
 * code) with the Live tab remembered drew the tab but never started its score updates: navigate() starts them,
 * and entering a room does not go through navigate(). The scores stood still, finals were not picked up and the
 * screen was free to lock, until the person left the tab and came back. */

function lobby({ savedPhase, shellUp, typed }) {
  const app = createApp();
  const calls = [];
  app.window = { location: 'https://example.test/madness/', history: { replaceState() {} } };
  app.document = { getElementById: id => (id === 'room-code' ? { value: typed || '' } : id === 'c' && shellUp ? {} : null), addEventListener() {}, querySelector() { return null; } };
  app.loadState = () => { calls.push('loadState'); app.S.phase = savedPhase; }; // the room's stored view state
  app.checkAdminSession = () => {};
  app.connectToRoom = code => { calls.push('connect:' + code); };
  app.render = () => { calls.push('render'); };
  app.startLiveRefresh = () => { calls.push('startLive'); };
  return { app, calls };
}

test('a recent room whose remembered tab is Live starts the score updates', () => {
  const { app, calls } = lobby({ savedPhase: 'live', shellUp: true });
  app.rejoinRoom('ROOM1');
  assert.deepEqual(calls, ['loadState', 'connect:ROOM1', 'render', 'startLive']);
});

test('a typed room code does the same', () => {
  const { app, calls } = lobby({ savedPhase: 'live', shellUp: true, typed: 'room2' });
  app.joinRoom();
  assert.deepEqual(calls, ['loadState', 'connect:ROOM2', 'render', 'startLive']);
});

test('any other tab does not start them', () => {
  for (const phase of ['draft', 'bracket', 'leaderboard']) {
    const { app, calls } = lobby({ savedPhase: phase, shellUp: true, typed: 'ROOM2' });
    app.rejoinRoom('ROOM1');
    app.joinRoom();
    assert.ok(!calls.includes('startLive'), phase);
  }
});

test('behind the join screen (no app shell yet) nothing is started', () => {
  const { app, calls } = lobby({ savedPhase: 'live', shellUp: false, typed: 'ROOM2' });
  app.rejoinRoom('ROOM1');
  app.joinRoom();
  assert.ok(!calls.includes('startLive'));
});

test('a room code that is not valid enters nothing', () => {
  const { app, calls } = lobby({ savedPhase: 'live', shellUp: true, typed: '!' });
  app.joinRoom();
  app.rejoinRoom('');
  assert.deepEqual(calls, []);
});
