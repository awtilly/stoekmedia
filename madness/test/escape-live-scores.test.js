const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Live Scores renders the ESPN scoreboard straight into innerHTML. Team names, notes, broadcast and
 * venue were escaped; logo (inside src="..."), record, score, seed and the in-game status line were
 * not. ESPN is a third party fetched over the network, so its strings are untrusted like room state. */
const JS = path.join(__dirname, '..', 'js');
const XSS = '<img src=x onerror=alert(1)>';

let pagesLoaded = false;
function liveApp(rawScoreboard) {
  const app = createApp({ phase: 'live', liveScoresDate: '20270320', liveScoresFilter: 'all' });
  globalThis.getMyPlayerId = () => null; globalThis.adminUnlocked = false; // 50-auth.js is not loaded here
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) { vm.runInThisContext(fs.readFileSync(path.join(JS, '80-pages.js'), 'utf8'), { filename: '80-pages.js' }); pagesLoaded = true; }
  const games = app.espn.parseScoreboardEvents(rawScoreboard); // the real ESPN -> liveScores path
  vm.runInThisContext('liveScores = ' + JSON.stringify(games) + '; liveLastRefresh = 0;');
  const c = { innerHTML: '' };
  app.renderLive(c);
  return c.innerHTML;
}

function scoreboard({ away, home, state = 'in', shortDetail = '2nd 5:00' }) {
  const comp = (side, t) => ({
    homeAway: side, score: t.score, winner: false, curatedRank: { current: t.seed },
    records: [{ summary: t.record }],
    team: { id: t.id, shortDisplayName: t.name, abbreviation: t.abbr, logo: t.logo, color: '000000' },
  });
  return { events: [{
    id: '401', date: '2027-03-20T17:00Z', shortName: 'A @ B',
    competitions: [{
      status: { type: { state, shortDetail, detail: shortDetail, name: 'STATUS_IN_PROGRESS', completed: state === 'post' } },
      notes: [{ headline: "Men's Basketball Championship - South Region - 1st Round" }],
      competitors: [comp('away', away), comp('home', home)],
    }],
  }] };
}

test('renderLive: hostile ESPN logo, record, score and status are escaped', () => {
  const html = liveApp(scoreboard({
    away: { id: '1', name: 'Away U', abbr: 'AWY', seed: 5, logo: 'https://a.espncdn.com/x.png" onerror="alert(1)', record: XSS, score: XSS },
    home: { id: '2', name: 'Home St', abbr: 'HOM', seed: 12, logo: 'javascript:alert(1)"><script>alert(1)</script>', record: '<b>20-5</b>', score: '"><svg onload=alert(1)>' },
    shortDetail: '<svg onload=alert(1)>',
  }));
  assert.match(html, /class="score-card live/, 'card rendered');
  for (const raw of ['<img src=x', '<svg', '<script', '<b>', '" onerror="']) {
    assert.equal(html.includes(raw), false, 'raw ' + raw + ' must not reach the DOM');
  }
  const srcs = [...html.matchAll(/<img src="([^"]*)" alt="">/g)].map(m => m[1]);
  assert.deepEqual(srcs, [
    'https://a.espncdn.com/x.png&quot; onerror=&quot;alert(1)',
    'javascript:alert(1)&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
  ], 'logo stays inside its src attribute');
  assert.match(html, /<span class="team-record">&lt;img src=x onerror=alert\(1\)&gt;<\/span>/);
  assert.match(html, /<span class="team-score">&quot;&gt;&lt;svg onload=alert\(1\)&gt;<\/span>/);
  assert.match(html, /">&lt;svg onload=alert\(1\)&gt;<\/div>/, 'status line escaped');
});

test('renderLive: an honest game renders exactly as before', () => {
  const html = liveApp(scoreboard({
    away: { id: '1', name: 'Away U', abbr: 'AWY', seed: 5, logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/1.png', record: '24-8', score: '41' },
    home: { id: '2', name: 'Home St', abbr: 'HOM', seed: 12, logo: '', record: '', score: '38' },
  }));
  assert.match(html, /<img src="https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500\/1\.png" alt="">/);
  assert.match(html, /<span class="team-seed">5<\/span>/);
  assert.match(html, /<span class="team-seed">12<\/span>/);
  assert.match(html, /<span class="team-record">24-8<\/span>/);
  assert.match(html, /<span class="team-score">41<\/span>/);
  assert.match(html, /<span class="team-score">38<\/span>/);
  assert.match(html, /<span style="width:24px"><\/span>/, 'no logo placeholder unchanged');
  assert.match(html, />2nd 5:00<\/div>/);
});

test('80-pages.js never interpolates an ESPN game field into HTML unescaped', () => {
  const src = fs.readFileSync(path.join(JS, '80-pages.js'), 'utf8');
  // raw forms only: ${game.away.logo}, ${game.away.record || ''}, ${game.away.score || (...)}, "? game.away.seed :", "? game.shortDetail :"
  const raw = src.match(/\$\{game\.(away|home)\.(logo|record|score)( \|\|[^}]*)?\}|\? game\.(away|home)\.seed :|\? game\.shortDetail :/g) || [];
  assert.deepEqual(raw, [], 'unescaped: ' + raw.join(', '));
});
