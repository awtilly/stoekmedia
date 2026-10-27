const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Stored XSS via p.id (audit X3): the join screen rendered onclick="claimPlayer('${p.id}')" and any
 * participant can write the players list. sanitizeSharedState (20a21817) already drops ids outside
 * [A-Za-z0-9_-] on every snapshot and local load; the button now also carries the id in an escaped
 * data-player-id attribute and the handler reads this.dataset.playerId, so no room-state value is
 * ever parsed as JavaScript there, whatever reaches S.players. */
const JS = path.join(__dirname, '..', 'js');
const EVIL_IDS = ["x');alert(1);('", '" onmouseover="alert(1)', 'a&#39;);alert(1);//', '<img src=x onerror=alert(1)>'];
const HOSTILE_NAME = '<img src=x onerror=alert(1)>';

let authLoaded = false;
function joinApp(players, room) {
  const app = createApp({ players });
  const ls = {};
  app.localStorage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } };
  const el = { innerHTML: '' };
  app.document = { getElementById: id => (id === 'app' ? el : null) };
  if (!authLoaded) { vm.runInThisContext(fs.readFileSync(path.join(JS, '50-auth.js'), 'utf8'), { filename: '50-auth.js' }); authLoaded = true; }
  app.roomId = room === undefined ? 'MYPOOL' : room;
  return { app, el, ls };
}

// What the browser hands to the handler: the attribute value with HTML character references decoded.
const decodeAttr = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function buttons(html) {
  return [...html.matchAll(/<button class="btn btn-secondary"[^>]*?data-player-id="([^"]*)" onclick="([^"]*)">([\s\S]*?)<\/button>/g)]
    .map(m => ({ id: decodeAttr(m[1]), onclick: m[2], label: m[3] }));
}

test('renderJoinScreen: returning-player buttons pass the id via data-player-id, not a JS string', () => {
  const { app, el } = joinApp([{ id: '3f2a9c1e-7b4d-4e8a-9f0c-1234567890ab', name: 'Ann', teamIds: [] }, { id: 'p2', name: HOSTILE_NAME, teamIds: [] }]);
  app.renderJoinScreen();
  const b = buttons(el.innerHTML);
  assert.deepEqual(b.map(x => x.id), ['3f2a9c1e-7b4d-4e8a-9f0c-1234567890ab', 'p2']);
  for (const x of b) assert.equal(x.onclick, 'claimPlayer(this.dataset.playerId)');
  assert.equal(b[1].label, '&lt;img src=x onerror=alert(1)&gt;', 'name still escaped');
  assert.doesNotMatch(el.innerHTML, /claimPlayer\('/);
  assert.match(el.innerHTML, /Welcome to room <strong>MYPOOL<\/strong>/);
});

test('renderJoinScreen: even an unsafe id that skipped the sanitizer stays inert data', () => {
  const players = EVIL_IDS.map((id, i) => ({ id, name: 'P' + i, teamIds: [] }));
  const { app, el } = joinApp(players);
  app.renderJoinScreen();
  const b = buttons(el.innerHTML);
  assert.equal(b.length, EVIL_IDS.length, 'one intact button per player, none broke out of its attribute');
  assert.deepEqual(b.map(x => x.id), EVIL_IDS, 'the handler receives the exact id string');
  for (const x of b) assert.equal(x.onclick, 'claimPlayer(this.dataset.playerId)');
  assert.doesNotMatch(el.innerHTML, /<img|onmouseover="alert/);
});

test('renderJoinScreen: a hostile roomId (should validation ever be bypassed) is escaped', () => {
  const { app, el } = joinApp([], '<img src=x onerror=alert(1)>');
  app.renderJoinScreen();
  assert.doesNotMatch(el.innerHTML, /<img/);
  assert.match(el.innerHTML, /Welcome to room <strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/);
});

test('room state with a hostile player id: the sanitizer drops it before the join screen renders', () => {
  const { app, el } = joinApp([]);
  const remote = { players: [{ id: 'p1', name: 'Ann', teamIds: [] }, { id: EVIL_IDS[0], name: 'Mallory', teamIds: [] }] };
  Object.assign(app.S, remote);
  app.sanitizeSharedState(app.S);
  app.renderJoinScreen();
  assert.deepEqual(buttons(el.innerHTML).map(x => x.label), ['Ann']);
});

test('claimPlayer(this.dataset.playerId) still claims the player (no PIN set)', async () => {
  const { app, ls } = joinApp([{ id: 'p1', name: 'Ann', teamIds: [] }]);
  await app.claimPlayer('p1');
  assert.equal(ls.mm4_me_MYPOOL, 'p1');
  assert.equal(app.__calls.render, 1);
  await app.claimPlayer(EVIL_IDS[0]); // unknown id: ignored, as before
  assert.equal(ls.mm4_me_MYPOOL, 'p1');
});

test('js/ never builds claimPlayer(\'${...}\') again', () => {
  for (const f of fs.readdirSync(JS).filter(f => f.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(JS, f), 'utf8'), /claimPlayer\('\$\{/, f);
  }
});
