const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

const players = (rosters) => Object.entries(rosters).map(([id, teamIds]) => ({ id, name: id, teamIds }));

test('mergeSharedState: when the server has not advanced, local state wins unchanged', () => {
  const app = createApp();
  const local = { ds: { cp: 3, order: ['a', 'b'] }, players: players({ a: ['t1', 't2'], b: ['t3'] }), rp: { 1: 5 } };
  const remote = { ds: { cp: 3, order: ['a', 'b'] }, players: players({ a: ['t1', 't2'], b: ['t3'] }), rp: { 1: 1 } };
  const out = app.mergeSharedState(local, remote);
  assert.equal(out.rp[1], 5, 'local scoring edit kept');
  assert.deepEqual(out.ds, local.ds);
  assert.deepEqual(out.players, local.players);
});

test('mergeSharedState: a pick that landed on the server after our snapshot is preserved', () => {
  const app = createApp();
  const local = { ds: { cp: 3, order: ['a', 'b', 'a', 'b'], started: true, complete: false }, players: players({ a: ['t1', 't2'], b: ['t3'] }), rp: { 1: 5 } };
  const remote = { ds: { cp: 4, order: ['a', 'b', 'a', 'b'], started: true, complete: true, pickDeadline: null }, players: players({ a: ['t1', 't2'], b: ['t3', 't4'] }), rp: { 1: 1 } };
  const out = app.mergeSharedState(local, remote);
  assert.equal(out.ds.cp, 4, 'draft progress taken from server');
  assert.equal(out.ds.complete, true);
  assert.deepEqual(out.players.find(p => p.id === 'b').teamIds, ['t3', 't4'], 'server roster kept');
  assert.equal(out.rp[1], 5, 'local scoring edit still applied');
});

test('mergeSharedState: server regression (undo) is not forced onto a local copy that is ahead', () => {
  const app = createApp();
  const local = { ds: { cp: 5 }, players: players({ a: ['t1'] }) };
  const remote = { ds: { cp: 4 }, players: players({ a: [] }) };
  const out = app.mergeSharedState(local, remote);
  assert.equal(out.ds.cp, 5);
  assert.deepEqual(out.players[0].teamIds, ['t1']);
});

test('mergeSharedState: players added locally but unknown to the server keep their local rosters', () => {
  const app = createApp();
  const local = { ds: { cp: 0 }, players: players({ a: [], newguy: [] }) };
  const remote = { ds: { cp: 1 }, players: players({ a: ['t1'] }) };
  const out = app.mergeSharedState(local, remote);
  assert.deepEqual(out.players.map(p => p.id), ['a', 'newguy'], 'local player list kept');
  assert.deepEqual(out.players[0].teamIds, ['t1']);
  assert.deepEqual(out.players[1].teamIds, []);
});

test('mergeSharedState: tolerates missing ds/players on either side and never mutates inputs', () => {
  const app = createApp();
  const local = { rp: { 1: 1 } };
  assert.deepEqual(app.mergeSharedState(local, null), local);
  assert.deepEqual(app.mergeSharedState(local, {}), local);
  const l2 = { ds: { cp: 1 }, players: players({ a: ['t1'] }) };
  const r2 = { ds: { cp: 2 }, players: players({ a: ['t1', 't2'] }) };
  const snapshot = JSON.stringify(l2);
  app.mergeSharedState(l2, r2);
  assert.equal(JSON.stringify(l2), snapshot, 'local input untouched');
});

test('mergeSharedState: an admin reset (higher local epoch, cp back to 0) is not undone by server picks', () => {
  const app = createApp();
  const local = { ds: { cp: 0, order: [], started: false, complete: false, epoch: 2 }, players: players({ a: [], b: [] }) };
  const remote = { ds: { cp: 7, order: ['a', 'b'], started: true, epoch: 1 }, players: players({ a: ['t1', 't2'], b: ['t3'] }) };
  const out = app.mergeSharedState(local, remote);
  assert.equal(out.ds.cp, 0, 'reset survives');
  assert.deepEqual(out.players.map(p => p.teamIds), [[], []], 'rosters stay cleared');
});

test('mergeSharedState: someone else reset or undid (higher remote epoch) overrides a stale local copy that is ahead', () => {
  const app = createApp();
  const local = { ds: { cp: 5, order: ['a', 'b'], epoch: 1 }, players: players({ a: ['t1', 't2', 't3'], b: ['t4', 't5'] }), rp: { 1: 9 } };
  const remote = { ds: { cp: 4, order: ['a', 'b'], epoch: 2 }, players: players({ a: ['t1', 't2'], b: ['t4', 't5'] }), rp: { 1: 1 } };
  const out = app.mergeSharedState(local, remote);
  assert.equal(out.ds.cp, 4, 'undo on the server wins');
  assert.deepEqual(out.players.find(p => p.id === 'a').teamIds, ['t1', 't2']);
  assert.equal(out.rp[1], 9, 'unrelated local edit still applied');
});

test('mergeSharedState: legacy states without epoch behave as epoch 0', () => {
  const app = createApp();
  const local = { ds: { cp: 2 }, players: players({ a: ['t1'] }) };
  const remote = { ds: { cp: 3, epoch: 0 }, players: players({ a: ['t1', 't2'] }) };
  assert.equal(app.mergeSharedState(local, remote).ds.cp, 3);
  assert.equal(app.mergeSharedState(remote, local).ds.cp, 3);
});

test('mergeSharedState: a player added on another device since our snapshot is kept, not dropped', () => {
  const app = createApp();
  // Both admins are pre-draft (cp 0, same epoch) so "local wins"; the other device added c since our snapshot had a, b.
  const local = { ds: { cp: 0, epoch: 1 }, players: players({ a: [], b: [] }) };
  const remote = { ds: { cp: 0, epoch: 1 }, players: players({ a: [], b: [], c: [] }) };
  const out = app.mergeSharedState(local, remote, ['a', 'b']);
  assert.deepEqual(out.players.map(p => p.id), ['a', 'b', 'c'], 'c appended');
  assert.deepEqual(out.players[2], { id: 'c', name: 'c', teamIds: [] });
  assert.deepEqual(local.players.map(p => p.id), ['a', 'b'], 'local input untouched');
});

test('mergeSharedState: a player we removed stays removed even though the server still has them', () => {
  const app = createApp();
  const local = { ds: { cp: 0, epoch: 1 }, players: players({ a: [] }) };
  const remote = { ds: { cp: 0, epoch: 1 }, players: players({ a: [], b: [] }) };
  const out = app.mergeSharedState(local, remote, ['a', 'b']);
  assert.deepEqual(out.players.map(p => p.id), ['a'], 'b was in our last snapshot, so its absence is our removal');
});

test('mergeSharedState: remove here + add elsewhere in the same window resolve independently', () => {
  const app = createApp();
  const local = { ds: { cp: 0, epoch: 1 }, players: players({ a: [] }) };
  const remote = { ds: { cp: 0, epoch: 1 }, players: players({ a: [], b: [], c: [] }) };
  const out = app.mergeSharedState(local, remote, ['a', 'b']);
  assert.deepEqual(out.players.map(p => p.id), ['a', 'c']);
});

test('mergeSharedState: newcomers are kept when the server is ahead too, with the server roster', () => {
  const app = createApp();
  const local = { ds: { cp: 2, epoch: 1 }, players: players({ a: ['t1'], b: ['t2'] }) };
  const remote = { ds: { cp: 3, epoch: 1 }, players: players({ a: ['t1', 't3'], b: ['t2'], c: [] }) };
  const out = app.mergeSharedState(local, remote, ['a', 'b']);
  assert.equal(out.ds.cp, 3);
  assert.deepEqual(out.players.map(p => p.id), ['a', 'b', 'c']);
  assert.deepEqual(out.players[0].teamIds, ['t1', 't3']);
});

test('mergeSharedState: after a local reset a newcomer from the server starts with an empty roster', () => {
  const app = createApp();
  const local = { ds: { cp: 0, epoch: 2 }, players: players({ a: [] }) };
  const remote = { ds: { cp: 4, epoch: 1 }, players: players({ a: ['t1', 't2'], c: ['t3'] }) };
  const out = app.mergeSharedState(local, remote, ['a']);
  assert.equal(out.ds.cp, 0, 'reset survives');
  assert.deepEqual(out.players, [{ id: 'a', name: 'a', teamIds: [] }, { id: 'c', name: 'c', teamIds: [] }]);
});

test('mergeSharedState: with no snapshot history (knownIds null) nobody is dropped', () => {
  const app = createApp();
  const local = { ds: { cp: 0 }, players: players({ a: [] }) };
  const remote = { ds: { cp: 0 }, players: players({ a: [], b: [] }) };
  assert.deepEqual(app.mergeSharedState(local, remote).players.map(p => p.id), ['a', 'b']);
  assert.deepEqual(app.mergeSharedState(local, remote, null).players.map(p => p.id), ['a', 'b']);
});

test('60-rooms.js records the snapshot roster and passes it to mergeSharedState', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', '60-rooms.js'), 'utf8');
  assert.match(src, /_lastSnapshotPlayerIds = \(remote\.players \|\| \[\]\)\.map\(p => p\.id\)/, 'set in _applyRoomSnapshot');
  assert.match(src, /mergeSharedState\(shared, remote, _lastSnapshotPlayerIds\)/, 'passed to the write transaction');
  assert.match(src, /_lastSnapshotPlayerIds = null;/, 'cleared when switching rooms');
});

test('every backwards draft move in 80-pages.js bumps ds.epoch (start, reset, undo x2, new tournament)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  const bumps = src.match(/epoch\s*[:=]\s*\(?\(?\(?(S\.ds && S\.ds\.epoch\)|ds\.epoch)/g) || [];
  assert.equal(bumps.length, 5, 'startDraft, resetDraft, undoDraft (room + local), resetAll');
});
