const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./_harness');

test('teamEditBlockedReason: empty room, no draft, no bracket => editing allowed', () => {
  const app = createApp();
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: [] }];
  assert.equal(app.teamEditBlockedReason(), '');
});

test('teamEditBlockedReason: any pick locks the team list and the message counts them', () => {
  const app = createApp();
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: ['South-1'] }, { id: 'b', name: 'Bob', teamIds: ['East-2', 'West-3'] }];
  const r = app.teamEditBlockedReason();
  assert.match(r, /^Teams are locked: 3 picks point at them\./);
  assert.match(r, /Reset the draft or start a new tournament first/);
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: ['South-1'] }];
  assert.match(app.teamEditBlockedReason(), /1 pick point/);
});

test('teamEditBlockedReason: bracket winners lock it too, with or without picks', () => {
  const app = createApp();
  app.S.bracket.South[0] = 'South-1';
  app.S.bracket.ff[2] = 'South-1';
  assert.match(app.teamEditBlockedReason(), /^Teams are locked: 2 bracket results point at them/);
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: ['South-1'] }];
  assert.match(app.teamEditBlockedReason(), /1 pick and 2 bracket results/);
});

test('teamEditBlockedReason: a started draft with no picks yet is still locked', () => {
  const app = createApp();
  app.S.ds = { order: ['a'], cp: 0, started: true, complete: false };
  assert.match(app.teamEditBlockedReason(), /^Teams are locked: the draft has started\./);
});

test('teamEditBlockedReason copes with missing players/teamIds/bracket', () => {
  const app = createApp({ players: undefined, bracket: undefined, ds: undefined });
  assert.equal(app.teamEditBlockedReason(), '');
  app.S.players = [{ id: 'a', name: 'Ann' }];
  assert.equal(app.teamEditBlockedReason(), '');
});

test('importFromESPN and clearAllTeams consult the guard right after the admin check', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  for (const fn of ['importFromESPN', 'clearAllTeams']) {
    const body = src.slice(src.indexOf('async function ' + fn + '('));
    const admin = body.indexOf('if(!await requireAdmin()) return;');
    const guard = body.indexOf('const locked = teamEditBlockedReason();');
    const bail = body.indexOf('if(locked){ showToast(locked); return; }');
    assert.ok(admin >= 0 && guard > admin && bail > guard, fn + ' guards after requireAdmin');
    assert.ok(guard < body.indexOf('S.teams'), fn + ' guards before touching S.teams');
  }
  assert.doesNotMatch(src.slice(src.indexOf('async function parseBulkImport(')).split('async function importFromESPN')[0], /teamEditBlockedReason/, 'bulk import only appends teams: not guarded');
});
