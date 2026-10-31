const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* When the direct ESPN poll fails (offline, ESPN blocked, HTTP error) the Live tab used to say
 * "No games found", which reads as "no games today". refreshLiveScores now records the failure in
 * liveLastError and renderLive shows "Scores unavailable" instead. 80-pages.js is loaded once on
 * top of the harness so renderLive can be exercised against a fake container element. */
let pagesLoaded = false;
function liveApp() {
  const app = createApp({ phase: 'live', liveScoresFilter: 'all' });
  const c = { id: 'c', innerHTML: '' };
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById(id) { return id === 'c' ? c : null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.eval('liveScores = []; liveLastRefresh = 0; liveLastError = false; _scoreboardFresh = false;');
  return { app, c };
}

const ts = (ms) => ({ toMillis: () => ms });
const oneLiveGame = () => [{ id: '401', name: 'A @ B', state: 'in', completed: false, away: { name: 'A', espnId: '1', winner: false }, home: { name: 'B', espnId: '2', winner: false } }];

test('refreshLiveScores: a failed ESPN fetch sets liveLastError and still re-renders the Live tab', async () => {
  const { app, c } = liveApp();
  app.fetch = async () => { throw new Error('offline'); };
  await app.refreshLiveScores();
  assert.equal(app.eval('liveLastError'), true);
  assert.equal(app.eval('liveScores').length, 0);
  assert.match(c.innerHTML, /Scores unavailable/);
  assert.doesNotMatch(c.innerHTML, /No games found/, 'an outage must not be reported as an empty slate');
});

test('refreshLiveScores: an HTTP error counts as a failure; the next good poll clears it', async () => {
  const { app, c } = liveApp();
  app.fetch = async () => ({ ok: false, status: 503 });
  await app.refreshLiveScores();
  assert.equal(app.eval('liveLastError'), true);
  app.fetch = async () => ({ ok: true, json: async () => ({ events: [] }) });
  await app.refreshLiveScores();
  assert.equal(app.eval('liveLastError'), false);
  assert.match(c.innerHTML, /No games found/, 'a genuine empty day still says so');
  assert.doesNotMatch(c.innerHTML, /Scores unavailable/);
});

test('applyCachedScoreboard: a usable cached doc clears a previous fetch failure', async () => {
  const { app } = liveApp();
  app.fetch = async () => { throw new Error('offline'); };
  await app.refreshLiveScores();
  assert.equal(app.eval('liveLastError'), true);
  assert.equal(app.applyCachedScoreboard({ events: oneLiveGame(), fetchedAt: ts(Date.now()) }, false), true);
  assert.equal(app.eval('liveLastError'), false);
});

test('renderLive: with earlier scores still on screen, a failure shows the retrying badge but keeps the list', () => {
  const { app, c } = liveApp();
  app.eval('liveScores = ' + JSON.stringify(oneLiveGame()) + '; liveLastError = true;');
  app.S.liveScoresFilter = 'final'; // empty filter, but liveScores is not empty
  app.renderLive(c);
  assert.match(c.innerHTML, /Scores unavailable, retrying/, 'header badge');
  assert.match(c.innerHTML, /No games found/, 'the empty-filter card is about the filter, not the outage');
  assert.doesNotMatch(c.innerHTML, /Could not reach the scoreboard/);
});

test('renderLive: no failure and no games renders the plain "No games found" card without any badge', () => {
  const { app, c } = liveApp();
  app.renderLive(c);
  assert.match(c.innerHTML, /No games found/);
  assert.doesNotMatch(c.innerHTML, /live-error/);
});
