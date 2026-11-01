const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* When the direct ESPN poll fails (offline, ESPN blocked, HTTP error) the Live tab used to say
 * "No games found", which reads as "no games today". refreshLiveScores now records the failure in
 * liveLastError and renderLive shows "Scores unavailable" instead. 80-pages.js is loaded once on
 * top of the harness so renderLive can be exercised against a small fake DOM: renderLive paints the
 * shell once and then patches #live-error / #live-outage / #live-empty / #live-grid in place, so the
 * tests assert on those elements' display state rather than on one innerHTML string. */
let pagesLoaded = false;

function fakeEl(id) {
  return { id, style: { display: '' }, textContent: '', dataset: {}, children: [],
    classList: { toggle() {} },
    replaceChildren(...nodes) { this.children = nodes; } };
}

// Minimal container: innerHTML assignment "paints the shell", after which every #id and
// .live-filter-btn[data-filter] lookup returns a stable stub (created on first use).
function fakeContainer() {
  const els = new Map();
  const c = {
    id: 'c', _html: '', painted: false,
    get innerHTML() { return this._html; },
    set innerHTML(h) { this._html = h; this.painted = h.includes('id="live-grid"'); els.clear(); },
    querySelector(sel) {
      if (!this.painted) return null;
      if (!els.has(sel)) els.set(sel, fakeEl(sel));
      return els.get(sel);
    },
    el(id) { return this.querySelector('#' + id); },
  };
  return c;
}

function liveApp() {
  const app = createApp({ phase: 'live', liveScoresFilter: 'all' });
  const c = fakeContainer();
  app.window = { addEventListener() {} };
  app.document = {
    addEventListener() {}, querySelector() { return null; },
    getElementById(id) { return id === 'c' ? c : null; },
    createElement(tag) {
      assert.equal(tag, 'template');
      const t = { content: { firstElementChild: null } };
      Object.defineProperty(t, 'innerHTML', { set(h) {
        const m = /data-gid="([^"]*)"/.exec(h);
        t.content.firstElementChild = Object.assign(fakeEl('card'), { dataset: { gid: m ? m[1] : '' }, html: h });
      } });
      return t;
    },
  };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  app.eval('liveScores = []; liveLastRefresh = 0; liveLastError = false; _scoreboardFresh = false;');
  return { app, c };
}

const shown = (c, id) => c.el(id).style.display !== 'none';
const ts = (ms) => ({ toMillis: () => ms });
const oneLiveGame = () => [{ id: '401', name: 'A @ B', state: 'in', completed: false, away: { name: 'A', ncaaId: '1', winner: false }, home: { name: 'B', ncaaId: '2', winner: false } }];

test('refreshLiveScores: a failed ESPN fetch sets liveLastError and still re-renders the Live tab', async () => {
  const { app, c } = liveApp();
  app.fetch = async () => { throw new Error('offline'); };
  await app.refreshLiveScores();
  assert.equal(app.eval('liveLastError'), true);
  assert.equal(app.eval('liveScores').length, 0);
  assert.ok(c.painted, 'the Live tab re-rendered after the failure');
  assert.match(c.innerHTML, /Scores unavailable/);
  assert.ok(shown(c, 'live-error'), 'header badge visible');
  assert.ok(shown(c, 'live-outage'), 'outage card visible');
  assert.ok(!shown(c, 'live-empty'), 'an outage must not be reported as an empty slate');
});

test('refreshLiveScores: an HTTP error counts as a failure; the next good poll clears it', async () => {
  const { app, c } = liveApp();
  app.fetch = async () => ({ ok: false, status: 503 });
  await app.refreshLiveScores();
  assert.equal(app.eval('liveLastError'), true);
  assert.ok(shown(c, 'live-outage'));
  app.fetch = async () => ({ ok: true, json: async () => ({ games: [] }) });
  await app.refreshLiveScores();
  assert.equal(app.eval('liveLastError'), false);
  assert.ok(shown(c, 'live-empty'), 'a genuine empty day still says so');
  assert.ok(!shown(c, 'live-outage'));
  assert.ok(!shown(c, 'live-error'));
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
  app.renderLive(c);
  assert.equal(c.el('live-grid').children.length, 1, 'the earlier card is still on screen');
  assert.ok(shown(c, 'live-error'), 'header badge');
  assert.ok(!shown(c, 'live-outage'), 'no outage card while scores are on screen');
  assert.ok(!shown(c, 'live-empty'));

  app.S.liveScoresFilter = 'final'; // empty filter, but liveScores is not empty
  app.renderLive(c);
  assert.equal(c.el('live-grid').children.length, 0);
  assert.ok(shown(c, 'live-error'), 'header badge stays');
  assert.ok(shown(c, 'live-empty'), 'the empty-filter card is about the filter, not the outage');
  assert.ok(!shown(c, 'live-outage'));
});

test('renderLive: no failure and no games renders the plain "No games found" card without any badge', () => {
  const { app, c } = liveApp();
  app.renderLive(c);
  assert.ok(shown(c, 'live-empty'));
  assert.ok(!shown(c, 'live-error'));
  assert.ok(!shown(c, 'live-outage'));
});

test('renderLive: a second render with the same game reuses the existing card element (in-place patch)', () => {
  const { app, c } = liveApp();
  app.eval('liveScores = ' + JSON.stringify(oneLiveGame()) + ';');
  app.renderLive(c);
  const first = c.el('live-grid').children[0];
  assert.equal(first.dataset.gid, '401');
  app.renderLive(c);
  assert.equal(c.el('live-grid').children[0], first, 'unchanged card is the same node, not a rebuild');
});
