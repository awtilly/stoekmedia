const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* My Teams: under each team that is still in, the page names the round of its next game. It used to say
 * "Alive" for every team: it looked for a game without a winner, and S.games only holds decided games. */
let pagesLoaded = false;
function teamsApp() {
  const app = createApp({
    phase: 'bracket',
    players: [{ id: 'p1', name: 'Ann', teamIds: [] }, { id: 'p2', name: 'Bob', teamIds: [] }],
    ds: { order: ['p1', 'p2'], cp: 2, started: true, complete: true },
  });
  globalThis.getMyPlayerId = () => 'p1'; globalThis.adminUnlocked = false; // 50-auth.js is not loaded by the harness
  app.window = { addEventListener() {} };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  return app;
}
/** The text of the status line ("Region · status") in a team's row. */
const statusOf = (html, name) => {
  const row = html.split('<tr').find(r => r.includes('<div class="tn">' + name + '</div>'));
  assert.ok(row, 'row for ' + name);
  return row.match(/<div class="st">[^<\u00b7]*\u00b7 ([^<]*)<\/div>/)[1];
};

test('My Teams names the next round of a team that is still in, and the round a team went out in', () => {
  const app = teamsApp();
  const first = app.getTeamForSlot('South', 0, 0), second = app.getTeamForSlot('South', 0, 1); // the first Round of 64 game
  const idle = app.getTeamForSlot('South', 1, 0);                                               // has not played yet
  app.S.players[0].teamIds = [first.id, second.id, idle.id];
  app.S.bracket.South[0] = first.id;
  app.syncGames();
  const c = { innerHTML: '' };
  app.renderMyTeams(c, 'p1');
  assert.equal(statusOf(c.innerHTML, app.teamDisplayName(idle)), 'Round of 64');
  assert.equal(statusOf(c.innerHTML, app.teamDisplayName(first)), 'Round of 32');
  assert.match(statusOf(c.innerHTML, app.teamDisplayName(second)), /^Out/);
});

test('My Teams calls the team with six wins the champion', () => {
  const app = teamsApp();
  const t = app.getTeamForSlot('South', 0, 0);
  app.S.players[0].teamIds = [t.id];
  app.S.games = [1, 2, 3, 4, 5, 6].map(round => ({ id: 'g' + round, round, t1: t.id, t2: 'x' + round, wid: t.id }));
  const c = { innerHTML: '' };
  app.renderMyTeams(c, 'p1');
  assert.equal(statusOf(c.innerHTML, app.teamDisplayName(t)), 'Champion');
});
