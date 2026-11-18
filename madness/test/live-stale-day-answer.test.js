const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* The Live tab asks the relay for the day on screen and waits for the answer. Tapping the day arrows again while
 * that request is out starts a second one, and whichever answered LAST filled the list: a slow answer for the
 * earlier day replaced the later day's games, under the later day's date, until the next 30 s poll. An answer for
 * a day that is no longer on screen is now dropped. */

let real = null; // ncaa's own functions (js/ is loaded by the first createApp())
test.after(() => { if (real) Object.assign(vm.runInThisContext('ncaa'), real); });

function liveApp(day) {
  const app = createApp({ phase: 'live' });
  app.S.liveScoresDate = day;
  app.checkGameFinals = async () => {};
  const pending = {}; // day -> resolve
  const n = vm.runInThisContext('ncaa');
  if (!real) real = { fetchScoreboard: n.fetchScoreboard, parseScoreboard: n.parseScoreboard };
  n.fetchScoreboard = day => new Promise(r => { pending[day] = r; });
  n.parseScoreboard = data => data.games;
  vm.runInThisContext('liveScores = []; liveLastError = false; _scoreboardFresh = false;');
  const shown = () => vm.runInThisContext('liveScores.map(g => g.id)');
  return { app, pending, shown };
}
const games = (...ids) => ({ games: ids.map(id => ({ id, state: 'post' })) });

test('the answer for a day that was paged away from does not replace the day now shown', async () => {
  const { app, pending, shown } = liveApp('20270318');
  const first = app.refreshLiveScores();   // Thursday asked
  app.S.liveScoresDate = '20270319';       // arrow tapped: Friday
  const second = app.refreshLiveScores();
  pending['20270319'](games('fri-1', 'fri-2'));
  await second;
  assert.deepEqual(shown(), ['fri-1', 'fri-2']);
  pending['20270318'](games('thu-1'));     // Thursday's answer arrives last
  await first;
  assert.deepEqual(shown(), ['fri-1', 'fri-2'], 'Friday stays on screen');
});

test('a late FAILED answer for the earlier day does not put up the "scores unavailable" notice either', async () => {
  const { app, pending } = liveApp('20270318');
  const first = app.refreshLiveScores();
  app.S.liveScoresDate = '20270319';
  const second = app.refreshLiveScores();
  pending['20270319'](games('fri-1'));
  await second;
  pending['20270318'](null);
  await first;
  assert.equal(vm.runInThisContext('liveLastError'), false);
});

test('the answer for the day still on screen is used, as before', async () => {
  const { app, pending, shown } = liveApp('20270318');
  const run = app.refreshLiveScores();
  pending['20270318'](games('thu-1', 'thu-2'));
  await run;
  assert.deepEqual(shown(), ['thu-1', 'thu-2']);
  assert.equal(vm.runInThisContext('liveLastError'), false);
});

test('back on the first day before its answer arrives: that answer is used', async () => {
  const { app, pending, shown } = liveApp('20270318');
  const first = app.refreshLiveScores();
  app.S.liveScoresDate = '20270319';
  app.S.liveScoresDate = '20270318';
  pending['20270318'](games('thu-1'));
  await first;
  assert.deepEqual(shown(), ['thu-1']);
});
