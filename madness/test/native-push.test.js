const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/*
 * Native push inside the Capacitor shell (js/30-state.js). 30-state.js initialises Firebase at top
 * level, so two slices are evaluated in their own context: the FCM block (`let _fcmRegistered` up to
 * the Badge API section) and the notification-prompt block (up to `let roomId`). The Capacitor
 * PushNotifications plugin is a fake that records calls and lets a test fire its events.
 */
function slice(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  assert.ok(a > 0 && b > a, 'could not locate ' + startMarker + ' .. ' + endMarker + ' in 30-state.js');
  return src.slice(a, b);
}

function fakePlugin(receive) {
  const plugin = {
    calls: [],
    listeners: {},
    perm: receive,
    addListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return { remove() {} }; },
    async checkPermissions() { this.calls.push('check'); return { receive: this.perm }; },
    async requestPermissions() { this.calls.push('request'); this.perm = this.perm === 'denied' ? 'denied' : 'granted'; return { receive: this.perm }; },
    async register() { this.calls.push('register'); },
    async removeAllDeliveredNotifications() { this.calls.push('clear'); },
    fire(name, payload) { for (const fn of this.listeners[name] || []) fn(payload); }
  };
  return plugin;
}

function sandbox({ native = true, receive = 'prompt', plugin: withPlugin = true } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '30-state.js'), 'utf8');
  const code = slice(src, 'let _fcmRegistered', '/* ── Badge API ── */') +
               slice(src, '/* ── Notification Permission Prompt ── */', 'let roomId = null;');
  const plugin = withPlugin ? fakePlugin(receive) : null;
  const writes = [], toasts = [], banners = [], navs = [];
  const ctx = {
    console: { warn() {} },
    window: { Capacitor: plugin ? { Plugins: { PushNotifications: plugin } } : undefined, location: { pathname: '/index.html', href: '' } },
    isNativeShell: native,
    Notification: undefined,
    navigator: { userAgent: 'iPhone' },
    document: {
      visibilityState: 'visible',
      addEventListener() {},
      querySelector(sel) { return sel === '.content-scroll' ? { prepend(b) { banners.push(b); } } : (sel.includes('.notif-banner') && banners.length ? banners[0] : null); },
      createElement() { return { className: '', innerHTML: '' }; }
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    firebase: { firestore: { FieldValue: { arrayUnion: v => ['union', v], serverTimestamp: () => 'SERVER_TS' } } },
    db: { collection: () => ({ doc: () => ({ collection: () => ({ doc: id => ({ set(data) { writes.push({ id, data }); return Promise.resolve(); } }) }) }) }) },
    roomId: 'ROOM1',
    getMyPlayerId: () => 'p1',
    showToast: m => toasts.push(m),
    navigate: p => { navs.push(p); ctx.S.phase = p; },
    S: { phase: 'draft' },
    URLSearchParams
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: '30-state.js#native-push' });
  const settle = () => new Promise(r => setImmediate(r));
  return { ctx, plugin, writes, toasts, banners, navs, settle, run: expr => vm.runInContext(expr, ctx) };
}

test('without the Capacitor plugin (plain web) initNativePush is a no-op and writes nothing', async () => {
  const { run, writes } = sandbox({ native: false, plugin: false });
  assert.equal(await run('initNativePush({ prompt: true })'), false);
  assert.equal(writes.length, 0);
});

test('permission already granted: registers once, the registration event writes the FCM token to the shared fcmTokens doc', async () => {
  const { run, plugin, writes, settle } = sandbox({ receive: 'granted' });
  assert.equal(await run('initNativePush({ prompt: false })'), true);
  assert.equal(await run('initNativePush({ prompt: false })'), true);
  assert.deepEqual(plugin.calls, ['check', 'register', 'clear']); // one register across repeated calls, no permission prompt
  plugin.fire('registration', { value: 'fcm-native-1' });
  plugin.fire('registration', { value: 'fcm-native-1' });
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, 'p1');
  assert.equal(JSON.stringify(writes[0].data), JSON.stringify({ tokens: ['union', 'fcm-native-1'], updatedAt: 'SERVER_TS' })); // same shape as the web token write
});

test('a cached native token follows the person into another room or seat', async () => {
  const { run, ctx, plugin, writes } = sandbox({ receive: 'granted' });
  await run('initNativePush({ prompt: false })');
  plugin.fire('registration', { value: 'fcm-native-1' });
  ctx.roomId = 'ROOM2'; await run('initNativePush({ prompt: false })');
  ctx.getMyPlayerId = () => 'p2'; await run('initNativePush({ prompt: false })');
  await run('initNativePush({ prompt: false })');
  assert.equal(JSON.stringify(writes.map(w => w.id)), JSON.stringify(['p1', 'p1', 'p2'])); // ROOM1/p1, ROOM2/p1, ROOM2/p2; the repeat call writes nothing
});

test('prompt not yet answered: the banner appears after the permission check and prompt:false never asks iOS', async () => {
  const { run, plugin, banners, settle } = sandbox({ receive: 'prompt' });
  run('showNotificationPrompt()');
  assert.equal(banners.length, 0); // first call only checks
  await settle(); await settle();
  assert.equal(banners.length, 1);
  run('showNotificationPrompt()'); // every render: still one banner, still no register / request
  assert.equal(banners.length, 1);
  assert.deepEqual(plugin.calls, ['check']);
});

test('Enable: requestNotificationPermission asks iOS, registers and confirms with a toast', async () => {
  const { run, plugin, toasts } = sandbox({ receive: 'prompt' });
  await run('requestNotificationPermission()');
  assert.deepEqual(plugin.calls, ['check', 'request', 'register', 'clear']);
  assert.deepEqual(toasts, ['Notifications enabled!']);
});

test('denied: no register, a toast points at Settings, and no banner is shown on later renders', async () => {
  const { run, plugin, toasts, banners, settle } = sandbox({ receive: 'denied' });
  await run('requestNotificationPermission()');
  assert.ok(!plugin.calls.includes('register'));
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /Settings/);
  run('showNotificationPrompt()'); await settle();
  assert.equal(banners.length, 0);
});

test('foreground notification becomes a toast; a tap switches tab in the same room or reloads into another', async () => {
  const { run, ctx, plugin, toasts, navs } = sandbox({ receive: 'granted' });
  await run('initNativePush({ prompt: false })');
  plugin.fire('pushNotificationReceived', { title: "You're on the clock!", body: 'Pick #3', data: {} });
  plugin.fire('pushNotificationReceived', { data: { title: 'Final', body: 'Duke 71, UNC 70' } });
  assert.deepEqual(toasts, ["You're on the clock!: Pick #3", 'Final: Duke 71, UNC 70']);
  plugin.fire('pushNotificationActionPerformed', { notification: { data: { url: '/madness/?room=ROOM1&tab=live' } } });
  assert.deepEqual(navs, ['live']);
  plugin.fire('pushNotificationActionPerformed', { notification: { data: { url: '/madness/?room=ROOM1&tab=live' } } });
  assert.deepEqual(navs, ['live']); // already there
  plugin.fire('pushNotificationActionPerformed', { notification: { data: { url: '/madness/?room=other9&tab=leaderboard' } } });
  assert.equal(ctx.window.location.href, '/index.html?room=OTHER9&tab=leaderboard');
  plugin.fire('pushNotificationActionPerformed', { notification: { data: {} } }); // nothing to open
});

test('web path untouched: with isNativeShell false showNotificationPrompt never touches the plugin', () => {
  const { run, plugin, banners } = sandbox({ native: false, receive: 'prompt' });
  run('showNotificationPrompt()'); // no window.Notification in this context -> returns at the web guard
  assert.deepEqual(plugin.calls, []);
  assert.equal(banners.length, 0);
});

test('source: 60-rooms.js and 90-boot.js are not part of this change (hook rides showNotificationPrompt)', () => {
  const rooms = fs.readFileSync(path.join(__dirname, '..', 'js', '60-rooms.js'), 'utf8');
  const boot = fs.readFileSync(path.join(__dirname, '..', 'js', '90-boot.js'), 'utf8');
  assert.ok(!/initNativePush|nativePushPlugin/.test(rooms + boot));
});
