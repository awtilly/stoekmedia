const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const { createApp } = require('./_harness');

/* importFromNCAA() said "Tournament bracket not available yet. Try after Selection Sunday." for every empty result,
 * including a request that failed outright (offline, relay 502). On draft night that tells the commissioner to wait
 * when the right move is to try again. A failed request now says so; the "no bracket" answer (which the source also
 * gives when its own request to NCAA fails) no longer names a day to wait for. */
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
  app.render = () => { app.__calls.render++; };
  app.S.year = app.eval('tournamentYear()'); // the import compares against the tournament year, not the calendar year
  app.S.teams = [];
  app.appConfirm = async () => true;
  return { app, btn };
}
const lastToast = (app) => app.__calls.toasts[app.__calls.toasts.length - 1];

test('the bracket request fails (relay error): the message says to try again, not to wait for Selection Sunday', async () => {
  const { app, btn } = pagesApp();
  app.fetch = async () => ({ ok: false, status: 502 });
  await app.importFromNCAA();
  assert.match(lastToast(app), /Could not reach NCAA\.com/);
  assert.doesNotMatch(lastToast(app), /Selection Sunday/);
  assert.equal(btn.disabled, false, 'the button is usable again');
  assert.equal(btn.textContent, 'Import from NCAA.com');
  assert.equal(app.S.teams.length, 0);
  assert.equal(app.__calls.saveState, 0);
});

test('the device is offline (fetch throws): same message', async () => {
  const { app, btn } = pagesApp();
  app.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await app.importFromNCAA();
  assert.match(lastToast(app), /Could not reach NCAA\.com/);
  assert.equal(btn.disabled, false);
});

test('the source has no bracket for the year: says so without naming a day to wait for', async () => {
  const { app, btn } = pagesApp();
  app.fetch = async () => ({ ok: true, json: async () => ({ championships: [], upstreamStatus: 404 }) });
  await app.importFromNCAA();
  assert.match(lastToast(app), new RegExp('no ' + app.S.year + ' bracket yet'));
  assert.match(lastToast(app), /try again in a few minutes/);
  assert.doesNotMatch(lastToast(app), /Selection Sunday/);
  assert.equal(btn.disabled, false);
  assert.equal(app.S.teams.length, 0);
});
