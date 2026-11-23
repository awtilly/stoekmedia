const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A pick is confirmed, and while it is on its way the draft is reset and started again (or the last pick is undone).
 * The room is at the same position number as the screen showed, but it is a different draft: with a new order the
 * team went to whoever is first there, who never chose it. The tap now carries the draft it was made in. */
let pagesLoaded = false;
function pickApp(roomEpoch, order) {
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
  const srv = { state: JSON.stringify({ players, teams: [1, 2, 3, 4].map(i => ({ id: 't' + i, name: 'T' + i, seed: i, region: 'South' })),
    ds: { started: true, complete: false, cp: 0, epoch: roomEpoch, order } }) };
  app.db = {
    runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => ({ state: srv.state }) }), update: (ref, data) => { srv.state = data.state; } }),
    collection: () => ({ doc: () => ({}) })
  };
  return { app, toasts, room: () => JSON.parse(srv.state) };
}

test('commissioner pick: the draft was reset and started again since the tap, so the team does not go to the new first player', async () => {
  const { app, toasts, room } = pickApp(5, ['b', 'a', 'a', 'b']); // the new draft starts with Bob
  app.eval('adminUnlocked = true');
  await app.pickTeam('t2', 0, 3);                   // tapped for Ann, first in the draft the screen showed (epoch 3)
  assert.deepEqual(room().players.map(p => p.teamIds), [[], []], 'Bob was not given t2');
  assert.equal(room().ds.cp, 0);
  assert.match(toasts.join('|'), /The draft was just changed/);
});

test('a player\'s own pick from the draft before the reset does not land in the new one', async () => {
  const { app, toasts, room } = pickApp(5, ['b', 'a', 'a', 'b']);
  app.eval('adminUnlocked = false');
  app.getMyPlayerId = () => 'b';
  await app.pickTeam('t2', 0, 3);
  assert.deepEqual(room().players.map(p => p.teamIds), [[], []]);
  assert.match(toasts.join('|'), /The draft was just changed/);
});

test('the same draft as the screen showed: the pick lands', async () => {
  const { app, room } = pickApp(5, ['a', 'b', 'b', 'a']);
  app.eval('adminUnlocked = true');
  await app.pickTeam('t2', 0, 5);
  assert.deepEqual(room().players.map(p => p.teamIds), [['t2'], []]);
});

test('a pick that carries no draft (older callers) behaves as before', async () => {
  const { app, room } = pickApp(5, ['a', 'b', 'b', 'a']);
  app.eval('adminUnlocked = true');
  await app.pickTeam('t2', 0);
  assert.deepEqual(room().players.map(p => p.teamIds), [['t2'], []]);
});

test('a room saved before drafts were numbered: the screen and the room both count as draft 0', async () => {
  const { app, room } = pickApp(undefined, ['a', 'b', 'b', 'a']);
  app.eval('adminUnlocked = true');
  await app.pickTeam('t2', 0, 0);
  assert.deepEqual(room().players.map(p => p.teamIds), [['t2'], []]);
});
