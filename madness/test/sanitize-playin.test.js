const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* A First Four slot is one team record with playIn: true and playInTeams: the two teams playing for it. Its name,
 * its record and the Live tab's team lookup all read that pair without checking it. Every device writes the whole
 * room, so the pair is checked where the room arrives (sanitizeSharedState), like ids, seeds, names and lists:
 * one slot whose pair was missing or not a list used to stop every phone in the pool from drawing the room. */

const slot = extra => Object.assign({ id: 't16', name: 'Texas / Xavier', seed: 11, region: 'Midwest', playIn: true, playInResolved: false }, extra);
const pair = [{ name: 'Texas', record: '19-15', ncaaId: '703', abbr: 'TEX' }, { name: 'Xavier', record: '21-11', ncaaId: '812', abbr: 'XAV' }];

test('a First Four slot with a good pair is left exactly as it was', () => {
  const app = createApp();
  const before = { teams: [slot({ playInTeams: pair }), { id: 't1', name: 'Duke', seed: 1, region: 'East' }] };
  const s = app.sanitizeSharedState(JSON.parse(JSON.stringify(before)));
  assert.deepEqual(s, before);
  assert.equal(app.teamDisplayName(s.teams[0]), 'Texas / Xavier');
  assert.equal(app.teamRecordDisplay(s.teams[0]), '19-15 / 21-11');
});

test('a slot whose pair is missing or not a list becomes an ordinary team and can be drawn', () => {
  const app = createApp();
  for (const bad of [undefined, null, 'Texas / Xavier', 7, { 0: pair[0] }, []]) {
    const s = app.sanitizeSharedState({ teams: [bad === undefined ? slot() : slot({ playInTeams: bad })] });
    const t = s.teams[0];
    assert.equal(app.teamDisplayName(t), 'Texas / Xavier', 'falls back to the slot name: ' + JSON.stringify(bad));
    assert.equal(app.teamRecordDisplay(t), '');
    assert.equal('playIn' in t, false);
    assert.equal('playInTeams' in t, false);
  }
});

test('entries of the pair that are not records are dropped; the good ones are kept', () => {
  const app = createApp();
  const s = app.sanitizeSharedState({ teams: [slot({ playInTeams: [null, pair[1], 'x', [pair[0]]] })] });
  assert.deepEqual(s.teams[0].playInTeams, [pair[1]]);
  assert.equal(app.teamDisplayName(s.teams[0]), 'Xavier');
  assert.equal(s.teams[0].playIn, true);
});

test('a decided slot keeps its flags; only a broken pair is removed', () => {
  const app = createApp();
  const s = app.sanitizeSharedState({ teams: [slot({ name: 'Texas', playInResolved: true, playInTeams: 'gone' })] });
  assert.equal(s.teams[0].playIn, true);
  assert.equal(s.teams[0].playInResolved, true);
  assert.equal('playInTeams' in s.teams[0], false);
  assert.equal(app.teamDisplayName(s.teams[0]), 'Texas');
});

test('ordinary teams are not given play-in fields', () => {
  const app = createApp();
  const s = app.sanitizeSharedState({ teams: [{ id: 't1', name: 'Duke', seed: 1, region: 'East' }] });
  assert.deepEqual(s.teams[0], { id: 't1', name: 'Duke', seed: 1, region: 'East' });
});

test('the automatic First Four check runs over a room that arrived with a broken slot', async () => {
  const app = createApp();
  app.S.teams = app.sanitizeSharedState({ teams: [slot({ playInTeams: 'nope' }), slot({ id: 't17', playInTeams: pair })] }).teams;
  app.S.year = 2026;
  app.ncaa.fetchBracket = async () => null;
  await assert.doesNotReject(() => app.autoResolvePlayIns());
});
