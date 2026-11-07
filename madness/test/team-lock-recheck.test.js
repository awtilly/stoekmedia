const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp, makeTeams } = require('./_harness');

/* importFromNCAA() and clearAllTeams() in js/80-pages.js check teamEditBlockedReason() once, right after the admin
 * check. Between that check and the moment S.teams is replaced sit one or two confirm dialogs and (for the import)
 * a network fetch: an admin can leave "Replace all current teams?" open for minutes. If another admin phone starts
 * the draft or picks meanwhile, the room snapshot updates S, and the stale answer then replaced the teams the picks
 * point at. Both functions now check the lock again right before touching S.teams. */
let pagesLoaded = false;
function pagesApp() {
  const app = createApp();
  const btn = { textContent: 'Import from NCAA.com', disabled: false };
  app.window = { addEventListener() {}, matchMedia() { return { matches: false }; } };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById(id) { return id === 'ncaa-import-btn' ? btn : null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.render = () => { app.__calls.render++; }; // loading 80-pages.js replaced the harness stub
  app.S.year = new Date().getFullYear(); // no "update the year?" dialog in the way
  app.S.teams = [{ id: 'old-1', name: 'Old Team', seed: 1, region: 'South', logo: '', abbr: '', ncaaId: '', color: '', record: '' }];
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: [] }, { id: 'b', name: 'Bob', teamIds: [] }];
  app.appConfirm = async () => true;
  stubBracket(app, async () => makeTeams());
  return { app, btn };
}
/* The import reaches the bracket through ncaa.fetchTournamentTeams() today and through ncaa.fetchBracket() +
 * ncaa.tournamentTeams() once the Final Four pairing change is in; `fn` produces the team list for either path. */
function stubBracket(app, fn) {
  app.ncaa.fetchTournamentTeams = fn;
  app.ncaa.fetchBracket = async () => ({ __teams: await fn() });
  app.ncaa.tournamentTeams = (data) => data.__teams;
}
const lastToast = (app) => app.__calls.toasts[app.__calls.toasts.length - 1];

test('importFromNCAA: the draft starts on another phone while "Replace all teams?" is open -> nothing is replaced', async () => {
  const { app, btn } = pagesApp();
  app.appConfirm = async () => { app.S.ds = { order: ['a', 'b'], cp: 0, started: true, complete: false }; return true; };
  await app.importFromNCAA();
  assert.equal(app.S.teams.length, 1);
  assert.equal(app.S.teams[0].id, 'old-1');
  assert.equal(app.__calls.saveState, 0);
  assert.match(lastToast(app), /^Teams are locked: the draft has started/);
  assert.equal(btn.disabled, false, 'the import button is usable again');
  assert.equal(btn.textContent, 'Import from NCAA.com');
});

test('importFromNCAA: a pick lands while the bracket is downloading -> nothing is replaced', async () => {
  const { app } = pagesApp();
  stubBracket(app, async () => { app.S.players[0].teamIds = ['old-1']; return makeTeams(); });
  await app.importFromNCAA();
  assert.equal(app.S.teams.length, 1);
  assert.equal(app.__calls.saveState, 0);
  assert.match(lastToast(app), /^Teams are locked: 1 pick point/);
});

test('clearAllTeams: the draft starts while "Clear all teams?" is open -> the teams stay', async () => {
  const { app } = pagesApp();
  app.appConfirm = async () => { app.S.ds = { order: ['a', 'b'], cp: 0, started: true, complete: false }; return true; };
  await app.clearAllTeams();
  assert.equal(app.S.teams.length, 1);
  assert.equal(app.__calls.saveState, 0);
  assert.match(lastToast(app), /^Teams are locked: the draft has started/);
});

test('ordinary case: with nothing locked the import replaces the teams and clearAllTeams empties them', async () => {
  const { app } = pagesApp();
  await app.importFromNCAA();
  assert.equal(app.S.teams.length, 64);
  assert.equal(app.S.teams[0].name, 'South 1');
  assert.equal(app.__calls.saveState, 1);
  assert.match(lastToast(app), /^Imported 64 teams/);
  await app.clearAllTeams();
  assert.equal(app.S.teams.length, 0);
  assert.equal(app.__calls.saveState, 2);
});
