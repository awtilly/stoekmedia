const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Every write to the room carries updatedAt, the server's commit time. A save remembers the commit time of the
 * room it was built on, so a snapshot stamped no later than that is known to be older than the save: it must not
 * take the saved value off the screen or become the baseline for the next change, even after the server has
 * confirmed the save (snapshots sent before the commit can still arrive after the confirmation).
 * Same hand-stepped fake server as sync-inflight-edits.test.js, with a commit time on every read and snapshot. */
function stampedRoom() {
  const app = createApp();
  const srv = { state: null, v: 0 };
  const txs = [];
  const flush = () => new Promise(r => setImmediate(r));
  const stamp = v => ({ seconds: 1000 + v, nanoseconds: 0 });
  app.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: function () {} } };
  app.db = {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: async fn => {
      const t = { go: null, done: false };
      txs.push(t);
      const gate = () => new Promise(r => { t.go = r; });
      for (;;) {
        await gate();
        const read = srv.state, v = srv.v;
        let out = null;
        await fn({ get: async () => ({ exists: true, data: () => ({ state: read, updatedAt: stamp(v) }) }), set: (ref, data) => { out = data.state; } });
        await gate();
        if (srv.v !== v) continue;
        srv.state = out; srv.v++; t.done = true;
        return;
      }
    }
  };
  app.roomId = 'AAAA';
  vm.runInThisContext('_firestoreWriteTimer = null; _isRemoteUpdate = false; _lastSyncedState = null; _syncBase = null; _lastSnapshotPlayerIds = null; _syncedShared = null; _sharedAtSync = null; _queuedPlainWrites = {}; _writeRetries = 0;');
  vm.runInThisContext('_serverSeen = null; _recentSent = []; _snapshotSeq = 0; _writeSeq = 0; _keyWriteNo = {}; _inFlight = {}; _rosterInFlight = {}; _rosterGone = {}; _rosterAcked = {}; _rosterRemovedNo = {}; _rosterRemoving = {}; _pendingBase = {}; _echoWriteNo = 0; _lastRoomDoc = null; _pickInFlight = false;');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  /** What the room holds right now, with its commit time: a snapshot to deliver later. */
  const now = () => ({ state: srv.state, v: srv.v });
  const deliver = snap => app._applyRoomSnapshot({ exists: true, data: () => ({ state: snap.state, updatedAt: stamp(snap.v) }), metadata: {} });
  const shared = JSON.parse(JSON.stringify(app.S));
  for (const k of app.eval('VIEW_LOCAL')) delete shared[k];
  shared.players = [{ id: 'p1', name: 'Ann', teamIds: [] }];
  shared.ub = true;
  shared.year = 2027;
  srv.state = JSON.stringify(shared);
  deliver(now()); // the snapshot this device joined with
  return {
    app, srv, txs, deliver, now,
    server: () => JSON.parse(srv.state),
    step: async i => { txs[i].go(); await flush(); },
    finish: async i => { for (let n = 0; n < 8 && !txs[i].done; n++) { txs[i].go(); await flush(); } assert.equal(txs[i].done, true); },
    fire: async () => { mock.timers.tick(800); await flush(); },
    /** Another phone changes the room; nothing reaches this device until deliver(). Returns that snapshot. */
    elsewhere: fn => { const r = JSON.parse(srv.state); fn(r); srv.state = JSON.stringify(r); srv.v++; return now(); },
    set: (k, v) => { app.S[k] = v; app._debouncedFirestoreWrite(); }
  };
}
const withTimers = fn => async () => { mock.timers.enable({ apis: ['setTimeout'] }); try { await fn(); } finally { mock.timers.reset(); } };

test('a snapshot from before a confirmed save does not put the old value back, and choosing that old value again is sent', withTimers(async () => {
  const { app, txs, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const older = elsewhere(r => { r.rp[3] = 9; });   // another phone's change: its snapshot is still on its way
  set('year', 2029);
  await fire();
  await finish(0);                                  // read, committed and confirmed before that snapshot arrives
  assert.equal(server().year, 2029);
  const echo = now();
  deliver(older);                                   // older than the save: the room it shows still says 2027
  assert.equal(app.S.rp[3], 9, 'the other phone\'s change is shown');
  assert.equal(app.S.year, 2029, 'the saved year did not flick back');
  set('year', 2028);
  set('year', 2027);                                // back to what the older snapshot said
  await fire();
  assert.equal(txs.length, 2, 'a change, not "nothing to send"');
  await finish(1);
  assert.equal(server().year, 2027, 'the last year this phone chose is what the server holds');
  deliver(echo);
  deliver(now());
  assert.equal(app.S.year, 2027);
  assert.equal(app.S.rp[3], 9);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), [], 'nothing is held once the room has caught up');
}));

test('a held-back snapshot older than the save is not shown when the save is confirmed', withTimers(async () => {
  const { app, txs, step, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const first = elsewhere(r => { r.rp[3] = 9; });   // two changes on other phones, neither delivered yet
  const second = elsewhere(r => { r.rp[4] = 11; });
  set('ub', false);
  await fire();
  await step(0);                                    // the save reads the room as of the second change
  deliver(first);                                   // older than that: held back for ub
  assert.equal(app.S.ub, false);
  await finish(0);                                  // committed and confirmed
  assert.equal(app.S.ub, false, 'the confirmation did not bring the older snapshot\'s value back');
  const echo = now();
  set('ub', false);                                 // (a change only where the old value had come back)
  set('ub', true);
  await fire();
  assert.equal(txs.length, 2, 'switching it back on is a change');
  await finish(1);
  assert.equal(server().ub, true, 'the last thing this phone chose is what the server holds');
  deliver(second);
  deliver(echo);
  deliver(now());
  assert.equal(app.S.ub, true);
  assert.equal(app.S.rp[3], 9);
  assert.equal(app.S.rp[4], 11);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('the same value in a snapshot older than the save is not taken for the save\'s echo', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const a = elsewhere(r => { r.year = 2029; });     // another phone picks 2029, then goes back to 2027
  const b = elsewhere(r => { r.year = 2027; });
  set('year', 2029);                                // this phone has seen neither and picks 2029 itself
  await fire();
  await finish(0);                                  // built on 2027, confirmed
  assert.equal(server().year, 2029);
  deliver(a);                                       // 2029, but older than the save: not its echo
  deliver(b);                                       // 2027, older than the save as well
  assert.equal(app.S.year, 2029, 'the saved year is still on screen');
  deliver(now());                                   // the save's own snapshot
  assert.equal(app.S.year, 2029);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('a snapshot newer than a confirmed save is still taken at its word', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set } = stampedRoom();
  set('year', 2029);
  await fire();
  await finish(0);
  deliver(elsewhere(r => { r.year = 2027; }));      // another phone sets it back after our save: newer, so it wins
  assert.equal(app.S.year, 2027);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('a snapshot without a commit time is handled as before', withTimers(async () => {
  const { app, finish, fire, elsewhere, set } = stampedRoom();
  const older = elsewhere(r => { r.rp[3] = 9; });
  set('year', 2029);
  await fire();
  await finish(0);
  // (a write of this phone the server has not stamped yet reads as null)
  app._applyRoomSnapshot({ exists: true, data: () => ({ state: older.state, updatedAt: null }), metadata: {} });
  assert.equal(app.S.year, 2027, 'after the confirmation an unstamped snapshot is the server\'s word');
}));

test('a save whose own snapshot carries the same commit time as the room it was built on still settles', withTimers(async () => {
  const { app, finish, fire, elsewhere, deliver, set, server, srv } = stampedRoom();
  set('year', 2029);
  await fire();
  await finish(0);                                  // built on the room stamped v0
  assert.equal(server().year, 2029);
  deliver({ state: srv.state, v: 0 });              // the save's own snapshot, with that same stamp
  assert.equal(app.S.year, 2029);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), [], 'not held: a different document with an equal stamp is not older');
  const back = elsewhere(r => { r.year = 2027; });  // another phone sets it back afterwards: same stamp again
  deliver({ state: back.state, v: 0 });
  assert.equal(app.S.year, 2027, 'the later change is shown');
}));

test('the room a save was built on, arriving after the confirmation with its own commit time, is still older than the save', withTimers(async () => {
  const { app, finish, fire, deliver, now, set, elsewhere } = stampedRoom();
  const pre = elsewhere(r => { r.rp[3] = 9; });     // the room the save will read; its snapshot is on its way
  set('year', 2029);
  await fire();
  await finish(0);
  deliver(pre);                                     // equal stamp AND the very room the save read
  assert.equal(app.S.year, 2029, 'the saved year did not flick back');
  deliver(now());
  assert.equal(app.S.year, 2029);
  assert.deepEqual(app.eval('Object.keys(_inFlight)'), []);
}));

test('a player added by a confirmed save and taken off again after an older snapshot stays off: the removal is sent', withTimers(async () => {
  const { app, txs, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  const ids = () => app.S.players.map(p => p.id);
  const older = elsewhere(r => { r.rp[3] = 9; });   // the room the save will read; its snapshot is still on its way
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);                                  // n1 is in the room, confirmed
  set('players', app.S.players.concat([N('n2')]));  // another new player: waiting in the debounce
  deliver(older);                                   // older than the save: no n1 in it
  assert.deepEqual(ids(), ['p1', 'n1', 'n2']);
  set('players', app.S.players.filter(p => p.id === 'p1')); // both taken off again
  deliver(now());                                   // the room with n1
  assert.deepEqual(ids(), ['p1'], 'n1 is not put back on the screen');
  await fire();
  for (let i = 0; i < txs.length; i++) await finish(i);
  assert.deepEqual(server().players.map(p => p.id), ['p1'], 'n1 is out of the room');
}));

/** A snapshot whose document carries no commit time (written by a phone still on the previous version of the app). */
const bare = (app, snap) => app._applyRoomSnapshot({ exists: true, data: () => ({ state: snap.state, updatedAt: null }), metadata: {} });

test('an older snapshot that carries no commit time does not undo a confirmed added player: taking them off is still sent', withTimers(async () => {
  const { app, txs, finish, fire, elsewhere, deliver, now, set, server } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  const ids = () => app.S.players.map(p => p.id);
  const older = elsewhere(r => { r.rp[3] = 9; });   // an older room; its snapshot is still on its way
  elsewhere(r => { r.rp[4] = 9; });                 // the (stamped) room the save will read
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);                                  // n1 is in the room, confirmed
  set('players', app.S.players.concat([N('n2')]));  // another new player: waiting in the debounce
  bare(app, older);                                 // no n1 in it, and no commit time to place it by
  assert.deepEqual(ids(), ['p1', 'n1', 'n2']);
  set('players', app.S.players.filter(p => p.id === 'p1')); // both taken off again
  deliver(now());                                   // the room with n1
  assert.deepEqual(ids(), ['p1'], 'n1 is not put back on the screen');
  await fire();
  for (let i = 0; i < txs.length; i++) await finish(i);
  assert.deepEqual(server().players.map(p => p.id), ['p1'], 'n1 is out of the room');
}));

test('a snapshot with no commit time that has the confirmed player ends the wait for them', withTimers(async () => {
  const { app, finish, fire, elsewhere, set, srv } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  elsewhere(r => { r.rp[3] = 9; });
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);
  assert.deepEqual(app.eval('Object.keys(_rosterAcked)'), ['n1']);
  bare(app, { state: srv.state });
  assert.deepEqual(app.eval('Object.keys(_rosterAcked)'), []);
  assert.deepEqual(app.eval('Object.keys(_rosterInFlight)'), []);
}));

test('another phone taking a confirmed player off is believed even when none of its snapshots carries a commit time', withTimers(async () => {
  const { app, txs, finish, fire, elsewhere, set, server } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  const ids = () => app.S.players.map(p => p.id);
  elsewhere(r => { r.rp[3] = 9; });
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);                                  // n1 is in the room, confirmed; this phone has not seen it come back yet
  const gone = elsewhere(r => { r.players = r.players.filter(p => p.id !== 'n1'); }); // a phone on the old version removes n1
  bare(app, gone);
  const again = elsewhere(r => { r.rp[5] = 9; });
  bare(app, again);
  const third = elsewhere(r => { r.rp[6] = 9; });
  bare(app, third);
  assert.deepEqual(ids(), ['p1'], 'n1 is off this screen too');
  set('year', 2029);                                // any later save of this phone
  await fire();
  for (let i = 0; i < txs.length; i++) await finish(i);
  assert.deepEqual(server().players.map(p => p.id), ['p1'], 'n1 was not written back');
  assert.equal(server().year, 2029);
}));

test('once the room the save read has been seen, the first snapshot without the player ends the wait, commit time or not', withTimers(async () => {
  const { app, txs, finish, fire, elsewhere, deliver, set, server } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  const pre = elsewhere(r => { r.rp[3] = 9; });
  deliver(pre);                                     // this phone is up to date before it saves
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);
  assert.deepEqual(app.eval('Object.keys(_rosterAcked)'), ['n1']);
  bare(app, elsewhere(r => { r.players = r.players.filter(p => p.id !== 'n1'); })); // removed on a phone with the old version
  assert.deepEqual(app.S.players.map(p => p.id), ['p1'], 'n1 is off this screen at once');
  assert.deepEqual(app.eval('Object.keys(_rosterInFlight)'), []);
  set('year', 2029);
  await fire();
  for (let i = 0; i < txs.length; i++) await finish(i);
  assert.deepEqual(server().players.map(p => p.id), ['p1'], 'n1 was not written back');
}));

test('the room the save read, arriving late without a commit time, keeps the wait; the next snapshot ends it', withTimers(async () => {
  const { app, finish, fire, elsewhere, set } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  const pre = elsewhere(r => { r.rp[3] = 9; });
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await finish(0);
  bare(app, pre);                                   // the very room the save read: older than the save
  assert.deepEqual(app.S.players.map(p => p.id), ['p1', 'n1'], 'n1 stays on the screen');
  assert.deepEqual(app.eval('Object.keys(_rosterAcked)'), ['n1']);
  bare(app, elsewhere(r => { r.players = r.players.filter(p => p.id !== 'n1'); r.rp[4] = 9; })); // (alone it would read exactly like the room before)
  assert.deepEqual(app.S.players.map(p => p.id), ['p1'], 'a removal after it is believed');
  assert.deepEqual(app.eval('Object.keys(_rosterAcked)'), []);
}));

test('a save confirmed only after a newer update that no longer has its new player does not keep that player on the screen', withTimers(async () => {
  const { app, txs, srv, step, fire, elsewhere, deliver, set, server, finish } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  const ids = () => app.S.players.map(p => p.id);
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await step(0);                                    // the transaction has read the room
  // The moment the save lands, another phone takes n1 off again, and that update reaches this phone before the
  // save's confirmation does (the phone was behind: it never sees the room that had n1).
  let v = srv.v, after = () => { after = null; deliver(elsewhere(r => { r.players = r.players.filter(p => p.id !== 'n1'); r.rp[4] = 9; })); };
  Object.defineProperty(srv, 'v', { get: () => v, set: x => { v = x; if (after) after(); }, configurable: true });
  await finish(0);                                  // committed, the newer update applied, then confirmed
  assert.deepEqual(server().players.map(p => p.id), ['p1']);
  assert.deepEqual(ids(), ['p1'], 'n1 is off this screen: no later update is coming to say so');
  assert.deepEqual(app.eval('Object.keys(_rosterAcked)'), []);
  assert.deepEqual(app.eval('Object.keys(_rosterInFlight)'), []);
  set('year', 2029);
  await fire();
  for (let i = 0; i < txs.length; i++) await finish(i);
  assert.deepEqual(server().players.map(p => p.id), ['p1'], 'n1 was not written back');
  assert.equal(server().year, 2029);
}));

test('a save confirmed after a newer update that still has its new player keeps them, and waits for nothing', withTimers(async () => {
  const { app, srv, step, fire, elsewhere, deliver, set, finish } = stampedRoom();
  const N = id => ({ id, name: id, teamIds: [] });
  set('players', app.S.players.concat([N('n1')]));
  await fire();
  await step(0);
  let v = srv.v, after = () => { after = null; deliver(elsewhere(r => { r.rp[4] = 9; })); };
  Object.defineProperty(srv, 'v', { get: () => v, set: x => { v = x; if (after) after(); }, configurable: true });
  await finish(0);
  assert.deepEqual(app.S.players.map(p => p.id), ['p1', 'n1']);
  assert.deepEqual(app.eval('Object.keys(_rosterAcked)'), []);
  assert.deepEqual(app.eval('Object.keys(_rosterInFlight)'), []);
}));
