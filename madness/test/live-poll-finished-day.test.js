const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* refreshLiveScores(): once the cached scoreboard doc showed every game of the shown day final (a past day in the
 * date picker, or tonight after the last game), the 30 s poll used to fall back to the relay for the rest of the
 * day as soon as the 3-minute cache window had passed: nothing new to find, one function invocation per poll per
 * phone. It now stays quiet; the Firestore listener still delivers a correction or a late-added game. */
const ts = (ms) => ({ toMillis: () => ms });
const game = (id, state) => ({ id, name: 'A at B', state, completed: state === 'post', tournament: true,
  away: { name: 'A', ncaaId: 'a', winner: state === 'post' }, home: { name: 'B', ncaaId: 'b', winner: false } });

const realNow = Date.now;
let clock = 1_700_000_000_000;
test.beforeEach(() => { clock = 1_700_000_000_000; Date.now = () => clock; });
test.after(() => { Date.now = realNow; });

function polling(app) {
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ games: [] }) }; };
  return () => fetches;
}

test('refreshLiveScores: a day whose every game is final is not polled after the cache window', async () => {
  const app = createApp();
  const fetches = polling(app);
  assert.equal(app.applyCachedScoreboard({ events: [game('1', 'post'), game('2', 'post')], fetchedAt: ts(clock) }, false), true);
  clock += 4 * 60_000;
  await app.refreshLiveScores();
  assert.equal(fetches(), 0, 'nothing to poll for: the day is over');
  clock += 30 * 60_000;
  await app.refreshLiveScores();
  assert.equal(fetches(), 0);
});

test('refreshLiveScores: a day with a game still to play is polled once the cache ages out (unchanged)', async () => {
  const app = createApp();
  const fetches = polling(app);
  assert.equal(app.applyCachedScoreboard({ events: [game('3', 'post'), game('4', 'pre')], fetchedAt: ts(clock) }, false), true);
  clock += 4 * 60_000;
  await app.refreshLiveScores();
  assert.equal(fetches(), 1);
});

test('refreshLiveScores: an empty doc or a stopped listener still polls', async () => {
  const app = createApp();
  const fetches = polling(app);
  assert.equal(app.applyCachedScoreboard({ events: [], fetchedAt: ts(clock) }, false), true);
  clock += 4 * 60_000;
  await app.refreshLiveScores();
  assert.equal(fetches(), 1, 'no games listed: keep looking');
  assert.equal(app.applyCachedScoreboard({ events: [game('5', 'post')], fetchedAt: ts(clock) }, false), true);
  app.unsubscribeScoreboard(); // leaving Live / the listener is gone: the "all final" pause goes with it
  clock += 4 * 60_000;
  await app.refreshLiveScores();
  assert.equal(fetches(), 2);
});

test('refreshLiveScores: a finished day still hands over to the new day when "today" rolls over', async () => {
  const app = createApp();
  let fetched = [];
  app.fetch = async (url) => { fetched.push(String(url)); return { ok: true, json: async () => ({ games: [] }) }; };
  const listened = [];
  app.db = { collection: () => ({ doc: (d) => ({ onSnapshot: () => { listened.push(d); return () => {}; } }) }) };
  app.eval("scoreboardDay = () => '20270318'");
  app.subscribeScoreboard('20270318');
  assert.equal(app.applyCachedScoreboard({ events: [game('1', 'post'), game('2', 'post')], fetchedAt: ts(clock) }, false), true);
  clock += 4 * 60_000;
  await app.refreshLiveScores();
  assert.equal(fetched.length, 0, 'the day is over: quiet');
  // 4 am ET passes while the tab stays open (wake lock keeps the screen on): the day changes.
  app.eval("scoreboardDay = () => '20270319'");
  clock += 60 * 60_000;
  await app.refreshLiveScores();
  assert.equal(app.eval('_scoreboardDate'), '20270319', 'the listener must move to the new day');
  assert.equal(fetched.length, 1, 'and the new day is polled once');
  assert.match(fetched[0], /2027\/03\/19/);
});
