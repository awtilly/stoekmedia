const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Scoring values (S.rp), the draft pointer (S.ds.cp), the year and the derived leaderboard totals are
 * shared room state that any participant can write, and they were printed into innerHTML raw: the
 * scoring footer on every page, the draft progress line, the leaderboard, Settings. A string value
 * there was stored XSS for every participant, the commissioner's unlocked session included. */
const JS = path.join(__dirname, '..', 'js');
const XSS = '<img src=x onerror=alert(1)>';
const ESC = '&lt;img src=x onerror=alert(1)&gt;';

let pagesLoaded = false;
let realRender = null; // createApp() stubs render() every time; keep the one 80-pages.js defines
function pagesApp(overrides) {
  const app = createApp(overrides);
  globalThis.getMyPlayerId = () => 'p1'; globalThis.adminUnlocked = true; globalThis.isOnline = true; // 30/50-auth.js are not loaded
  globalThis.repositionInstallBanner = () => {};
  app.window = { addEventListener() {} };
  const els = { app: { innerHTML: '' }, c: { innerHTML: '' }, 'bracket-area': { innerHTML: '' } };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById: id => els[id] || null };
  if (!pagesLoaded) { vm.runInThisContext(fs.readFileSync(path.join(JS, '80-pages.js'), 'utf8'), { filename: '80-pages.js' }); pagesLoaded = true; realRender = globalThis.render; }
  globalThis.render = realRender;
  return { app, els };
}
const players = () => [{ id: 'p1', name: 'Ann', teamIds: ['South-1'] }, { id: 'p2', name: 'Bob', teamIds: ['South-16'] }];

test('render(): a hostile scoring value is escaped in the footer and on the leaderboard', () => {
  const { app, els } = pagesApp({ phase: 'leaderboard', players: players(), rp: { 1: XSS, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 },
    games: [{ round: 1, t1: 'South-1', t2: 'South-16', wid: 'South-1' }] });
  app.render();
  const html = els.app.innerHTML + els.c.innerHTML;
  assert.match(els.app.innerHTML, /class="footer"/, 'the real page rendered, not the error fallback');
  assert.match(els.c.innerHTML, /class="podium-pts"/, 'leaderboard rendered');
  assert.equal(html.includes('<img src=x'), false, 'raw value must not reach the DOM');
  assert.ok(els.app.innerHTML.includes('Round of 64=' + ESC + 'pts'), 'footer shows it escaped');
  assert.ok(els.c.innerHTML.includes('<div class="podium-pts">0' + ESC + '</div>'), 'string total escaped');
});

test('render(): honest scoring renders exactly as before', () => {
  const { app, els } = pagesApp({ phase: 'leaderboard', players: players(), games: [{ round: 1, t1: 'South-1', t2: 'South-16', wid: 'South-1' }] });
  app.render();
  assert.ok(els.app.innerHTML.includes('Round of 64=1pt · Round of 32=2pts'));
  assert.ok(els.c.innerHTML.includes('<div class="podium-pts">1</div>'));
  assert.ok(els.c.innerHTML.includes('<td class="pts">1</td>'));
});

test('renderSettings: hostile scoring value and year are escaped in text and value="..."', () => {
  const { app, els } = pagesApp({ rp: { 1: '"><svg onload=alert(1)>', 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 }, year: XSS, teams: [] });
  app.roomId = 'MYPOOL';
  app.renderSettings(els.c);
  const html = els.c.innerHTML;
  assert.equal(html.includes('<svg'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.ok(html.includes('value="&quot;&gt;&lt;svg onload=alert(1)&gt;"'), 'scoring input value stays in its attribute');
  assert.ok(html.includes('value="' + ESC + '"'), 'year input value stays in its attribute');
  assert.ok(html.includes('Auto-detected: ' + ESC));
  assert.ok(html.includes('Import ' + ESC + ' Tournament Teams'));
});

test('renderSettings: honest values unchanged', () => {
  const { app, els } = pagesApp({ year: 2027 });
  app.renderSettings(els.c);
  assert.ok(els.c.innerHTML.includes('<input type="number" value="1" style="width:100%" onchange="changeScoring(1,this.value)">'));
  assert.ok(els.c.innerHTML.includes('Base <strong style="color:var(--gold)">1</strong> + Upset <strong style="color:var(--gold)">7</strong> = <strong>8 pts</strong>'));
  assert.ok(els.c.innerHTML.includes('<input type="number" value="2027" style="width:90px"'));
});

test('renderDraft: a hostile draft pointer is escaped in "Pick N of M"', () => {
  const { app, els } = pagesApp({ players: players(), ds: { order: ['p1', 'p2', 'p2', 'p1'], cp: XSS, started: true, complete: false } });
  app.renderDraft(els.c);
  assert.equal(els.c.innerHTML.includes('<img src=x'), false);
  assert.ok(els.c.innerHTML.includes('Pick ' + ESC + '1 of 4'));
  const ok = pagesApp({ players: players(), ds: { order: ['p1', 'p2', 'p2', 'p1'], cp: 1, started: true, complete: false } });
  ok.app.renderDraft(ok.els.c);
  assert.ok(ok.els.c.innerHTML.includes('Pick 2 of 4'));
});

test('renderFF: championship slots escape the seed like every other slot', () => {
  const { app, els } = pagesApp({ players: players() });
  app.S.bracket.South[14] = 'South-1'; app.S.bracket.East[14] = 'East-1'; app.S.bracket.ff[0] = 'South-1';
  app.S.teams.find(t => t.id === 'South-1').seed = XSS; // bypassing the sanitizer, which coerces seeds to numbers
  app.renderFF();
  assert.equal(els['bracket-area'].innerHTML.includes('<img src=x'), false);
  assert.ok(els['bracket-area'].innerHTML.includes('<span class="sd">' + ESC + '</span>'));
});

test('sanitizeSharedState: players, teams and ds.order that are not arrays become [] (and the pass completes)', () => {
  const app = createApp();
  const s = { players: { length: XSS }, teams: { length: XSS }, ds: { order: { length: XSS }, cp: 0 } };
  assert.doesNotThrow(() => app.sanitizeSharedState(s));
  assert.deepEqual([s.players, s.teams, s.ds.order], [[], [], []]);
  // before: a non-iterable teams threw half-way, so hostile draft-order ids were never scrubbed
  const t = { players: [], teams: { length: 1 }, ds: { order: ['p1', "x');alert(1);('"] } };
  app.sanitizeSharedState(t);
  assert.deepEqual(t.ds.order, ['p1']);
});

test('80-pages.js never interpolates scoring, draft pointer, year or totals unescaped', () => {
  // Lines that feed appConfirm/appAlert/appPrompt/appChoice/showToast are skipped: 40-ui.js escapes (or textContent-s) those.
  const src = fs.readFileSync(path.join(JS, '80-pages.js'), 'utf8').split('\n').filter(l => !/\b(appConfirm|appAlert|appPrompt|appChoice|showToast)\(/.test(l)).join('\n');
  const raw = src.match(/\$\{(p|ds\.cp\+1|ds\.order\.length|S\.rp\[[^\]]+\][^}]*|S\.year|s\.tot|mySc\.tot|s\.rp\[r\]|ff[01]t\.seed)\}/g) || [];
  assert.deepEqual(raw, [], 'unescaped: ' + raw.join(', '));
});
