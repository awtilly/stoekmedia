let S = {
  phase: "draft",
  year: new Date().getFullYear(),
  players: [],
  teams: [],
  ds: {order:[], cp:0, started:false, complete:false},
  rp: {1:1, 2:2, 3:4, 4:8, 5:16, 6:32},
  ub: true,
  bracket: {
    South: Array(15).fill(null),
    East: Array(15).fill(null),
    Midwest: Array(15).fill(null),
    West: Array(15).fill(null),
    ff: Array(3).fill(null)
  },
  bracketRegion: "South",
  fr: "All",
  fs: "All",
  liveScoresDate: '',
  liveScoresFilter: 'all'
};

/* ── Firebase Setup ── */
const firebaseConfig = {
  apiKey: "AIzaSyCv2XLxjpR5S5nfa0tlkwYqoPaXzbtULXI",
  authDomain: "march-madness-snake-draft.firebaseapp.com",
  projectId: "march-madness-snake-draft",
  storageBucket: "march-madness-snake-draft.firebasestorage.app",
  messagingSenderId: "564071043666",
  appId: "1:564071043666:web:e4ace7ca3e9966cdebc58b"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if(err.code === 'failed-precondition'){
    console.warn('Firestore persistence failed: multiple tabs open');
  } else if(err.code === 'unimplemented'){
    console.warn('Firestore persistence not supported in this browser');
  }
});

/* ── FCM Push Notifications ── */
const VAPID_KEY = 'BEXX7JkBZweOVvbMXeHVasxvxILeP44a0BOkf0FX9hRTudpCodwj9hBIby4KtmC1XJoZ966oGrd8Rvm6dghN_bM';

// "room/player/token" already written this session. _applyRoomSnapshot() calls initFCM() on every
// snapshot, and the token doc write below carries a serverTimestamp, so without this every room
// change cost one Firestore write per connected client with notifications on.
let _fcmRegistered = null;

/* Record one push token under rooms/{room}/fcmTokens/{player} (web and native tokens share the doc:
 * functions/index.js sends to every token in it). Dedupes on room/player/token for the session. */
function writeFcmToken(token){
  if (!token || !roomId) return false;
  const myId = getMyPlayerId();
  const key = roomId + '/' + myId + '/' + token;
  if (!myId || _fcmRegistered === key) return false;
  _fcmRegistered = key;
  db.collection('rooms').doc(roomId).collection('fcmTokens').doc(myId).set({
    tokens: firebase.firestore.FieldValue.arrayUnion(token),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(err => { _fcmRegistered = null; console.warn('FCM token write failed:', err); });
  return true;
}

async function initFCM(){
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // Inside the Capacitor shell push rides the native Firebase Messaging plugin (docs/ios-app-store-plan.md
    // section 4): no service worker is registered there, so navigator.serviceWorker.ready would never resolve
    // and the await below would hang (and requestNotificationPermission's toast would never show).
    if (typeof isNativeShell !== 'undefined' && isNativeShell) return;
    const messaging = firebase.messaging();
    const swReg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    writeFcmToken(token);
  } catch(err) {
    console.warn('FCM init failed:', err);
  }
}

try {
  if ('Notification' in window) {
    firebase.messaging().onMessage((payload) => {
      const data = payload.data || {};
      const title = data.title || 'March Madness Draft';
      const body = data.body || '';
      showToast(title + ': ' + body);
    });
  }
} catch(e) {
  console.warn('FCM onMessage setup failed:', e);
}

/* ── Native push (Capacitor shell) ──
 * WKWebView has neither window.Notification nor a service worker, so none of the web-push code above
 * runs inside the iOS app. The Capacitor PushNotifications plugin takes its place. The app's
 * AppDelegate (ios-app/ios/App/App/AppDelegate.swift) hands the FCM registration token to the plugin,
 * so the plugin's 'registration' event carries an FCM token: it goes into the same fcmTokens document
 * as a web token and functions/index.js needs no change to reach the phone. */
let _nativePushPerm = null;        // last checkPermissions().receive: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'
let _nativePushRegistered = false;
let _nativePushListening = false;
let _nativePushPending = null;
let _nativeToken = null;

function nativePushPlugin(){
  const C = typeof window !== 'undefined' && window.Capacitor;
  return (C && C.Plugins && C.Plugins.PushNotifications) || null;
}

function attachNativePushListeners(push){
  if (_nativePushListening) return;
  _nativePushListening = true;
  push.addListener('registration', t => {
    _nativeToken = (t && t.value) || null;
    writeFcmToken(_nativeToken);
  });
  push.addListener('registrationError', e => console.warn('Native push registration failed:', (e && e.error) || e));
  // App in the foreground: iOS shows nothing itself, so surface it the way the web onMessage handler does.
  push.addListener('pushNotificationReceived', n => {
    const d = (n && n.data) || {};
    const title = (n && n.title) || d.title || '';
    const body = (n && n.body) || d.body || '';
    if (title || body) showToast(title && body ? title + ': ' + body : (title || body));
  });
  // The person tapped the notification (app in background or closed).
  push.addListener('pushNotificationActionPerformed', a => {
    const d = (a && a.notification && a.notification.data) || {};
    openPushTarget(d.url);
  });
}

/* functions/index.js sends data.url like "/madness/?room=CODE&tab=live". Inside the shell the app is served
 * from its own origin, so only the query string is used: same room -> switch tab, other room -> reload into it. */
function openPushTarget(url){
  if (!url) return;
  const str = String(url);
  const q = str.indexOf('?');
  if (q < 0) return;
  const p = new URLSearchParams(str.slice(q));
  const room = (p.get('room') || '').toUpperCase();
  const tab = p.get('tab');
  if (room && room !== roomId) { p.set('room', room); window.location.href = window.location.pathname + '?' + p.toString(); return; }
  if (tab && ['live', 'bracket', 'leaderboard', 'draft'].includes(tab) && S.phase !== tab) navigate(tab);
}

/* Called on every render with a room + claimed player (showNotificationPrompt) and from the Enable button.
 * prompt:false never asks iOS for permission; it only registers when permission was already granted and
 * keeps the token document current for the room/player in use. Resolves true when push is active. */
async function initNativePush(opts){
  const push = nativePushPlugin();
  if (!push) return false;
  attachNativePushListeners(push);
  writeFcmToken(_nativeToken); // room or player may have changed since the token arrived
  const prompt = !!(opts && opts.prompt);
  if (_nativePushRegistered && !prompt) return true;
  if (_nativePushPending) return _nativePushPending;
  _nativePushPending = (async () => {
    let perm = await push.checkPermissions();
    if (perm.receive !== 'granted' && prompt) perm = await push.requestPermissions();
    _nativePushPerm = perm.receive;
    if (perm.receive !== 'granted') return false;
    if (!_nativePushRegistered) {
      await push.register();
      _nativePushRegistered = true;
      clearDeliveredNotifications();
    }
    return true;
  })();
  try { return await _nativePushPending; } finally { _nativePushPending = null; }
}

// navigator.setAppBadge does not exist in WKWebView; at least clear the notification list when the app is in front.
function clearDeliveredNotifications(){
  const push = nativePushPlugin();
  if (push && _nativePushRegistered && push.removeAllDeliveredNotifications) push.removeAllDeliveredNotifications().catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') clearDeliveredNotifications(); });

/* ── Badge API ── */
function updateAppBadge(){
  if (!navigator.setAppBadge) return;
  const myId = getMyPlayerId();
  const ds = S.ds;
  if (ds && ds.started && !ds.complete && myId === ds.order[ds.cp]){
    navigator.setAppBadge(1).catch(() => {});
  } else {
    navigator.clearAppBadge().catch(() => {});
  }
}

/* ── Notification Permission Prompt ── */
function showNotificationPrompt(){
  if (typeof isNativeShell !== 'undefined' && isNativeShell) { showNativePushPrompt(); return; }
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('mm4_notif_dismissed')) return;
  if (document.querySelector('.notif-banner, .notif-overlay')) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  if (isIOS && !isStandalone){
    const overlay = document.createElement('div');
    overlay.className = 'notif-overlay';
    overlay.innerHTML = `<div class="notif-overlay-card">
      <h3>Enable Notifications</h3>
      <p>To receive notifications, first add this app to your Home Screen using the Share button, then open it from there.</p>
      <button onclick="this.closest('.notif-overlay').remove(); localStorage.setItem('mm4_notif_dismissed','1');">Got it</button>
    </div>`;
    document.body.appendChild(overlay);
    return;
  }

  appendNotificationBanner();
}

function appendNotificationBanner(){
  const scroll = document.querySelector('.content-scroll');
  if(!scroll) return;
  const banner = document.createElement('div');
  banner.className = 'notif-banner';
  banner.innerHTML = `<div class="notif-banner-text">Get notified when it's your turn to draft?</div>
    <div class="notif-banner-actions">
      <button class="notif-btn-enable" onclick="requestNotificationPermission(); this.closest('.notif-banner').remove();">Enable</button>
      <button class="notif-btn-dismiss" onclick="localStorage.setItem('mm4_notif_dismissed','1'); this.closest('.notif-banner').remove();">Not now</button>
    </div>`;
  scroll.prepend(banner);
}

/* Capacitor shell: the iOS permission state replaces Notification.permission. The first call only asks the
 * plugin where things stand; the banner appears once that says 'prompt'. Granted keeps the token doc current. */
function showNativePushPrompt(){
  if (localStorage.getItem('mm4_notif_dismissed')) return;
  if (_nativePushPerm === null) {
    initNativePush({ prompt: false }).then(() => { if (_nativePushPerm !== null && _nativePushPerm !== 'granted' && _nativePushPerm !== 'denied') showNativePushPrompt(); }).catch(() => {});
    return;
  }
  if (_nativePushPerm === 'granted') { initNativePush({ prompt: false }).catch(() => {}); return; }
  if (_nativePushPerm === 'denied') return;
  if (document.querySelector('.notif-banner, .notif-overlay')) return;
  appendNotificationBanner();
}

async function requestNotificationPermission(){
  if (typeof isNativeShell !== 'undefined' && isNativeShell) {
    const ok = await initNativePush({ prompt: true }).catch(() => false);
    showToast(ok ? 'Notifications enabled!' : 'Notifications blocked. You can enable them in Settings.');
    return;
  }
  const result = await Notification.requestPermission();
  if (result === 'granted'){
    await initFCM();
    showToast('Notifications enabled!');
    updateAppBadge();
  } else if (result === 'denied'){
    showToast('Notifications blocked. You can enable them in browser settings.');
  }
}

let roomId = null;
let _roomGeneration = 0;
let unsubRoom = null;
let isOnline = navigator.onLine;

window.addEventListener('online', () => { isOnline = true; render(); showToast('Back online'); });
window.addEventListener('offline', () => { isOnline = false; render(); showToast('You are offline'); });

// Warm up AudioContext on first user interaction (required for autoplay policy)
document.addEventListener('click', function _warmup(){
  warmupAudio();
  document.removeEventListener('click', _warmup);
}, { once: true });

