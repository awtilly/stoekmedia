const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* selfRegister() (join screen, "Join as New Player") is reachable at any time, unlike addPlayer/adminJoinAsPlayer
 * which only render in the pre-draft lobby. Once the draft has started ds.order is fixed, so a player added now
 * never gets a turn and sits on the leaderboard with no teams. */
test('selfRegister refuses once the draft has started, before reading the form or touching S.players', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '50-auth.js'), 'utf8');
  const body = src.slice(src.indexOf('async function selfRegister('));
  const guard = body.indexOf("if(S.ds && S.ds.started){ showToast('The draft has started.");
  assert.ok(guard >= 0, 'guard present');
  assert.ok(guard < body.indexOf("getElementById('join-name')"), 'guard before the form is read');
  assert.ok(guard < body.indexOf('S.players.push'), 'guard before the player is added');
  assert.ok(body.slice(guard, body.indexOf('S.players.push')).includes('return;'));
});
