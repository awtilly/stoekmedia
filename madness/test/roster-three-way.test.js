const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* The save's transaction reads the room as the server holds it. A player this phone still lists, who was in the
 * room the last time this phone looked ("known") and is not there now, was removed on another phone: the save
 * no longer writes them back. A player this phone has just added (not known yet) is still written. */
const P = ids => ids.map(id => ({ id, name: id, teamIds: [] }));
const ds = { cp: 0, order: [] };

test('mergeSharedState (server copy): a known player the server no longer has is not written back', () => {
  const app = createApp();
  const out = app.mergeSharedState({ ds, players: P(['a', 'b', 'mine']) }, { ds, players: P(['a']) }, ['a', 'b'], true);
  assert.deepEqual(out.players.map(p => p.id), ['a', 'mine'], 'b was removed elsewhere; the local add is kept');
});

test('mergeSharedState (server copy): a player added here and one added elsewhere are both kept', () => {
  const app = createApp();
  const out = app.mergeSharedState({ ds, players: P(['a', 'mine']) }, { ds, players: P(['a', 'theirs']) }, ['a'], true);
  assert.deepEqual(out.players.map(p => p.id).sort(), ['a', 'mine', 'theirs']);
});

test('mergeSharedState (server copy): a player removed here stays removed', () => {
  const app = createApp();
  const out = app.mergeSharedState({ ds, players: P(['a']) }, { ds, players: P(['a', 'b']) }, ['a', 'b'], true);
  assert.deepEqual(out.players.map(p => p.id), ['a']);
});

test('mergeSharedState: against a snapshot (which can be older than this phone’s own save) the local list is kept, as before', () => {
  const app = createApp();
  const out = app.mergeSharedState({ ds, players: P(['a', 'b']) }, { ds, players: P(['a']) }, ['a', 'b']);
  assert.deepEqual(out.players.map(p => p.id), ['a', 'b']);
});

test('mergeSharedState (server copy): with no roster seen yet nothing is dropped', () => {
  const app = createApp();
  const out = app.mergeSharedState({ ds, players: P(['a', 'b']) }, { ds, players: P(['a']) }, null, true);
  assert.deepEqual(out.players.map(p => p.id), ['a', 'b']);
});
