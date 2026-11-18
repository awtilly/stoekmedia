const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* "Undo last pick" writes the room in a transaction of its own. Nothing stopped a second tap from starting a second
 * one, so a double tap took back two picks. And the pick it takes back is "the last one in the room when the
 * transaction runs": after a PIN prompt, or on a phone a moment behind, that could be a newer pick than the one
 * the commissioner was looking at. */
let pagesLoaded = false;
function undoApp(cpOnScreen) {
  const app = createApp();
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.roomId = 'R';
  app.requireAdmin = async () => true;
  const toasts = [];
  app.showToast = m => toasts.push(m);
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' }, Timestamp: { fromDate: d => d.getTime() } } };
  const srv = { state: JSON.stringify({
    players: [{ id: 'a', name: 'Ann', teamIds: ['t1', 't4'] }, { id: 'b', name: 'Bob', teamIds: ['t2', 't3'] }],
    teams: [1, 2, 3, 4].map(i => ({ id: 't' + i, name: 'T' + i, seed: i, region: 'South' })),
    ds: { started: true, complete: true, cp: 4, order: ['a', 'b', 'b', 'a'] }
  }) };
  app.db = {
    runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => ({ state: srv.state }) }), update: (ref, data) => { srv.state = data.state; } }),
    collection: () => ({ doc: () => ({}) })
  };
  app.S.ds = { started: true, complete: cpOnScreen === 4, cp: cpOnScreen, order: ['a', 'b', 'b', 'a'] };
  return { app, toasts, room: () => JSON.parse(srv.state) };
}

test('two taps on "Undo last pick" take back one pick', async () => {
  const { app, room } = undoApp(4);
  await Promise.all([app.undoDraft(), app.undoDraft()]);
  assert.equal(room().ds.cp, 3);
  assert.deepEqual(room().players.map(p => p.teamIds), [['t1'], ['t2', 't3']]);
});

test('a second, separate undo still works once the screen shows the new position', async () => {
  const { app, room } = undoApp(4);
  await app.undoDraft();
  app.S.ds.cp = 3;                                  // the room's update has arrived
  await app.undoDraft();
  assert.equal(room().ds.cp, 2);
});

test('an undo from a screen that is a pick behind is refused, with a message, and takes nothing back', async () => {
  const { app, toasts, room } = undoApp(3);         // the room is at 4: a pick landed that this screen has not shown
  await app.undoDraft();
  assert.equal(room().ds.cp, 4);
  assert.match(toasts.join('|'), /draft just moved on/);
  app.S.ds.cp = 4;                                  // now it shows it
  await app.undoDraft();
  assert.equal(room().ds.cp, 3, 'and the same tap works');
});
