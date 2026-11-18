const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp, makeTeams } = require('./_harness');

/* importFromNCAA() checks the admin PIN and asks "replace the teams?" for the pool on screen, then downloads the
 * bracket with no dialog up. A commissioner who taps Home and opens another pool before the download answers used
 * to get the bracket put into that other pool (if its teams were not locked yet), with no PIN asked there. The
 * answer is now dropped when the pool on screen is not the one the import was started in. */
let pagesLoaded = false;
function pagesApp(room) {
  const app = createApp();
  const btn = { textContent: 'Import from NCAA.com', disabled: false };
  app.window = { addEventListener() {}, matchMedia() { return { matches: false }; } };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById(id) { return id === 'ncaa-import-btn' ? btn : null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.render = () => { app.__calls.render++; };
  app.roomId = room;
  app.requireAdmin = async () => true;
  app.S.year = app.eval('tournamentYear()');
  app.S.teams = [];
  app.S.players = [{ id: 'a', name: 'Ann', teamIds: [] }, { id: 'b', name: 'Bob', teamIds: [] }];
  app.appConfirm = async () => true;
  return { app, btn };
}
/* The import reaches the bracket through ncaa.fetchTournamentTeams() today and through ncaa.fetchBracket() +
 * ncaa.tournamentTeams() once the Final Four pairing change is in; fn produces the team list for either path. */
function stubBracket(app, fn) {
  app.ncaa.fetchTournamentTeams = fn;
  app.ncaa.fetchBracket = async () => ({ __teams: await fn() });
  app.ncaa.tournamentTeams = (data) => data.__teams;
}

test('another pool opened while the bracket downloads: its teams are not touched', async () => {
  const { app } = pagesApp('POOLA');
  stubBracket(app, async () => {
    // Home, then the other pool: its own state is on screen now
    app.roomId = 'POOLB';
    app.S.teams = [{ id: 'b-1', name: 'Pool B team', seed: 1, region: 'South' }];
    return makeTeams();
  });
  await app.importFromNCAA();
  assert.deepEqual(app.S.teams.map(t => t.id), ['b-1']);
  assert.equal(app.__calls.saveState, 0);
});

test('Home tapped while the bracket downloads: nothing is imported into the screen left behind', async () => {
  const { app } = pagesApp('POOLA');
  stubBracket(app, async () => { app.roomId = null; app.S.teams = []; return makeTeams(); });
  await app.importFromNCAA();
  assert.equal(app.S.teams.length, 0);
  assert.equal(app.__calls.saveState, 0);
});

test('staying in the pool: the import works as before', async () => {
  const { app } = pagesApp('POOLA');
  stubBracket(app, async () => makeTeams());
  await app.importFromNCAA();
  assert.equal(app.S.teams.length, 64);
  assert.equal(app.__calls.saveState, 1);
});

test('with no pool at all (single-device use) the import still works', async () => {
  const { app } = pagesApp(null);
  stubBracket(app, async () => makeTeams());
  await app.importFromNCAA();
  assert.equal(app.S.teams.length, 64);
});
