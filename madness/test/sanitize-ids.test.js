const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

const EVIL = "x');alert(1);('";

test('isSafeId accepts UUID-style ids and rejects anything that could break out of an onclick string', () => {
  const app = createApp();
  assert.equal(app.isSafeId('3f2a9c1e-7b4d-4e8a-9f0c-1234567890ab'), true);
  assert.equal(app.isSafeId('South-1'), true);
  for (const bad of [EVIL, "a'b", 'a"b', 'a<b', 'a b', '', null, 42, 'x'.repeat(65)]) {
    assert.equal(app.isSafeId(bad), false, 'rejects ' + JSON.stringify(bad));
  }
});

test('sanitizeSharedState drops players and teams with hostile ids and scrubs references to them', () => {
  const app = createApp();
  const s = {
    players: [
      { id: 'p1', name: 'Ann', teamIds: ['t1', EVIL] },
      { id: EVIL, name: 'Mallory', teamIds: ['t2'] },
      null
    ],
    teams: [{ id: 't1', name: 'Duke' }, { id: EVIL, name: 'Bad' }, { id: 't2', name: 'Yale' }],
    ds: { order: ['p1', EVIL, 'p1'], cp: 1 },
    bracket: { South: ['t1', EVIL, null], ff: [null, null, EVIL] }
  };
  app.sanitizeSharedState(s);
  assert.deepEqual(s.players.map(p => p.id), ['p1']);
  assert.deepEqual(s.players[0].teamIds, ['t1']);
  assert.deepEqual(s.teams.map(t => t.id), ['t1', 't2']);
  assert.deepEqual(s.ds.order, ['p1', 'p1']);
  assert.deepEqual(s.bracket.South, ['t1', null, null]);
  assert.deepEqual(s.bracket.ff, [null, null, null]);
});

test('sanitizeSharedState leaves a well-formed state untouched and tolerates missing fields', () => {
  const app = createApp();
  const good = { players: [{ id: 'p1', name: 'A', teamIds: ['South-1'] }], teams: [{ id: 'South-1' }], ds: { order: ['p1'] }, bracket: { South: ['South-1'], ff: [null] } };
  const before = JSON.stringify(good);
  app.sanitizeSharedState(good);
  assert.equal(JSON.stringify(good), before);
  assert.doesNotThrow(() => app.sanitizeSharedState({}));
  assert.doesNotThrow(() => app.sanitizeSharedState(null));
  assert.doesNotThrow(() => app.sanitizeSharedState({ players: 'nope', bracket: 'nope', ds: {} }));
});

test('seedBadge escapes a hostile seed instead of rendering it as HTML', () => {
  const app = createApp();
  const html = app.seedBadge('<img src=x onerror=alert(1)>');
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;img'), true);
  assert.equal(app.seedBadge(1), '<span class="seed-badge ' + app.seedClass(1) + '">1</span>');
});

test('80-pages.js never interpolates owner(), seed or region into HTML without escapeHtml', () => {
  // Every participant can write room state, so player names, seeds and regions are untrusted.
  // owner() returns a raw player name; the sanitizer only vets ids, so the render layer must escape.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  const raw = src.match(/\$\{(owner\([^)]*\)( \|\| '')?|awayOwner|homeOwner|ow|[a-z]+\.seed|[a-z]+\.region)\}/g) || [];
  assert.deepEqual(raw, []);
});
