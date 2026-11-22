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

/* The new draft must outrank everything the room has seen. Its epoch used to come from this screen only: a start
 * on a screen that had not been shown the last reset or undo gave the new draft a LOWER epoch than the room's. */
test('room: the new draft outranks the room, also when this screen is behind on resets and undos', async () => {
  const { app, calls } = draftApp({ players: twoPlayers(), teams: fourTeams(), ds: { started: false, order: [], cp: 0, epoch: 5 } });
  app.S.players = twoPlayers();
  app.S.teams = fourTeams();
  app.S.ds = { started: false, order: [], cp: 0, epoch: 2 }; // this screen: two resets behind
  await app.startDraft();
  assert.equal(calls.update, 1);
  assert.equal(calls.written.ds.epoch, 6);
});

test('room: a screen ahead of the room still counts on from its own epoch', async () => {
  const { app, calls } = draftApp({ players: twoPlayers(), teams: fourTeams(), ds: { started: false, order: [], cp: 0, epoch: 1 } });
  app.S.players = twoPlayers();
  app.S.teams = fourTeams();
  app.S.ds = { started: false, order: [], cp: 0, epoch: 4 }; // a reset made here, still on its way
  await app.startDraft();
  assert.equal(calls.written.ds.epoch, 5);
});
