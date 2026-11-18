const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* startDraft() in a room must start the draft against the SERVER copy of the state inside a
 * transaction (like pickTeam), so a second admin device with a stale lobby cannot overwrite a
 * draft that already has picks. 80-pages.js is loaded once on top of the harness. */
let pagesLoaded = false;
function draftApp(remoteState) {
  const app = createApp();
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  const calls = { update: 0, toasts: [], written: null };
  app.roomId = 'R';
  app.showToast = m => calls.toasts.push(m);
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' }, Timestamp: { fromDate: d => d.getTime() } } };
  app.db = {
    runTransaction: async fn => fn({
      get: async () => ({ exists: remoteState !== null, data: () => ({ state: JSON.stringify(remoteState) }) }),
      update: (ref, data) => { calls.update++; calls.written = JSON.parse(data.state); }
    }),
    collection: () => ({ doc: () => ({}) })
  };
  return { app, calls };
}

const twoPlayers = () => [{ id: 'a', name: 'Ann', teamIds: [] }, { id: 'b', name: 'Bob', teamIds: [] }];
const fourTeams = () => [1, 2, 3, 4].map(i => ({ id: 't' + i, name: 'T' + i, seed: i, region: 'South' }));

test('room: the draft starts from the server copy of players and teams, not the local one', async () => {
  const { app, calls } = draftApp({ players: [...twoPlayers(), { id: 'c', name: 'Cy', teamIds: [] }], teams: fourTeams(), ds: { started: false } });
  app.S.players = twoPlayers(); // stale lobby: Cy joined on another device
  app.S.teams = fourTeams();
  await app.startDraft();
  assert.equal(calls.update, 1);
  assert.equal(calls.written.ds.started, true);
  assert.deepEqual(calls.written.ds.order.slice(0, 3), ['a', 'b', 'c'], 'Cy is in the order');
  assert.equal(calls.written.ds.order.length, 4, 'one slot per team');
  assert.equal(app.__calls.saveState, 0, 'no whole-state write');
  assert.equal(app.S.ds.started, false, 'local state waits for the snapshot listener');
});

test('room: a stale lobby cannot restart a draft that already has picks', async () => {
  const remote = { players: twoPlayers(), teams: fourTeams(), ds: { started: true, cp: 1, order: ['a', 'b', 'b', 'a'] } };
  remote.players[0].teamIds = ['t1'];
  const { app, calls } = draftApp(remote);
  app.S.players = twoPlayers();
  app.S.teams = fourTeams();
  await app.startDraft();
  assert.equal(calls.update, 0, 'nothing written');
  assert.match(calls.toasts.join('|'), /already started/);
});

test('room: refuses when the server copy has too few players or teams', async () => {
  const { app, calls } = draftApp({ players: [twoPlayers()[0]], teams: fourTeams(), ds: { started: false } });
  app.S.players = [twoPlayers()[0]];
  app.S.teams = fourTeams();
  await app.startDraft();
  assert.equal(calls.update, 0);
  assert.match(calls.toasts.join('|'), /2\+ players/);
});

test('room: a missing room or a rejected transaction shows a toast and writes nothing', async () => {
  const gone = draftApp(null);
  gone.app.S.players = twoPlayers(); gone.app.S.teams = fourTeams();
  await gone.app.startDraft();
  assert.equal(gone.calls.update, 0);
  assert.match(gone.calls.toasts.join('|'), /Room not found/);
  const { app, calls } = draftApp({ players: twoPlayers(), teams: fourTeams(), ds: { started: false } });
  app.S.players = twoPlayers(); app.S.teams = fourTeams();
  app.db.runTransaction = async () => { throw new Error('offline'); };
  await app.startDraft();
  assert.equal(calls.update, 0);
  assert.match(calls.toasts.join('|'), /Start failed/);
});

test('locally started draft is refused a second time; solo rooms still start locally', async () => {
  const { app, calls } = draftApp({ players: twoPlayers(), teams: fourTeams(), ds: { started: false } });
  app.S.players = twoPlayers(); app.S.teams = fourTeams();
  app.S.ds = { started: true, cp: 0, order: ['a', 'b'] };
  await app.startDraft();
  assert.equal(calls.update, 0);
  app.S.ds = { started: false, cp: 0, order: [] };
  app.roomId = null;
  await app.startDraft();
  assert.equal(app.S.ds.started, true);
  assert.equal(app.S.ds.order.length, 4);
  assert.equal(app.__calls.saveState, 1);
  assert.equal(calls.update, 0);
});

/* The start reads the server copy. What this phone changed a moment ago (a player added, a bracket imported) may
 * not be there yet: the edit waits 0.8 s before it is sent, and then travels. Started in that gap, the draft order
 * was built without that player, who then arrived in the room with no turn. */
test('room: a player added on this phone a moment ago is not left out: the start waits for the save', async () => {
  const { app, calls } = draftApp({ players: twoPlayers(), teams: fourTeams(), ds: { started: false } });
  app.S.players = [...twoPlayers(), { id: 'c', name: 'Cy', teamIds: [] }]; // Cy was added here, not saved yet
  app.S.teams = fourTeams();
  await app.startDraft();
  assert.equal(calls.update, 0, 'the draft is not started');
  assert.match(calls.toasts.join('|'), /Still saving your last change/);
});

test('room: a bracket imported on this phone a moment ago is not replaced by the old teams under the draft', async () => {
  const { app, calls } = draftApp({ players: twoPlayers(), teams: fourTeams(), ds: { started: false } });
  app.S.players = twoPlayers();
  app.S.teams = [5, 6, 7, 8].map(i => ({ id: 'n' + i, name: 'N' + i, seed: i, region: 'East' })); // just imported here
  await app.startDraft();
  assert.equal(calls.update, 0);
  assert.match(calls.toasts.join('|'), /Still saving your last change/);
});

test('room: a team the room has and this screen does not yet also holds the start back', async () => {
  const { app, calls } = draftApp({ players: twoPlayers(), teams: fourTeams(), ds: { started: false } });
  app.S.players = twoPlayers();
  app.S.teams = fourTeams().slice(0, 3);
  await app.startDraft();
  assert.equal(calls.update, 0);
});

test('room: a team record this screen never showed (an id the app does not accept) does not hold the start back', async () => {
  const { app, calls } = draftApp({ players: twoPlayers(), teams: [...fourTeams(), { id: "x');alert(1", name: 'Bad', seed: 5, region: 'South' }], ds: { started: false } });
  app.S.players = twoPlayers();
  app.S.teams = fourTeams();
  await app.startDraft();
  assert.equal(calls.update, 1);
});

test('room: once the room has what this screen shows, the same tap starts the draft', async () => {
  const withCy = () => [...twoPlayers(), { id: 'c', name: 'Cy', teamIds: [] }];
  const { app, calls } = draftApp({ players: withCy(), teams: fourTeams(), ds: { started: false } });
  app.S.players = withCy();
  app.S.teams = fourTeams();
  await app.startDraft();
  assert.equal(calls.update, 1);
  assert.deepEqual(calls.written.ds.order.slice(0, 3), ['a', 'b', 'c']);
});
