const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* "Remove the no-show, tap Start Draft": the removal is saved a moment after the tap. Started before that save has
 * reached the room, the draft was built from the room's copy, which still had the removed player; the removal landed
 * afterwards and left that player's turns in the order with nobody to take them (the draft stops there). */
let pagesLoaded = false;
function draftApp(remoteState) {
  const app = createApp();
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  const calls = { update: 0, toasts: [], written: null, flushed: 0 };
  app.roomId = 'R';
  app.showToast = m => calls.toasts.push(m);
  app.requireAdmin = async () => true;
  app.saveState = () => {};
  app.render = () => {};
  app.flushFirestoreWrite = () => { calls.flushed++; };
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' }, Timestamp: { fromDate: d => d.getTime() } } };
  app.db = {
    runTransaction: async fn => fn({
      get: async () => ({ exists: true, data: () => ({ state: JSON.stringify(remoteState) }) }),
      update: (ref, data) => { calls.update++; calls.written = JSON.parse(data.state); }
    }),
    collection: () => ({ doc: () => ({}) })
  };
  return { app, calls };
}

const players = ids => ids.map(id => ({ id, name: 'N' + id, teamIds: [] }));
const fourTeams = () => [1, 2, 3, 4].map(i => ({ id: 't' + i, name: 'T' + i, seed: i, region: 'South' }));
const lobby = ids => ({ players: players(ids), teams: fourTeams(), ds: { started: false } });

test('room: a player removed on this phone a moment ago is not given turns: the start waits for the save', async () => {
  const { app, calls } = draftApp(lobby(['a1', 'b1', 'c1']));   // the room still has c1
  app.S.players = players(['a1', 'b1', 'c1']); app.S.teams = fourTeams(); app.S.ds = { started: false };
  await app.removePlayer('c1');
  await app.startDraft();
  assert.equal(calls.update, 0, 'the draft was not started with the removed player in it');
  assert.match(calls.toasts.join('|'), /Still saving your last change/);
  assert.equal(calls.flushed, 1, 'the waiting save is sent now');
});

test('room: once the removal has reached the room, the same tap starts the draft without that player', async () => {
  const { app, calls } = draftApp(lobby(['a2', 'b2']));
  app.S.players = players(['a2', 'b2', 'c2']); app.S.teams = fourTeams(); app.S.ds = { started: false };
  await app.removePlayer('c2');
  await app.startDraft();
  assert.equal(calls.update, 1);
  assert.ok(calls.written.ds.started);
  assert.ok(!calls.written.ds.order.includes('c2'));
});

test('room: a removal that did not go through (the player is back on this screen) does not hold the start back', async () => {
  const { app, calls } = draftApp(lobby(['a3', 'b3', 'c3']));
  app.S.players = players(['a3', 'b3', 'c3']); app.S.teams = fourTeams(); app.S.ds = { started: false };
  await app.removePlayer('c3');
  app.S.players = players(['a3', 'b3', 'c3']);                  // the room's copy came back onto the screen
  await app.startDraft();
  assert.equal(calls.update, 1);
  assert.ok(calls.written.ds.order.includes('c3'), 'in the draft like everybody else');
});

test('room: a player the room has and this screen never had (joined elsewhere a second ago) is in the draft as before', async () => {
  const { app, calls } = draftApp(lobby(['a4', 'b4', 'c4']));
  app.S.players = players(['a4', 'b4']); app.S.teams = fourTeams(); app.S.ds = { started: false };
  await app.startDraft();
  assert.equal(calls.update, 1);
  assert.ok(calls.written.ds.order.includes('c4'));
});
