const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./_harness');
const serverParse = require('../functions/ncaa-parse');
const logic = require('../functions/scoreboard-logic');

const ts = (ms) => ({ toMillis: () => ms });
const sampleEvents = () => [{ id: '401', name: 'A at B', state: 'in', completed: false, tournament: true, away: { name: 'A', ncaaId: 'a', winner: false }, home: { name: 'B', ncaaId: 'b', winner: false } }];

/* ── client side (js/20-live.js) ── */

test('scoreboardIsFresh: accepts a doc fetched within the max age and rejects older or malformed docs', () => {
  const app = createApp();
  const now = 1_000_000_000;
  assert.equal(app.scoreboardIsFresh({ events: [], fetchedAt: ts(now - 60_000) }, now), true);
  assert.equal(app.scoreboardIsFresh({ events: [], fetchedAt: ts(now - 4 * 60_000) }, now), false, '4 minutes old is stale');
  assert.equal(app.scoreboardIsFresh({ events: 'nope', fetchedAt: ts(now) }, now), false);
  assert.equal(app.scoreboardIsFresh({ games: [] }, now), false, 'missing fetchedAt');
  assert.equal(app.scoreboardIsFresh(null, now), false);
});

test('applyCachedScoreboard: a fresh doc replaces liveScores and pauses direct polling', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ games: [] }) }; };
  const applied = app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() - 10_000) });
  assert.equal(applied, true);
  assert.equal(app.eval('liveScores').length, 1);
  assert.equal(app.eval('liveScores')[0].id, '401');
  await app.refreshLiveScores();
  assert.equal(fetches, 0, 'refreshLiveScores must not poll while the cache is fresh');
});

test('applyCachedScoreboard: a stale doc replayed from on-device cache is ignored and direct polling resumes', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ games: [] }) }; };
  const applied = app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() - 10 * 60_000) }, true);
  assert.equal(applied, false);
  await app.refreshLiveScores();
  assert.equal(fetches, 1, 'stale cache => the scoreboard is polled directly');
});

test('applyCachedScoreboard: a server-delivered doc is used even when the phone clock disagrees with fetchedAt', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ games: [] }) }; };
  // phone clock 10 minutes fast: fetchedAt looks "old" but the server just delivered it
  assert.equal(app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() - 10 * 60_000) }, false), true);
  await app.refreshLiveScores();
  assert.equal(fetches, 0, 'must not fall back to polling because of clock skew');
  // phone clock slow: fetchedAt in the future
  assert.equal(app.applyCachedScoreboard({ events: sampleEvents(), fetchedAt: ts(Date.now() + 10 * 60_000) }, false), true);
  assert.equal(app.applyCachedScoreboard({ events: sampleEvents() }, false), false, 'doc without fetchedAt is malformed');
});

test('refreshLiveScores: falls back to direct polling once a previously fresh cache ages out', async () => {
  const app = createApp();
  let fetches = 0;
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ games: [] }) }; };
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
  app.fetch = async () => { fetches++; return { ok: true, json: async () => ({ games: [] }) }; };
  let listener = null, errHandler = null, unsubscribed = 0, docPath = '';
  app.db = {
    collection: (c) => ({ doc: (d) => ({ onSnapshot: (ok, err) => { docPath = c + '/' + d; listener = ok; errHandler = err; return () => { unsubscribed++; }; } }) })
  };
  app.S.liveScoresDate = '20270318'; // the listener and the direct poll always share the selected date; a mismatch would (rightly) re-subscribe
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

test('ncaa-parse: server and client parsers produce identical output on the real 2026 sample', () => {
  const app = createApp();
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncaa-scoreboard-sample.json'), 'utf8'));
  fixture.games.push({}, null, { game: { gameID: 'x', away: { names: { short: 'Only' } }, home: {} } });
  assert.deepEqual(serverParse.parseScoreboard(fixture), app.ncaa.parseScoreboard(fixture));
  assert.equal(serverParse.parseScoreboard(fixture).length, 5);
  assert.deepEqual(serverParse.parseScoreboard(null), []);
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

test('scoreboard-logic: document shape, NCAA.com URL and proxy route allow-list', () => {
  const doc = logic.buildDoc('20270318', sampleEvents(), 'SERVER_TS');
  assert.deepEqual(Object.keys(doc).sort(), ['date', 'eventCount', 'events', 'fetchedAt', 'source']);
  assert.equal(doc.eventCount, 1);
  assert.equal(doc.source, 'ncaa');
  assert.equal(doc.fetchedAt, 'SERVER_TS');
  assert.equal(logic.scoreboardPath('20270318'), '/scoreboard/basketball-men/d1/2027/03/18');
  assert.equal(logic.scoreboardUrl('20270318'), 'https://ncaa-api.henrygd.me/scoreboard/basketball-men/d1/2027/03/18');
  // the proxy forwards exactly the two routes the clients need and nothing else (no open proxy)
  assert.equal(logic.allowedPath('/scoreboard/basketball-men/d1/2027/03/18'), true);
  assert.equal(logic.allowedPath('/brackets/basketball-men/d1/2027'), true);
  assert.equal(logic.allowedPath('/scoreboard/basketball-women/d1/2027/03/18'), false);
  assert.equal(logic.allowedPath('/scoreboard/basketball-men/d1/2027/03/18/extra'), false);
  assert.equal(logic.allowedPath('/logo/michigan.svg'), false);
  assert.equal(logic.allowedPath('/game/6534640/boxscore'), false);
  assert.equal(logic.allowedPath(''), false);
  // keep the User-Agent a bare product token: some edges answer 403 to one that carries a URL or comment.
  const ua = logic.FETCH_HEADERS['User-Agent'];
  assert.equal(typeof ua, 'string');
  assert.ok(ua.length > 0 && !/[ (+;]/.test(ua) && !ua.includes('http'), `User-Agent must be a bare token, got ${ua}`);
});

test('scoreboard-logic: buildDoc strips the undefined fields pre-game events produce (Firestore rejects them)', () => {
  // Real pre-game shape: winner false on both sides, no scores, no seeds outside the tournament.
  const preGame = { games: [{ game: { gameID: '9', gameState: 'pre', startTime: '12:15 PM ET', startTimeEpoch: '1773850500', currentPeriod: '', contestClock: '',
    away: { score: '', winner: false, seed: '', names: { short: 'Oakland', char6: 'OAKLND', seo: 'oakland' } },
    home: { score: '', winner: false, seed: '', names: { short: 'Kentucky', char6: 'KNTCKY', seo: 'kentucky' } } } }] };
  const parsed = serverParse.parseScoreboard(preGame);
  assert.equal(parsed[0].home.winner, undefined, 'precondition: parser leaves winner undefined before tip-off');
  assert.equal(parsed[0].home.seed, undefined, 'precondition: no seed outside the tournament');
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
  assert.equal('seed' in doc.events[0].home, false);
});
