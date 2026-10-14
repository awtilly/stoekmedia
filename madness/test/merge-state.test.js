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
