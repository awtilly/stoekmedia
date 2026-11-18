const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* An unlocked commissioner may pick for the player on the clock. The pick is given to whoever is on the clock when
 * the write runs. If that player (or the auto-pick) picked in the same moment, the commissioner's team went to the
 * NEXT player in the order, who never chose it. */
let pagesLoaded = false;
function pickApp(roomCp) {
  const app = createApp();
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.roomId = 'R';
  app._pickInFlight = false;
  const toasts = [];
  app.showToast = m => toasts.push(m);
  app.updateAppBadge = () => {};
  app.replayDroppedSnapshot = () => {};
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' }, Timestamp: { fromDate: d => d.getTime() } } };
  const players = [{ id: 'a', name: 'Ann', teamIds: [] }, { id: 'b', name: 'Bob', teamIds: [] }];
  if (roomCp === 1) players[0].teamIds = ['t1'];
  const srv = { state: JSON.stringify({ players, teams: [1, 2, 3, 4].map(i => ({ id: 't' + i, name: 'T' + i, seed: i, region: 'South' })),
    ds: { started: true, complete: false, cp: roomCp, order: ['a', 'b', 'b', 'a'] } }) };
  app.db = {
    runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => ({ state: srv.state }) }), update: (ref, data) => { srv.state = data.state; } }),
    collection: () => ({ doc: () => ({}) })
  };
  return { app, toasts, room: () => JSON.parse(srv.state) };
}

test('commissioner pick: the draft moved on since the tap, so the team does not go to the next player', async () => {
  const { app, toasts, room } = pickApp(1);         // Ann has just picked t1 herself; the room is at Bob
  app.eval('adminUnlocked = true');
  await app.pickTeam('t2', 0);                      // the commissioner tapped t2 for Ann, at position 0
  assert.deepEqual(room().players.map(p => p.teamIds), [['t1'], []], 'Bob was not given t2');
  assert.equal(room().ds.cp, 1);
  assert.match(toasts.join('|'), /Another pick just came in/);
});

test('commissioner pick: with the draft where the screen showed it, the pick goes to the player on the clock', async () => {
  const { app, room } = pickApp(0);
  app.eval('adminUnlocked = true');
  await app.pickTeam('t2', 0);
  assert.deepEqual(room().players.map(p => p.teamIds), [['t2'], []]);
});

test('a player picking on their own turn is not affected by the position the tap carried', async () => {
  const { app, room } = pickApp(1);
  app.eval('adminUnlocked = false');
  app.getMyPlayerId = () => 'b';
  await app.pickTeam('t2', 0);                      // Bob's screen was a pick behind; it is his turn in the room
  assert.deepEqual(room().players.map(p => p.teamIds), [['t1'], ['t2']]);
});

test('a pick without a position (older callers) works as before', async () => {
  const { app, room } = pickApp(0);
  app.eval('adminUnlocked = true');
  await app.pickTeam('t3');
  assert.deepEqual(room().players.map(p => p.teamIds), [['t3'], []]);
});
