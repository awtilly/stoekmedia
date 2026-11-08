const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * The Live tab's default day (js/20-live.js scoreboardDay) is the Eastern-time scoreboard day, which turns over
 * at 4 am ET, not the phone's calendar date at midnight. NCAA.com files a 9:50 pm ET tip under the day it
 * started, and the pollScoreboard function keeps writing that day's doc until 4 am ET; the old helper used the
 * device's local date, so an East-coast phone flipped to an empty next day at midnight while the late game was
 * still playing, and never saw that game's final. The two inline copies in 80-pages.js (renderLive, changeLiveDate)
 * now call the same helper, so the header, the picker and the listener agree on what "today" is.
 */

// 80-pages.js is not part of the harness; loaded once, after a createApp() has put window/document stubs in place.
let pagesLoaded = false;
function loadPages(app) {
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
}

function fakeDb() {
  const d = { paths: [] };
  d.db = { collection: (c) => ({ doc: (x) => ({ onSnapshot: () => { d.paths.push(c + '/' + x); return () => {}; } }) }) };
  return d;
}

test('scoreboardDay: the first four hours of an Eastern day still belong to the night before (daylight time)', () => {
  const app = createApp();
  // 2027-03-20 is in EDT (UTC-4): 04:30Z = 00:30 ET on the 20th, the late West-coast game is still on.
  assert.equal(app.scoreboardDay(new Date('2027-03-20T04:30:00Z')), '20270319');
  assert.equal(app.scoreboardDay(new Date('2027-03-20T07:59:00Z')), '20270319', '03:59 ET is still the 19th');
  assert.equal(app.scoreboardDay(new Date('2027-03-20T08:00:00Z')), '20270320', '04:00 ET starts the 20th');
  assert.equal(app.scoreboardDay(new Date('2027-03-20T23:30:00Z')), '20270320', '7:30 pm ET, tip-off time');
});

test('scoreboardDay: standard time before the March clock change (UTC-5)', () => {
  const app = createApp();
  // DST starts 2027-03-14; the 10th is EST. 05:00Z = midnight ET on the 10th.
  assert.equal(app.scoreboardDay(new Date('2027-03-10T05:00:00Z')), '20270309');
  assert.equal(app.scoreboardDay(new Date('2027-03-10T09:00:00Z')), '20270310', '04:00 EST');
});

test('scoreboardDay: a West-coast evening is the same scoreboard day as in the East', () => {
  const app = createApp();
  // 9:00 pm PT on the 19th = 00:00 ET on the 20th -> still the 19th's scoreboard.
  assert.equal(app.scoreboardDay(new Date('2027-03-20T04:00:00Z')), '20270319');
  // 1:30 am PT on the 20th = 04:30 ET -> the 20th.
  assert.equal(app.scoreboardDay(new Date('2027-03-20T08:30:00Z')), '20270320');
});

test('startLiveRefresh and refreshLiveScores subscribe to the scoreboard day, not the device date', async () => {
  const app = createApp();
  const realTimers = { setTimeout, setInterval };
  const realDay = app.scoreboardDay; // restored below: the helper is a global the whole file shares
  globalThis.setTimeout = () => 1;
  globalThis.setInterval = () => 2;
  try {
    app.autoResolvePlayIns = () => {};
    app.requestWakeLock = () => {};
    app.releaseWakeLock = () => {};
    app.scoreboardDay = () => '20270319';
    const d = fakeDb();
    app.db = d.db;
    app.S.liveScoresDate = '';
    app.startLiveRefresh();
    assert.deepEqual(d.paths, ['scoreboard/20270319']);

    let url = null;
    app.fetch = async (u) => { url = String(u); return { ok: true, json: async () => ({ games: [] }) }; };
    await app.refreshLiveScores();
    assert.ok(url.includes('/2027/03/19'), 'the direct poll asks for the same day the listener is on: ' + url);
    assert.deepEqual(d.paths, ['scoreboard/20270319'], 'same day: no re-subscribe');
  } finally {
    app.stopLiveRefresh();
    app.scoreboardDay = realDay;
    Object.assign(globalThis, realTimers);
  }
});

test('changeLiveDate steps from the scoreboard day when no day is selected', () => {
  const app = createApp();
  loadPages(app);
  const realDay = app.scoreboardDay;
  try {
    app.scoreboardDay = () => '20270319';
    app.startLiveRefresh = () => {};
    app.S.liveScoresDate = '';
    app.changeLiveDate(1);
    assert.equal(app.S.liveScoresDate, '20270320', 'forward one day from the 19th, not from the device date');
    app.S.liveScoresDate = '';
    app.changeLiveDate(-1);
    assert.equal(app.S.liveScoresDate, '20270318');
  } finally { app.scoreboardDay = realDay; }
});

test('contract: at every half hour of the tournament the client day is one the Cloud Function is writing', () => {
  // functions/scoreboard-logic.js datesToPoll(now) is the list of scoreboard/{day} docs pollScoreboard writes on a
  // tick (the Eastern day, plus the day before until 4 am ET). If the client ever listens to a day outside that
  // list it falls back to direct polling for the rest of the day, so the two rules must agree hour by hour.
  const logic = require('../functions/scoreboard-logic');
  const app = createApp();
  const days = ['2027-03-10', '2027-03-14', '2027-03-20', '2027-04-05']; // EST, the clock-change Sunday, EDT, the final
  for (const day of days) {
    for (let half = 0; half < 48; half++) {
      const now = new Date(Date.parse(day + 'T00:00:00Z') + half * 30 * 60000);
      const client = app.scoreboardDay(now);
      const server = logic.datesToPoll(now);
      assert.ok(server.includes(client), now.toISOString() + ': client ' + client + ' not in ' + server.join(','));
    }
  }
});
