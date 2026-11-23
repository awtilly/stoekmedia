const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Reset Draft in a room is a transaction on the room's copy, like Start Draft, Undo and every pick. It used to be a
 * change on the commissioner's screen sent a moment later with everything else; an Undo or picks reaching the room in
 * that moment could win over it, and the draft kept running without a word. */
let pagesLoaded = false;
function draftApp(remoteState, opts) {
  const app = createApp();
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  const calls = { update: 0, toasts: [], written: null, saved: 0 };
  app.roomId = 'R';
  app.showToast = m => calls.toasts.push(m);
  app.requireAdmin = async () => true;
  app.appConfirm = async () => true;
  app.saveState = () => { calls.saved++; };
  app.render = () => {};
  app.stopDraftClock = () => {};
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' }, Timestamp: { fromDate: d => d.getTime() } } };
  app.db = {
    runTransaction: async fn => {
      if (opts && opts.fail) throw Object.assign(new Error('contention'), { code: 'aborted' });
      return fn({
        get: async () => ({ exists: true, data: () => ({ state: JSON.stringify(remoteState) }) }),
        update: (ref, data) => { calls.update++; calls.written = JSON.parse(data.state); }
      });
    },
    collection: () => ({ doc: () => ({}) })
  };
  return { app, calls };
}
const running = (cp, epoch) => ({
  players: [{ id: 'a', name: 'A', teamIds: cp > 0 ? ['t1'] : [] }, { id: 'b', name: 'B', teamIds: cp > 1 ? ['t2'] : [] }],
  teams: ['t1', 't2', 't3', 't4'].map((id, i) => ({ id, name: id, seed: i + 1, region: 'South' })),
  ds: { order: ['a', 'b', 'b', 'a'], cp, started: true, complete: false, epoch },
  ub: true
});

test('room: Reset Draft is written against the room, one draft number above it, with empty rosters', async () => {
  const { app, calls } = draftApp(running(2, 1));
  Object.assign(app.S, running(2, 1));
  await app.resetDraft();
  assert.equal(calls.update, 1);
  assert.equal(calls.written.ds.started, false);
  assert.equal(calls.written.ds.epoch, 2);
  assert.deepEqual(calls.written.players.map(p => p.teamIds.length), [0, 0]);
  assert.equal(calls.saved, 0, 'not sent with the whole-state save any more');
});

test('room: an Undo this screen has not been shown does not outrank the reset', async () => {
  const { app, calls } = draftApp(running(1, 2));   // the room: one pick undone, draft number 2
  Object.assign(app.S, running(2, 1));              // this screen: still draft number 1
  await app.resetDraft();
  assert.equal(calls.written.ds.started, false);
  assert.equal(calls.written.ds.epoch, 3, 'above the room, so every phone takes the reset');
});

test('room: everything else in the room is left as the room holds it', async () => {
  const room = running(2, 1); room.ub = false; room.players.push({ id: 'c', name: 'C', teamIds: [] });
  const { app, calls } = draftApp(room);
  Object.assign(app.S, running(2, 1));              // this screen has not been shown ub or the late joiner
  await app.resetDraft();
  assert.equal(calls.written.ub, false);
  assert.deepEqual(calls.written.players.map(p => p.id), ['a', 'b', 'c']);
});

test('room: a reset that cannot be written says so and leaves the screen alone', async () => {
  const { app, calls } = draftApp(running(2, 1), { fail: true });
  Object.assign(app.S, running(2, 1));
  await app.resetDraft();
  assert.equal(calls.update, 0);
  assert.match(calls.toasts.join('|'), /Reset failed/);
  assert.equal(app.S.ds.started, true, 'the screen still shows the draft the room has');
});

test('no room: Reset Draft works on this phone as before', async () => {
  const { app, calls } = draftApp(running(2, 1));
  app.roomId = null;
  Object.assign(app.S, running(2, 1));
  await app.resetDraft();
  assert.equal(calls.update, 0);
  assert.equal(app.S.ds.started, false);
  assert.equal(calls.saved, 1);
});

test('room: a second Reset tapped before the first is confirmed is answered, not dropped without a word', async () => {
  const { app, calls } = draftApp(running(2, 1));
  Object.assign(app.S, running(2, 1));
  let release; const held = new Promise(r => { release = r; });
  app.db.runTransaction = async () => { calls.update++; await held; };
  const first = app.resetDraft();
  await new Promise(r => setImmediate(r));
  await app.resetDraft();
  assert.equal(calls.update, 1, 'one write at a time');
  assert.match(calls.toasts.join('|'), /Still resetting/);
  release(); await first;
  await app.resetDraft();
  assert.equal(calls.update, 2, 'and the next tap goes through');
});
