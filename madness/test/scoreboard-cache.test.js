const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');
const serverParse = require('../functions/espn-parse');
const logic = require('../functions/scoreboard-logic');

const ts = (ms) => ({ toMillis: () => ms });
const sampleEvents = () => [{ id: '401', name: 'A @ B', state: 'in', completed: false, away: { name: 'A', espnId: '1', winner: false }, home: { name: 'B', espnId: '2', winner: false } }];

/* ── client side (js/20-live.js) ── */

test('scoreboardIsFresh: accepts a doc fetched within the max age and rejects older or malformed docs', () => {
  const app = createApp();
  const now = 1_000_000_000;
  assert.equal(app.scoreboardIsFresh({ events: [], fetchedAt: ts(now - 60_000) }, now), true);
  assert.equal(app.scoreboardIsFresh({ events: [], fetchedAt: ts(now - 4 * 60_000) }, now), false, '4 minutes old is stale');
  assert.equal(app.scoreboardIsFresh({ events: 'nope', fetchedAt: ts(now) }, now), false);
  assert.equal(app.scoreboardIsFresh({ events: [] }, now), false, 'missing fetchedAt');
  assert.equal(app.scoreboardIsFresh(null, now), false);
});

test('applyCachedScoreboard: a fresh doc replaces liveScores and pauses direct polling', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [] }) }; };
  const applied = app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() - 10_000) });
  assert.equal(applied, true);
  assert.equal(app.eval('liveScores').length, 1);
  assert.equal(app.eval('liveScores')[0].id, '401');
  await app.refreshLiveScores();
  assert.equal(fetches, 0, 'refreshLiveScores must not hit ESPN while the cache is fresh');
});

test('applyCachedScoreboard: a stale doc replayed from on-device cache is ignored and direct polling resumes', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [] }) }; };
  const applied = app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() - 10 * 60_000) }, true);
  assert.equal(applied, false);
  await app.refreshLiveScores();
  assert.equal(fetches, 1, 'stale cache => ESPN is polled directly');
});

test('applyCachedScoreboard: a server-delivered doc is used even when the phone clock disagrees with fetchedAt', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [] }) }; };
  // phone clock 10 minutes fast: fetchedAt looks "old" but the server just delivered it
  assert.equal(app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() - 10 * 60_000) }, false), true);
  await app.refreshLiveScores();
  assert.equal(fetches, 0, 'must not fall back to ESPN because of clock skew');
  // phone clock slow: fetchedAt in the future
  assert.equal(app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() + 10 * 60_000) }, false), true);
  assert.equal(app.applyCachedScoreboard({ events: sampleEvents() }, false), false, 'doc without fetchedAt is malformed');
});

test('refreshLiveScores: falls back to direct polling once a previously fresh cache ages out', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [] }) }; };
  app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now()) });
  await app.refreshLiveScores();
  assert.equal(fetches, 0, 'still inside the window');
  app.eval('_scoreboardSeenAt = Date.now() - 3 * 60 * 1000 - 1'); // last snapshot arrived just over 3 minutes ago
  await app.refreshLiveScores();
  assert.equal(fetches, 1, 'just past the window => poll');
});

test('subscribeScoreboard: with no Firestore handle it is a no-op (offline/local mode)', () => {
  const app = createApp();
  app.db = null;
  assert.doesNotThrow(() => app.subscribeScoreboard('20270318'));
});

test('subscribeScoreboard: listens on scoreboard/{date}, uses fresh docs, polls on missing docs and on errors', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ events: [] }) }; };
  let listener = null, errHandler = null, unsubscribed = 0, docPath = '';
  app.db = {
    collection: (c) => ({ doc: (d) => ({ onSnapshot: (ok, err) => { docPath = c + '/' + d; listener = ok; errHandler = err; return () => { unsubscribed++; }; } }) })
  };
  app.subscribeScoreboard('20270318');
  assert.equal(docPath, 'scoreboard/20270318');

  listener({ exists: false });
  await new Promise(r => setImmediate(r));
  assert.equal(fetches, 1, 'missing doc => direct poll');

  listener({ exists: true, metadata: { fromCache: true }, data: () => ({ events: sampleEvents(), fetchedAt: ts(Date.now() - 20 * 60_000) }) });
  await new Promise(r => setImmediate(r));
  assert.equal(fetches, 2, 'old doc replayed from on-device cache => direct poll');

  listener({ exists: true, metadata: { fromCache: false }, data: () => ({ events: sampleEvents(), fetchedAt: ts(Date.now()) }) });
  assert.equal(app.eval('liveScores')[0].id, '401');
  await app.refreshLiveScores();
  assert.equal(fetches, 2, 'fresh doc => no extra poll');

  errHandler({ code: 'permission-denied' });
  await new Promise(r => setImmediate(r));
  assert.equal(fetches, 3, 'listener error (e.g. rules not updated) => direct poll');

  app.unsubscribeScoreboard();
  assert.equal(unsubscribed, 1);
});

/* ── server side (functions/) ── */

test('espn-parse: server and client parsers produce identical output', () => {
  const app = createApp();
  const fixture = { events: [
    { id: '1', shortName: 'A @ B', date: '2027-03-18T17:00Z', competitions: [{
      status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL', detail: 'Final', shortDetail: 'Final' }, displayClock: '0:00', period: 2 },
      notes: [{ headline: "NCAA Men's Basketball Championship - East Region - 1st Round" }],
      broadcasts: [{ names: ['TBS'] }], venue: { fullName: 'Arena' },
      competitors: [
        { homeAway: 'home', winner: false, score: '70', curatedRank: { current: 3 }, records: [{ summary: '25-8' }], team: { id: '20', shortDisplayName: 'Kentucky', abbreviation: 'UK', logo: 'k.png', color: '0033A0' } },
        { homeAway: 'away', winner: true, score: '80', curatedRank: { current: 14 }, records: [{ summary: '23-11' }], team: { id: '10', shortDisplayName: 'Oakland', abbreviation: 'OAK', logo: 'o.png', color: '000' } }
      ] }] },
    { id: '2' },
    { id: '3', name: 'C vs D', competitions: [{ competitors: [{ team: { displayName: 'C' } }, { team: { displayName: 'D' } }] }] }
  ] };
  assert.deepEqual(serverParse.parseScoreboardEvents(fixture), app.espn.parseScoreboardEvents(fixture));
  assert.deepEqual(serverParse.parseScoreboardEvents(null), []);
});

test('scoreboard-logic: shouldPoll honours the _config override and the March/April window', () => {
  const inWindow = new Date('2027-03-20T18:00:00Z');
  const offSeason = new Date('2026-10-14T05:00:00Z');
  assert.equal(logic.shouldPoll(inWindow, null), true);
  assert.equal(logic.shouldPoll(offSeason, null), false);
  assert.equal(logic.shouldPoll(offSeason, { enabled: true }), true);
  assert.equal(logic.shouldPoll(inWindow, { enabled: false }), false);
  assert.equal(logic.shouldPoll(new Date('2027-03-10T12:00:00Z'), null), true, 'window start inclusive');
  assert.equal(logic.shouldPoll(new Date('2027-04-10T12:00:00Z'), null), true, 'window end inclusive');
  assert.equal(logic.shouldPoll(new Date('2027-04-11T12:00:00Z'), null), false);
});

test('scoreboard-logic: datesToPoll uses Eastern time and includes yesterday before 4am', () => {
  // 02:30 ET on Mar 19 = 06:30Z (EDT)
  assert.deepEqual(logic.datesToPoll(new Date('2027-03-19T06:30:00Z')), ['20270319', '20270318']);
  // 23:30 ET on Mar 18 = 03:30Z Mar 19 — still the 18th in New York
  assert.deepEqual(logic.datesToPoll(new Date('2027-03-19T03:30:00Z')), ['20270318']);
  assert.deepEqual(logic.datesToPoll(new Date('2027-03-19T16:00:00Z')), ['20270319']);
});

test('scoreboard-logic: document shape and ESPN URL', () => {
  const doc = logic.buildDoc('20270318', sampleEvents(), 'SERVER_TS');
  assert.deepEqual(Object.keys(doc).sort(), ['date', 'eventCount', 'events', 'fetchedAt', 'source']);
  assert.equal(doc.eventCount, 1);
  assert.equal(doc.fetchedAt, 'SERVER_TS');
  assert.equal(logic.scoreboardUrl('20270318'), 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20270318&limit=200');
  // ESPN's edge returns 403 to a User-Agent that carries a URL or comment, so the header must stay a bare product token.
  const ua = logic.FETCH_HEADERS['User-Agent'];
  assert.equal(typeof ua, 'string');
  assert.ok(ua.length > 0 && !/[ (+;]/.test(ua) && !ua.includes('http'), `User-Agent must be a bare token, got ${ua}`);
});

test('scoreboard-logic: buildDoc strips the undefined fields pre-game ESPN events produce (Firestore rejects them)', () => {
  // Real pre-game shape: no `winner`, no `curatedRank`, no score yet.
  const preGame = { events: [{ id: '9', shortName: 'A @ B', date: '2027-03-18T17:00Z', competitions: [{
    status: { type: { state: 'pre', name: 'STATUS_SCHEDULED', shortDetail: '3/18 - 12:15 PM EDT' } },
    competitors: [
      { homeAway: 'home', team: { id: '20', shortDisplayName: 'Kentucky', abbreviation: 'UK' } },
      { homeAway: 'away', team: { id: '10', shortDisplayName: 'Oakland', abbreviation: 'OAK' } }
    ] }] }] };
  const parsed = serverParse.parseScoreboardEvents(preGame);
  assert.equal(parsed[0].home.winner, undefined, 'precondition: parser leaves winner undefined before tip-off');
  const doc = logic.buildDoc('20270318', parsed, 'SERVER_TS');
  const undefinedPaths = [];
  (function walk(v, path) {
    if (v === undefined) { undefinedPaths.push(path); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], path + '.' + k);
  })(doc, 'doc');
  assert.deepEqual(undefinedPaths, []);
  assert.equal(doc.eventCount, 1);
  assert.equal(doc.events[0].state, 'pre');
  assert.equal(doc.events[0].home.name, 'Kentucky');
  assert.equal('winner' in doc.events[0].home, false);
});
