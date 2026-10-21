const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* Inside the Capacitor shell WKWebView has no navigator.share and the Safari checkbox haptic trick does
 * nothing. shareRoomLink/shareLeaderboard try the Capacitor Share plugin first and triggerHaptic drives
 * the Haptics plugin. Without window.Capacitor both keep their exact web behaviour. */
// Node 21+ ships a read-only navigator getter; plain assignment is silently ignored, so redefine it.
function setNavigator(nav) { Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true }); }

let pagesLoaded = false;
function pagesApp({ share = null, haptics = null, webShare = false } = {}) {
  const app = createApp({ phase: 'leaderboard', players: [{ id: 'p1', name: 'Ann', teamIds: [] }] });
  globalThis.getMyPlayerId = () => 'p1'; globalThis.adminUnlocked = false; // 50-auth.js is not loaded by the harness
  globalThis.roomId = 'ROOM1';
  const plugins = {};
  if (share) plugins.Share = share;
  if (haptics) plugins.Haptics = haptics;
  app.window = { addEventListener() {}, Capacitor: (share || haptics) ? { Plugins: plugins } : undefined, location: 'https://stoekmedia.com/madness/' };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; }, createElement() { return { style: {}, setAttribute() {} }; }, body: { appendChild() {} } };
  const clip = [];
  setNavigator({ clipboard: { writeText: async t => { clip.push(t); } } });
  if (webShare) { globalThis.navigator.share = async () => { clip.push('WEB_SHARE'); }; globalThis.navigator.canShare = () => true; }
  globalThis.URL = URL;
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  return { app, clip };
}

function fakeShare(behaviour) {
  const calls = [];
  return { calls, async share(opts) { calls.push(opts); if (behaviour === 'cancel') throw new Error('Share canceled'); if (behaviour === 'fail') throw new Error('boom'); } };
}

test('shareRoomLink: in the shell the Share plugin gets title, text and the room URL; the clipboard is not touched', async () => {
  const share = fakeShare();
  const { app, clip } = pagesApp({ share });
  await app.shareRoomLink();
  assert.equal(share.calls.length, 1);
  assert.match(share.calls[0].url, /\?room=ROOM1$/);
  assert.match(share.calls[0].text, /Room: ROOM1/);
  assert.equal(share.calls[0].dialogTitle, share.calls[0].title);
  assert.deepEqual(clip, []);
  assert.deepEqual(app.__calls.toasts, []);
});

test('shareLeaderboard: plugin receives the leaderboard text; cancelling the sheet is silent', async () => {
  const share = fakeShare('cancel');
  const { app, clip } = pagesApp({ share });
  await app.shareLeaderboard();
  assert.equal(share.calls.length, 1);
  assert.match(share.calls[0].text, /Leaderboard/);
  assert.deepEqual(clip, []);
  assert.deepEqual(app.__calls.toasts, []);
});

test('a plugin failure that is not a cancel falls back to the clipboard like the web', async () => {
  const share = fakeShare('fail');
  const { app, clip } = pagesApp({ share });
  await app.shareRoomLink();
  assert.equal(clip.length, 1);
  assert.deepEqual(app.__calls.toasts, ['Room link copied!']);
});

test('web: no plugin -> navigator.share when available, clipboard otherwise (unchanged)', async () => {
  let r = pagesApp({ webShare: true });
  await r.app.shareRoomLink();
  assert.deepEqual(r.clip, ['WEB_SHARE']);
  r = pagesApp();
  await r.app.shareLeaderboard();
  assert.equal(r.clip.length, 1);
  assert.deepEqual(r.app.__calls.toasts, ['Leaderboard copied!']);
});

test('triggerHaptic: Haptics plugin impact in the shell; Vibration API still wins on Android', () => {
  const impacts = [];
  const { app } = pagesApp({ haptics: { impact: async o => { impacts.push(o); } } });
  app.triggerHaptic();
  assert.deepEqual(impacts, [{ style: 'MEDIUM' }]);
  const vib = [];
  setNavigator({ vibrate: ms => vib.push(ms) });
  app.window = { addEventListener() {} };
  app.triggerHaptic();
  assert.deepEqual(vib, [50]);
  assert.equal(impacts.length, 1);
});
