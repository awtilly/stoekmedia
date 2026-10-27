const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Reflected XSS via ?room= (audit X3): boot did roomId = urlRoom.toUpperCase() and the join screen put
 * roomId into innerHTML. Upper-casing does not stop an entity-encoded payload, so room codes from
 * ?room=, the Join box and the recent-rooms list are now validated against what createRoom() makes. */
const JS = path.join(__dirname, '..', 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');

// What an attacker puts in a link. All of it survives toUpperCase(); the &#X..; entities decode to <, a, > in HTML.
const ENTITY_PAYLOAD = '&#X3C;IMG SRC=X ONERROR=&#X61;&#X6C;&#X65;&#X72;&#X74;(1)&#X3E;';
const HOSTILE = [
  ENTITY_PAYLOAD, '<img src=x onerror=alert(1)>', "X');ALERT(1);//", 'AB"CD', "AB'CD", 'AB&CD', 'AB<CD', 'AB>CD',
  'AB CD', 'AB\tCD', 'AB\nCD', 'ROOMS/X', 'AB-CD', 'AB_CD', 'AB.CD', 'ÉQUIPE', 'A', '', 'X'.repeat(21),
];

let roomsLoaded = false;
function roomsApp(store) {
  const app = createApp();
  const ls = store || {};
  app.localStorage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } };
  app.window = { location: new URL('https://stoekmedia.com/madness/'), history: { replaceState() {} }, addEventListener() {} };
  if (!roomsLoaded) { vm.runInThisContext(read('60-rooms.js'), { filename: '60-rooms.js' }); roomsLoaded = true; }
  const calls = { connect: [], alerts: [], docs: [] };
  app.connectToRoom = code => { calls.connect.push(code); };
  app.checkAdminSession = () => {};
  app.repositionInstallBanner = () => {};
  app.appAlert = async m => { calls.alerts.push(m); };
  app.db = { collection: () => ({ doc: code => { calls.docs.push(code); return { get: async () => ({ exists: true }) }; } }) };
  return { app, ls, calls };
}

test('isValidRoomCode: accepts every code createRoom() can make, including the original 6-char random codes', () => {
  const app = createApp();
  for (const ok of ['AB', 'ABC123', 'MYPOOL2027', 'BUCKETS', '2027', 'X'.repeat(20)]) assert.equal(app.isValidRoomCode(ok), true, ok);
  // 4f6f094c (2026-02-25) made codes with Math.random().toString(36).substring(2,8).toUpperCase()
  for (let i = 0; i < 500; i++) {
    const legacy = Math.random().toString(36).substring(2, 8).toUpperCase();
    assert.equal(app.isValidRoomCode(legacy), true, legacy);
  }
});

test('isValidRoomCode: rejects markup, quotes, entities, whitespace, separators and bad lengths', () => {
  const app = createApp();
  for (const bad of [...HOSTILE, 'abc', null, undefined, 12, {}, ['AB']]) {
    assert.equal(app.isValidRoomCode(bad), false, 'rejects ' + JSON.stringify(bad));
  }
});

test('parseRoomCode: upper-cases a real code from a link and refuses the reflected-XSS payload', () => {
  const app = createApp();
  assert.equal(app.parseRoomCode('abc123'), 'ABC123');
  assert.equal(app.parseRoomCode(' MyPool2027 '), 'MYPOOL2027');
  const fromLink = new URLSearchParams('room=' + encodeURIComponent(ENTITY_PAYLOAD)).get('room');
  assert.equal(fromLink.toUpperCase(), ENTITY_PAYLOAD, 'payload survives toUpperCase, which is why that was not enough');
  assert.equal(app.parseRoomCode(fromLink), null);
  for (const bad of [...HOSTILE, null, undefined, 42]) assert.equal(app.parseRoomCode(bad), null, JSON.stringify(bad));
});

test('createRoom and the Join box agree: a typed room name joins the code createRoom made from it', async () => {
  const { app, calls } = roomsApp();
  for (const name of ['My Pool 2027', 'buckets', "Joe's Bracket!", '  ab  ', 'Big-East_Fans', 'x'.repeat(20)]) {
    calls.docs.length = 0;
    app.document = { getElementById: id => (id === 'room-name' ? { value: name } : null) };
    await app.createRoom(); // the stub db says the code is taken, so createRoom stops right after computing it
    const created = calls.docs[0];
    assert.equal(app.isValidRoomCode(created), true, 'createRoom made ' + created);
    assert.equal(app.roomCodeFromInput(name), created, name);
  }
  assert.equal(app.roomCodeFromInput('<img src=x onerror=alert(1)>'), 'IMGSRCXONERRORALERT1', 'only letters and digits survive');
  assert.equal(app.roomCodeFromInput('x'.repeat(21)), null, 'too long, same as createRoom');
  assert.equal(app.roomCodeFromInput('!'), null);
});

test('joinRoom: a hostile code never becomes roomId; a real one still joins', () => {
  const { app, calls } = roomsApp();
  const input = { value: '' };
  app.document = { getElementById: id => (id === 'room-code' ? input : null) };
  input.value = '"><svg onload=alert(1)>';
  app.joinRoom();
  assert.ok(app.isValidRoomCode(app.roomId), 'whatever is left is letters/digits only: ' + app.roomId);
  input.value = '<>';
  app.roomId = null;
  app.joinRoom();
  assert.equal(app.roomId, null);
  assert.deepEqual(app.__calls.toasts, ['Room code must be 2-20 letters or numbers']);
  input.value = '  mypool2027 ';
  app.joinRoom();
  assert.equal(app.roomId, 'MYPOOL2027');
  assert.equal(calls.connect.at(-1), 'MYPOOL2027');
});

test('recent rooms in localStorage: junk entries are dropped, never rendered, never rejoined', () => {
  const { app, ls, calls } = roomsApp({ mm4_rooms: JSON.stringify([{ code: ENTITY_PAYLOAD }, { code: "X');ALERT(1);//" }, null, { code: 'MYPOOL' }]) });
  assert.deepEqual(app.getRecentRooms().map(r => r.code), ['MYPOOL']);

  const appEl = { innerHTML: '' };
  app.document = { getElementById: id => (id === 'app' ? appEl : null) };
  app.renderLobby();
  assert.match(appEl.innerHTML, /data-room="MYPOOL" onclick="rejoinRoom\(this\.dataset\.room\)"/);
  assert.doesNotMatch(appEl.innerHTML, /rejoinRoom\('/, 'no room code inside a JS string in an onclick');
  assert.doesNotMatch(appEl.innerHTML, /&#X3C;|ALERT/);

  app.saveRecentRoom(ENTITY_PAYLOAD);
  app.saveRecentRoom('NEWROOM');
  assert.deepEqual(JSON.parse(ls.mm4_rooms).map(r => r.code), ['NEWROOM', 'MYPOOL'], 'junk purged on the next save');

  app.roomId = null;
  app.rejoinRoom(ENTITY_PAYLOAD);
  assert.equal(app.roomId, null);
  assert.deepEqual(calls.connect, []);
  app.rejoinRoom('MYPOOL');
  assert.equal(app.roomId, 'MYPOOL');
  assert.deepEqual(calls.connect, ['MYPOOL']);
});

test('boot: ?room=<payload> lands in the lobby; ?room=abc123 connects to ABC123 as before', () => {
  const boot = vm.runInThisContext('(function(){' + read('90-boot.js') + '\n})', { filename: '90-boot.js' });
  for (const [search, want] of [['?room=' + encodeURIComponent(ENTITY_PAYLOAD), null], ['?room=%3Cimg%20src%3Dx%3E', null], ['?room=abc123', 'ABC123'], ['?room=MYPOOL2027&tab=live', 'MYPOOL2027']]) {
    const { app, calls } = roomsApp();
    let lobby = 0;
    app.window = { location: { search }, addEventListener() {}, matchMedia: () => ({ matches: false }) };
    app.loadState = () => {};
    app.renderLobby = () => { lobby++; };
    app.startLiveRefresh = () => {};
    app.roomId = null;
    boot();
    assert.equal(app.roomId, want, search);
    assert.deepEqual(calls.connect, want ? [want] : [], search);
    if (!want) assert.equal(lobby, 1, 'lobby rendered for ' + search);
  }
});

test('js/ never interpolates roomId into HTML unescaped, and boot no longer trusts toUpperCase()', () => {
  for (const f of fs.readdirSync(JS).filter(f => f.endsWith('.js'))) {
    const raw = read(f).match(/\$\{roomId\}/g) || [];
    assert.deepEqual(raw, [], f + ' has a raw ${roomId}');
  }
  assert.doesNotMatch(read('90-boot.js'), /roomId\s*=\s*urlRoom\.toUpperCase\(\)/);
});
