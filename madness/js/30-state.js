function defaultState(){ return {
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
}; }
let S = defaultState();

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
    if (token && roomId) {
      const myId = getMyPlayerId();
      const key = roomId + '/' + myId + '/' + token;
      if (myId && _fcmRegistered !== key) {
        _fcmRegistered = key;
        db.collection('rooms').doc(roomId).collection('fcmTokens').doc(myId).set({
          tokens: firebase.firestore.FieldValue.arrayUnion(token),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => { _fcmRegistered = null; console.warn('FCM token write failed:', err); });
      }
    }
  } catch(err) {
    console.warn('FCM init failed:', err);
  }
}

try {
  if ('Notification' in window) {
    firebase.messaging().onMessage((payload) => {
      const data = payload.data || {};
      const title = data.title || APP_NAME;
      const body = data.body || '';
      showToast(title + ': ' + body);
    });
  }
} catch(e) {
  console.warn('FCM onMessage setup failed:', e);
}

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
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('mm4_notif_dismissed')) return;
  if (document.querySelector('.notif-banner, .notif-overlay')) return;

  const isIOS = isIOSDevice();
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

async function requestNotificationPermission(){
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

