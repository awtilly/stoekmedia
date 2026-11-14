const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* A save that is on its way (the 800 ms debounce has fired, the server has not echoed it yet) and a snapshot
 * from another phone that predates it. The snapshot used to take the edit off the screen until the echo, and it
 * made the server's older value the baseline: a second edit to the same setting in that window was judged
 * "nothing to send" and the first save then landed on top of it.
 * Same hand-stepped fake server as sync-overlapping-saves.test.js. */
function steppedRoom() {
  const app = createApp();
  const srv = { state: null, v: 0 };
  const txs = [];
  const flush = () => new Promise(r => setImmediate(r));
  let failNext = null;
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: async fn => {
      const t = { go: null, done: false, runs: 0 };
      txs.push(t);
      const gate = () => new Promise(r => { t.go = r; });
      for (;;) {
        await gate();
        if (failNext) { const e = failNext; failNext = null; throw e; }
        const read = srv.state, v = srv.v;
        let out = null;
        t.runs++;
        await fn({ get: async () => ({ exists: true, data: () => ({ state: read }) }), set: (ref, data) => { out = data.state; } });
        await gate();
        if (srv.v !== v) continue;
        srv.state = out; srv.v++; t.done = true;
        return;
      }
    }
  };
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _lastSnapshotPlayerIds = null; _syncedShared = null; _sharedAtSync = null; _queuedPlainWrites = {}; _writeRetries = 0;');
  vm.runInThisContext('_serverSeen = null; _recentSent = []; _snapshotSeq = 0; _writeSeq = 0; _keyWriteNo = {}; _inFlight = {}; _rosterInFlight = {}; _pendingBase = {}; _echoWriteNo = 0; _lastRoomDoc = null; _pickInFlight = false;');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  const deliver = state => app._applyRoomSnapshot({ exists: true, data: () => ({ state }), metadata: {} });
  const shared = JSON.parse(JSON.stringify(app.S));
  for (const k of app.eval('VIEW_LOCAL')) delete shared[k];
  shared.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  shared.ub = true;
  srv.state = JSON.stringify(shared);
  deliver(srv.state); // the snapshot this device joined with
  return {
    app, srv, txs, deliver,
    server: () => JSON.parse(srv.state),
    /** Lets transaction i take its next step (read + compute, or commit). */
    step: async i => { txs[i].go(); await flush(); },
    /** Runs transaction i to its end, re-runs included. */
    finish: async i => { for (let n = 0; n < 8 && !txs[i].done; n++) { txs[i].go(); await flush(); } assert.equal(txs[i].done, true); },
    /** The 800 ms debounce runs out: the save starts and waits before its read. */
    fire: async () => { mock.timers.tick(800); await flush(); },
    /** Another phone changes the room; nothing reaches this device until deliver(). Returns the new state. */
    elsewhere: fn => { const r = JSON.parse(srv.state); fn(r); srv.state = JSON.stringify(r); srv.v++; return srv.state; },
    set: (k, v) => { app.S[k] = v; app._debouncedFirestoreWrite(); },
    failNextSave: () => { failNext = Object.assign(new Error('refused'), { code: 'aborted' }); }
  };
}
const withTimers = fn => async () => { mock.timers.enable({ apis: ['setTimeout'] }); try { await fn(); } finally { mock.timers.reset(); } };

test('a setting being saved stays on screen when an older, unrelated change arrives', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set, server, srv } = steppedRoom();
  set('ub', false);
  await fire();                                     // the save is on its way
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // another phone's scoring change, sent before our save landed
  assert.equal(app.S.rp[3], 9, 'the other phone\'s change is shown');
  assert.equal(app.S.ub, false, 'our own change did not flick back');
  await finish(0);
  deliver(srv.state);                               // the echo
  assert.equal(app.S.ub, false);
  assert.equal(server().ub, false);
  assert.equal(server().rp[3], 9, 'and the other phone\'s change was not overwritten');
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), [], 'nothing is held once the echo is in');
}));

test('toggled off, then on again while the first save is on its way and an older snapshot arrives: "on" reaches the server', withTimers(async () => {
  const { app, txs, finish, fire, elsewhere, deliver, set, server, srv } = steppedRoom();
  set('ub', false);
  await fire();                                     // save 1 (off) waits before its read
  set('ub', true);                                  // changed back: waiting in the debounce
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // an older snapshot: the server still says "on"
  assert.equal(app.S.ub, true);
  await fire();                                     // used to be "nothing to send": the snapshot agreed with the screen
  assert.equal(txs.length, 2, 'the second change is sent');
  await finish(0);                                  // save 1 lands "off"
  await finish(1);                                  // save 2 lands "on"
  assert.equal(server().ub, true, 'the last thing this phone chose is what the server holds');
  deliver(srv.state);
  assert.equal(app.S.ub, true);
}));

test('another phone changing the same setting still wins over a save in flight, as before', withTimers(async () => {
  const { app, fire, elsewhere, deliver, set } = steppedRoom();
  set('rp', Object.assign({}, app.S.rp, { 3: 9 }));
  await fire();
  deliver(elsewhere(r => { r.rp[3] = 7; }));        // new to this phone: not an older copy
  assert.equal(app.S.rp[3], 7, 'the snapshot is shown');
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('once the server has confirmed the save, a held-back snapshot that was not the state the save was built on is shown after all', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set, srv } = steppedRoom();
  set('ub', false);
  await fire();
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // held back for ub
  assert.equal(app.S.ub, false);
  elsewhere(r => { r.rp[4] = 11; });                // the room moves on again; that snapshot has not arrived yet
  await finish(0);                                  // the save commits on top of it and is confirmed
  // The phone cannot tell whether the snapshot it held back was older or newer than its save: it shows it, and
  // from here on takes every snapshot at its word. The echo then brings its own value back.
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
  deliver(srv.state);
  assert.equal(app.S.ub, false);
  assert.equal(app.S.rp[4], 11);
  assert.equal(JSON.stringify(app.eval('_sharedCopyOfS()').ub), JSON.stringify(JSON.parse(srv.state).ub), 'phone and server agree');
}));

test('a save that fails after a snapshot was held back for it is sent again by the retry', withTimers(async () => {
  const { app, txs, step, finish, fire, elsewhere, deliver, set, server, failNextSave } = steppedRoom();
  set('ub', false);
  await fire();
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // held back: the baseline for ub is now the value in flight
  failNextSave();
  await step(0);                                    // the server refuses the save
  assert.equal(app.S.ub, false, 'the edit is still on screen');
  await fire();                                     // the retry
  assert.equal(txs.length, 2, 'the retry has something to send');
  await finish(1);
  assert.equal(server().ub, false);
  assert.equal(server().rp[3], 9);
}));

test('the echo never arrives on its own (another phone changed the same setting right after): the phone still ends on what the server holds', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set, server } = steppedRoom();
  set('ub', false);
  await fire();
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // held back for ub; it is the state the save will be built on
  await finish(0);                                  // committed and confirmed: the server says "off"
  assert.equal(server().ub, false);
  const later = elsewhere(r => { r.ub = true; });   // another phone turns it on again before our echo is delivered
  deliver(later);                                   // one snapshot carrying both
  assert.equal(app.S.ub, true, 'after the save is confirmed a snapshot is taken at its word');
  assert.equal(app.S.ub, server().ub);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('toggled back while the first save is being retried: the confirmation of that save does not make the newer tap "nothing to send"', withTimers(async () => {
  const { app, step, finish, fire, elsewhere, deliver, set, server, srv } = steppedRoom();
  set('ub', false);
  await fire();                                     // save 1 is on its way
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // an older, unrelated change: held back for "ub"
  await step(0);                                    // save 1 has read the room
  const later = elsewhere(r => { r.year = 2031; }); // another phone commits first: save 1 will be run again
  set('ub', true);                                  // tapped back; this edit waits in the debounce
  await finish(0);                                  // save 1 lands ("off") and is confirmed
  assert.equal(server().ub, false);
  assert.equal(app.S.ub, true, 'the newer tap stays on screen');
  await fire();                                     // the debounce runs out
  await finish(1);
  assert.equal(server().ub, true, 'the newer tap reached the server');
  deliver(later);
  deliver(srv.state);
  assert.equal(app.S.ub, true);
  assert.equal(app.S.year, 2031);
  assert.equal(app.S.rp[3], 9);
}));

test('a player who joined on another phone while a save was on its way is not removed by the next roster change made here', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set, server, srv } = steppedRoom();
  set('ub', false);
  await fire();                                     // save 1 is on its way
  const joined = elsewhere(r => { r.players.push({ id: 'n1', name: 'New', teamIds: [] }); }); // not shown here yet
  await finish(0);                                  // save 1 lands on top of it and keeps the new player
  assert.deepEqual(server().players.map(p => p.id), ['p1', 'n1']);
  set('players', app.S.players.concat([{ id: 'n2', name: 'Mine', teamIds: [] }])); // this phone adds somebody
  deliver(joined);                                  // only now does the other phone's join arrive
  assert.deepEqual(app.S.players.map(p => p.id).sort(), ['n1', 'n2', 'p1'], 'both the join and the local add are shown');
  await fire();
  await finish(1);
  assert.deepEqual(server().players.map(p => p.id).sort(), ['n1', 'n2', 'p1'], 'nobody was taken out of the room');
  deliver(srv.state);
  assert.deepEqual(app.S.players.map(p => p.id).sort(), ['n1', 'n2', 'p1']);
}));

test('a player this phone added and removed again before the save was confirmed stays removed', withTimers(async () => {
  const { app, finish, fire, deliver, set, server, srv } = steppedRoom();
  set('players', app.S.players.concat([{ id: 'n3', name: 'Oops', teamIds: [] }]));
  await fire();                                     // the save with the new player is on its way
  set('players', app.S.players.filter(p => p.id !== 'n3')); // removed again straight away
  await finish(0);
  assert.deepEqual(server().players.map(p => p.id), ['p1', 'n3']);
  deliver(srv.state);                               // the first save's echo arrives while the removal waits
  await fire();
  await finish(1);
  assert.deepEqual(server().players.map(p => p.id), ['p1'], 'the removal reached the server');
  deliver(srv.state);
  assert.deepEqual(app.S.players.map(p => p.id), ['p1']);
}));

test('off, on, off in quick succession with two saves on their way: the room a save was built on is not taken for its confirmation', withTimers(async () => {
  const { app, step, finish, fire, elsewhere, deliver, set, server, srv, txs } = steppedRoom();
  const before = elsewhere(r => { r.rp[3] = 9; }); // another phone changed the scoring; not shown here yet
  set('ub', false);
  await fire();                                     // save 1 ("off") starts
  await step(0);                                    // ... and has read the room
  set('ub', true);
  await fire();                                     // save 2 ("on") starts
  await step(1);                                    // ... and has read the same room
  set('ub', false);                                 // tapped off again: waits in the debounce
  await finish(0);                                  // save 1 lands: the room says "off"
  const afterFirst = srv.state;
  deliver(before);                                  // the room both saves were built on ("on", like save 2)
  deliver(afterFirst);                              // save 1 as the server has it
  assert.equal(app.S.ub, false, 'the last tap stays on screen');
  await fire();                                     // the debounce runs out: the last tap has to be sent
  await finish(1);                                  // save 2 is run again and must not put "on" back
  if (txs[2]) await finish(2);
  assert.equal(server().ub, false, 'the last tap is what the room ends on');
  deliver(srv.state);
  assert.equal(app.S.ub, false);
  assert.equal(app.S.rp[3], 9);
}));

const NEW = { id: 'n5', name: 'Late', teamIds: [] };
test('a player being added stays on screen when an older, unrelated change arrives', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set, server, srv } = steppedRoom();
  set('players', app.S.players.concat([NEW]));
  await fire();                                     // the save is on its way
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // sent before our save landed: it has no such player
  assert.equal(app.S.rp[3], 9, 'the other change is shown');
  assert.deepEqual(app.S.players.map(p => p.id), ['p1', 'n5'], 'the new player did not drop off the list');
  await finish(0);
  assert.deepEqual(server().players.map(p => p.id), ['p1', 'n5']);
  deliver(srv.state);                               // the echo
  assert.deepEqual(app.S.players.map(p => p.id), ['p1', 'n5']);
  assert.equal(app.eval('Object.keys(_rosterInFlight).length'), 0);
}));

test('a save adding a player that fails after an older snapshot arrived is sent again by the retry', withTimers(async () => {
  const { app, txs, step, finish, fire, elsewhere, deliver, set, server, failNextSave } = steppedRoom();
  set('players', app.S.players.concat([NEW]));
  await fire();
  deliver(elsewhere(r => { r.rp[3] = 9; }));
  failNextSave();
  await step(0);                                    // the server refuses the save
  assert.deepEqual(app.S.players.map(p => p.id), ['p1', 'n5'], 'the new player is still on screen');
  await fire();                                     // the retry
  assert.equal(txs.length, 2, 'the retry has something to send');
  await finish(1);
  assert.deepEqual(server().players.map(p => p.id), ['p1', 'n5'], 'the player reached the room');
  assert.equal(server().rp[3], 9);
}));

test('a player kept on screen that way does not make the next save for something else send the roster again', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set, server } = steppedRoom();
  set('players', app.S.players.concat([NEW]));
  await fire();
  deliver(elsewhere(r => { r.rp[3] = 9; }));        // older snapshot: the new player is kept
  await finish(0);                                  // the player is in the room
  elsewhere(r => { r.players = r.players.filter(p => p.id !== 'p1'); }); // another phone removes Ann; not shown here yet
  set('ub', false);                                 // an unrelated tap on this phone
  await fire();
  await finish(1);
  assert.equal(server().ub, false);
  assert.deepEqual(server().players.map(p => p.id), ['n5'], 'the removal made elsewhere was not undone');
}));

test('a player removed here again while the save adding them is on its way is not put back by an older snapshot', withTimers(async () => {
  const { app, fire, elsewhere, deliver, set } = steppedRoom();
  set('players', app.S.players.concat([NEW]));
  await fire();
  app.S.players = app.S.players.filter(p => p.id !== 'n5'); // removed on this phone; the debounce is not armed in this test
  deliver(elsewhere(r => { r.rp[3] = 9; }));
  assert.deepEqual(app.S.players.map(p => p.id), ['p1']);
  assert.equal(app.eval('Object.keys(_rosterInFlight).length'), 0);
}));
