# Architecture Patterns

**Domain:** PWA enhancement of a single-file vanilla JS March Madness draft app
**Researched:** 2026-03-11

## Existing Architecture Summary

The app is a single-file SPA (`index.html`, ~3,500 lines) with a clear, simple pattern:

```
Global State (S) --> render() --> DOM (template literals) --> User Events --> mutate S --> render()
                       |
                   saveState() --> localStorage + debounced Firestore write
                       |
                 connectToRoom() --> onSnapshot listener --> merge remote into S --> render()
```

**Key architectural facts from the codebase:**

| Element | Implementation | Location |
|---------|---------------|----------|
| State | Global `let S = {...}` object | Line 2053 |
| Render | Single `render()` dispatches to `renderSetup`, `renderDraft`, etc. | Line 2754 |
| Persistence | `saveState()` writes to localStorage + debounced Firestore (800ms) | Line 2319 |
| Remote sync | `connectToRoom()` attaches `onSnapshot` listener, merges remote into S | Line 2370 |
| Local-only keys | `VIEW_LOCAL` array: phase, bracketRegion, filters | Line 2300 |
| Service worker | `sw.js` -- cache-first for static assets, pass-through for Firestore | Separate file |
| Firebase SDK | Compat (v8-style) loaded via CDN, no npm | Lines 2076-2085 |
| Player identity | Passphrase stored in `localStorage('mm4_me_' + roomId)` | Line 2258 |
| Draft state | `S.ds = {order:[], cp:0, started, complete}` -- cp is current pick index | Line 2058 |

**The `isRemoteUpdate` guard** (line 2096) prevents Firestore write loops: when receiving a remote snapshot, the flag blocks `saveState()` from writing back.

---

## Recommended Architecture for New Features

The new features split into three integration categories:

1. **Client-only APIs** -- Vibration, Web Share, Wake Lock, Badge (touch the main thread only)
2. **Client + State** -- Draft Clock (adds state to S, hooks into render loop, syncs via Firestore)
3. **Client + Service Worker + Cloud** -- Push Notifications (requires FCM setup, service worker modifications, Cloud Functions backend)

### Component Boundary Diagram

```
+------------------------------------------------------------------+
|                        index.html (main thread)                   |
|                                                                   |
|  +------------------+  +-----------------+  +------------------+  |
|  | Haptic Module    |  | Share Module    |  | Wake Lock Module |  |
|  | haptic(pattern)  |  | shareRoom()     |  | acquireWakeLock()|  |
|  | vibrate+fallback |  | shareResults()  |  | releaseWakeLock()|  |
|  +------------------+  +-----------------+  +------------------+  |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  | Draft Clock Module                                           | |
|  | S.ds.clock = {duration, remaining, running, lastTick, expAt} | |
|  | startClock() / pauseClock() / onClockExpiry()                | |
|  | Firestore-synced via existing saveState() flow               | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  | Push Permission Module                                       | |
|  | requestPushPermission() --> getToken() --> store FCM token   | |
|  | onMessage() handler for foreground notifications             | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  | Badge Module                                                 | |
|  | updateBadge() -- called from onSnapshot when it's your turn  | |
|  | clearBadge() -- called when you make a pick                  | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
          |                                            |
          | register('sw.js')                          | getToken({swReg})
          v                                            v
+------------------------------------------------------------------+
|                        sw.js (service worker)                     |
|                                                                   |
|  Existing: cache-first strategy, Firestore pass-through           |
|  NEW: importScripts firebase-app-compat, firebase-messaging-compat|
|  NEW: firebase.messaging().onBackgroundMessage() handler          |
|  NEW: self.addEventListener('notificationclick') handler          |
|  NEW: self.addEventListener('push') fallback handler              |
+------------------------------------------------------------------+
          |
          | FCM token registered with Firebase project
          v
+------------------------------------------------------------------+
|              Firebase Cloud Functions (server-side)                |
|                                                                   |
|  onDocumentUpdated('rooms/{roomId}')                              |
|    --> Compare before.ds.cp vs after.ds.cp                        |
|    --> Determine whose turn it is now                              |
|    --> Look up FCM token from /rooms/{roomId}/tokens/{playerId}   |
|    --> admin.messaging().send({ token, notification, data })      |
|                                                                   |
|  Optional future: onSchedule for game-final notifications         |
+------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Haptic Module | Wraps `navigator.vibrate()` with iOS feature detection and fallback | Called by `pickTeam()`, bracket actions, button handlers |
| Share Module | Wraps `navigator.share()` with clipboard fallback | Called by share buttons in UI |
| Wake Lock Module | Acquires/releases screen wake lock | Called by `navigate()` when entering/leaving Live Scores tab |
| Draft Clock Module | Manages countdown timer, auto-pick on expiry | Reads/writes `S.ds.clock`, calls `pickTeam()` on expiry, integrates with `render()` |
| Push Permission Module | Manages FCM token lifecycle | Writes token to Firestore subcollection, registers with service worker |
| Badge Module | Updates app icon badge count | Reads `S.ds` to determine if it is the current player's turn |
| Service Worker (sw.js) | Caching + FCM background message handling | Receives push events, shows notifications, handles notification clicks |
| Cloud Functions | Server-side push trigger logic | Reads Firestore room state changes, sends FCM messages |

---

## Data Flow: How Each Feature Hooks into the Existing Architecture

### 1. Draft Clock -- Hooks into State Object S and render() Loop

**State addition to `S.ds`:**

```javascript
// Extend existing draft state
S.ds = {
  order: [],
  cp: 0,
  started: false,
  complete: false,
  // NEW clock fields:
  clockDuration: 90,      // seconds, configurable in setup
  clockExpAt: null,        // server timestamp when clock expires (null = paused)
  clockPaused: false       // admin can pause
};
```

**Why `clockExpAt` (absolute timestamp) instead of `clockRemaining` (countdown)?**
Multiple clients receive Firestore updates at different times. An absolute expiry timestamp lets every client independently compute the correct remaining time: `remaining = clockExpAt - Date.now()`. A relative "remaining seconds" value would drift between clients because of network latency in the `onSnapshot` delivery.

**Render integration:**

```javascript
// In renderDraft(), add clock display:
const remaining = S.ds.clockExpAt ? Math.max(0, Math.ceil((S.ds.clockExpAt - Date.now()) / 1000)) : S.ds.clockDuration;
// Display remaining seconds, color-code when < 10s

// Use requestAnimationFrame or setInterval(1000) to update clock display
// WITHOUT calling full render() -- just update the clock DOM element directly
let clockInterval = null;
function startClockDisplay() {
  clockInterval = setInterval(() => {
    const el = document.getElementById('draft-clock');
    if (!el || !S.ds.clockExpAt) return;
    const remaining = Math.max(0, Math.ceil((S.ds.clockExpAt - Date.now()) / 1000));
    el.textContent = remaining;
    if (remaining <= 0) onClockExpiry();
  }, 250); // 250ms for smooth countdown
}
```

**Critical: Clock display must NOT call `render()` every second.** The existing `render()` rebuilds the entire DOM via `innerHTML` template literals. Calling it 4x/second would cause flickering and input loss. Instead, use targeted DOM updates for the clock element only.

**Auto-pick on expiry:**

```javascript
async function onClockExpiry() {
  if (S.ds.complete || !S.ds.clockExpAt) return;
  S.ds.clockExpAt = null; // Stop clock

  // Auto-pick: highest seed available
  const all = S.players.flatMap(p => p.teamIds);
  const available = S.teams.filter(t => !all.includes(t.id)).sort((a, b) => a.seed - b.seed);
  if (available.length > 0) {
    const p = S.players.find(p => p.id === S.ds.order[S.ds.cp]);
    if (p) p.teamIds.push(available[0].id);
    S.ds.cp++;
    if (S.ds.cp >= S.ds.order.length) S.ds.complete = true;
    else S.ds.clockExpAt = Date.now() + (S.ds.clockDuration * 1000); // Start next clock
  }
  haptic('pick'); // Vibrate on auto-pick
  render();
}
```

**Who runs the auto-pick?** Every connected client runs the expiry check locally. The first client to detect expiry mutates `S` and triggers `saveState()`, which writes to Firestore. Other clients receive the `onSnapshot` update and see the pick already made. The `isRemoteUpdate` guard prevents re-writing. This is safe because the auto-pick is deterministic -- all clients would pick the same team (highest seed available).

**Firestore sync:** The clock state syncs through the existing `saveState()` debounced write. The 800ms debounce is acceptable because `clockExpAt` is an absolute timestamp that only changes on pick/start/pause events, not every second.

### 2. Haptic Feedback -- Pure Client-Side, No State Changes

```javascript
// Haptic utility function -- progressive enhancement
function haptic(type = 'light') {
  if (!('vibrate' in navigator)) return; // No-op on iOS Safari
  const patterns = {
    light: [10],
    medium: [25],
    pick: [15, 50, 15],    // Draft pick confirmation
    error: [50, 30, 50],   // Error feedback
    success: [10, 30, 10, 30, 10] // Bracket advance
  };
  try { navigator.vibrate(patterns[type] || patterns.light); } catch(e) {}
}
```

**Integration points (add calls to existing functions):**

| Function | Haptic Type | Why |
|----------|-------------|-----|
| `pickTeam()` | `'pick'` | Confirms draft selection |
| Bracket `advanceTeam()` / slot click | `'success'` | Confirms bracket advancement |
| `showToast()` (error variants) | `'error'` | Alerts to problems |
| Nav button clicks | `'light'` | Subtle tactile feedback |

**iOS limitation:** `navigator.vibrate()` is not supported in Safari (any version). This is a deliberate Apple decision, not a bug. The feature is Android-only for web. Feature detection via `'vibrate' in navigator` gracefully degrades. No workaround exists.

### 3. Web Share API -- Pure Client-Side, No State Changes

```javascript
async function shareRoom() {
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  const shareData = {
    title: 'March Madness Draft',
    text: `Join my March Madness draft room!`,
    url: url.toString()
  };

  if (navigator.share && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      haptic('success');
    } catch(e) {
      if (e.name !== 'AbortError') fallbackCopy(url.toString());
    }
  } else {
    fallbackCopy(url.toString());
  }
}

function fallbackCopy(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('Link copied!'))
    .catch(() => showToast('Link: ' + text));
}
```

**Replaces the existing `copyRoomLink()` function** (line 2810) which only does clipboard copy. The new version tries native share first, falls back to clipboard.

**Additional share targets:** Results/leaderboard sharing can use the same pattern with different `text`/`title` values.

**Requirement:** Must be called from a user gesture (click handler). Already satisfied since it is wired to button `onclick`.

### 4. Screen Wake Lock -- Pure Client-Side, Tied to Navigation

```javascript
let wakeLockSentinel = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
  } catch(e) {
    // Permission denied or not supported -- silent fail
  }
}

function releaseWakeLock() {
  if (wakeLockSentinel) {
    wakeLockSentinel.release();
    wakeLockSentinel = null;
  }
}
```

**Integration with `navigate()`:**

```javascript
function navigate(p) {
  if (S.phase === 'live' && p !== 'live') { stopLiveRefresh(); releaseWakeLock(); }
  S.phase = p;
  saveState();
  if (p === 'live') { startLiveRefresh(); acquireWakeLock(); }
  else render();
  // ... existing scroll/animation code
}
```

**Also acquire during active draft** when it is the current player's turn, to prevent screen dimming while the clock is running.

**Re-acquisition on visibility change:** The Wake Lock is automatically released when the page becomes hidden (tab switch, screen lock). Re-acquire it when the page becomes visible again:

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.phase === 'live') acquireWakeLock();
    if (S.phase === 'draft' && !S.ds.complete) acquireWakeLock();
  }
});
```

**Browser support:** Baseline Newly Available as of 2025-03-31 (iOS 18.4+, all Chromium, Firefox). Older iOS versions will silently fail via the try/catch.

### 5. App Badge -- Client-Side, Reads Draft State

```javascript
function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const myId = getMyPlayerId();
  if (!myId || !roomId) { navigator.clearAppBadge?.(); return; }

  const ds = S.ds;
  if (ds.started && !ds.complete && ds.order[ds.cp] === myId) {
    navigator.setAppBadge(1); // It's your turn
  } else {
    navigator.clearAppBadge?.();
  }
}
```

**Integration:** Call `updateBadge()` at the end of `render()` and inside the `onSnapshot` callback. This ensures the badge updates whenever the draft state changes, whether from local or remote actions.

**Requirement:** PWA must be installed. Badge API only works in installed PWAs. On non-installed browser tabs, the calls silently resolve (no error, no effect).

**Platform support:** Chrome/Edge on Windows/macOS, Safari on iOS 16.4+. Not supported in Firefox.

### 6. Push Notifications -- Full Stack: Client + Service Worker + Cloud Functions

This is the most architecturally significant change. It requires modifications across three layers.

#### Layer 1: Service Worker Modifications (sw.js)

The existing `sw.js` must be extended to handle FCM. Firebase's default approach expects a separate `firebase-messaging-sw.js`, but since the app already has `sw.js`, use the custom service worker approach.

**Modified sw.js structure:**

```javascript
// === EXISTING (keep as-is) ===
const CACHE_NAME = 'mm-draft-v4'; // Bump version
const STATIC_ASSETS = [/* existing list */];

// Install, activate, fetch handlers -- unchanged

// === NEW: Firebase Messaging in Service Worker ===
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCv2XLxjpR5S5nfa0tlkwYqoPaXzbtULXI",
  authDomain: "march-madness-snake-draft.firebaseapp.com",
  projectId: "march-madness-snake-draft",
  storageBucket: "march-madness-snake-draft.firebasestorage.app",
  messagingSenderId: "564071043666",
  appId: "1:564071043666:web:e4ace7ca3e9966cdebc58b"
});

const messaging = firebase.messaging();

// Handle notification clicks BEFORE onBackgroundMessage
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing tab if found
      for (const client of windowClients) {
        if (client.url.includes('/madness') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(urlToOpen);
    })
  );
});

// Handle background messages
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(title || 'March Madness Draft', {
    body: body || 'Something happened in your draft!',
    icon: icon || './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: data.url || './', roomId: data.roomId },
    tag: data.tag || 'mm-notification', // Collapse similar notifications
    renotify: true
  });
});
```

**Important ordering:** The `notificationclick` handler must be registered before `onBackgroundMessage` because FCM may overwrite custom click behavior otherwise.

#### Layer 2: Client-Side FCM Setup (in index.html)

```javascript
// Add to Firebase SDK imports at top of <script>
// <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js"></script>

let messagingInstance = null;

async function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    showToast('Push notifications not supported');
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    showToast('Notification permission denied');
    return null;
  }

  // Get the existing service worker registration
  const swReg = await navigator.serviceWorker.ready;
  messagingInstance = firebase.messaging();

  try {
    const token = await messagingInstance.getToken({
      vapidKey: 'YOUR_VAPID_KEY_HERE', // Generate in Firebase Console > Cloud Messaging
      serviceWorkerRegistration: swReg   // Use existing sw.js, NOT firebase-messaging-sw.js
    });

    if (token && roomId) {
      const myId = getMyPlayerId();
      if (myId) await storeFCMToken(token, myId);
    }
    return token;
  } catch(e) {
    console.warn('FCM token error:', e);
    showToast('Notification setup failed');
    return null;
  }
}

async function storeFCMToken(token, playerId) {
  // Store in a subcollection: rooms/{roomId}/tokens/{playerId}
  await db.collection('rooms').doc(roomId)
    .collection('tokens').doc(playerId)
    .set({ token, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
}

// Handle foreground messages (app is open and visible)
function setupForegroundMessaging() {
  if (!messagingInstance) return;
  messagingInstance.onMessage(payload => {
    // Show as in-app toast instead of OS notification (avoid duplicate)
    const body = payload.notification?.body || payload.data?.body || '';
    showToast(body);
    haptic('medium');
  });
}
```

**Firestore data model for tokens:**

```
rooms/{roomId}
  state: "..." (existing -- JSON blob of S)
  adminPin: "..." (existing)
  updatedAt: timestamp (existing)
  tokens/  <-- NEW subcollection
    {playerId}/
      token: "fcm-token-string"
      updatedAt: timestamp
```

Using a subcollection keeps token data separate from the room state (which is read by all clients). Tokens are write-only from the client perspective -- only Cloud Functions need to read them.

**Firestore rules addition needed:**

```
match /rooms/{roomId}/tokens/{tokenId} {
  allow write: if true;  // Any player can store their token
  allow read: if false;   // Only Cloud Functions (admin SDK) reads tokens
}
```

#### Layer 3: Firebase Cloud Functions (Server-Side)

**New project structure needed:**

```
madness/
  index.html
  sw.js
  manifest.json
  firestore.rules
  functions/        <-- NEW
    package.json
    index.js
  firebase.json     <-- NEW (or update existing)
```

**Cloud Functions code (functions/index.js):**

```javascript
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

exports.onDraftPick = onDocumentUpdated('rooms/{roomId}', async (event) => {
  const before = JSON.parse(event.data.before.data().state || '{}');
  const after = JSON.parse(event.data.after.data().state || '{}');

  // Only fire on draft pick advancement
  if (!after.ds?.started || after.ds?.complete) return;
  if (before.ds?.cp === after.ds?.cp) return; // No pick change

  const currentPlayerId = after.ds.order[after.ds.cp];
  if (!currentPlayerId) return;

  const currentPlayer = after.players.find(p => p.id === currentPlayerId);
  if (!currentPlayer) return;

  // Get FCM token for the player whose turn it is
  const roomId = event.params.roomId;
  const tokenDoc = await getFirestore()
    .collection('rooms').doc(roomId)
    .collection('tokens').doc(currentPlayerId)
    .get();

  if (!tokenDoc.exists) return;
  const fcmToken = tokenDoc.data().token;

  // Determine what was just picked (for the notification body)
  const previousPlayerId = after.ds.order[after.ds.cp - 1];
  const previousPlayer = after.players.find(p => p.id === previousPlayerId);
  const lastPickedTeamId = previousPlayer?.teamIds?.[previousPlayer.teamIds.length - 1];
  const lastPickedTeam = after.teams.find(t => t.id === lastPickedTeamId);

  const body = lastPickedTeam
    ? `${previousPlayer.name} picked ${lastPickedTeam.name}. Your turn!`
    : `It's your turn to pick, ${currentPlayer.name}!`;

  try {
    await getMessaging().send({
      token: fcmToken,
      notification: {
        title: 'Your Turn to Draft!',
        body: body
      },
      data: {
        roomId: roomId,
        type: 'draft_turn',
        tag: 'draft-turn-' + roomId,
        url: `./index.html?room=${roomId}`
      },
      webpush: {
        fcmOptions: { link: `https://stoekmedia.com/madness/?room=${roomId}` }
      }
    });
  } catch(e) {
    // Token may be stale -- clean up
    if (e.code === 'messaging/registration-token-not-registered') {
      await getFirestore().collection('rooms').doc(roomId)
        .collection('tokens').doc(currentPlayerId).delete();
    }
    console.error('FCM send error:', e);
  }
});
```

**Blaze plan required:** Cloud Functions deployment requires the Firebase Blaze (pay-as-you-go) plan. At 10-20 concurrent rooms during the tournament, costs will be well within the free tier (2M invocations/month free). The project ID `march-madness-snake-draft` needs to be on Blaze.

---

## Manifest Enhancements

The current `manifest.json` needs several additions:

```json
{
  "name": "March Madness Draft",
  "short_name": "MM Draft",
  "description": "March Madness bracket pool with snake draft",
  "start_url": ".",
  "display": "standalone",
  "display_override": ["standalone", "minimal-ui"],
  "background_color": "#ffffff",
  "theme_color": "#C5991A",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    {
      "name": "Live Scores",
      "short_name": "Scores",
      "url": "./?tab=live",
      "icons": [{ "src": "icons/shortcut-scores.png", "sizes": "96x96" }]
    },
    {
      "name": "Bracket",
      "short_name": "Bracket",
      "url": "./?tab=bracket",
      "icons": [{ "src": "icons/shortcut-bracket.png", "sizes": "96x96" }]
    },
    {
      "name": "Leaderboard",
      "short_name": "Leaders",
      "url": "./?tab=leaderboard",
      "icons": [{ "src": "icons/shortcut-leaderboard.png", "sizes": "96x96" }]
    }
  ]
}
```

**App shortcuts** require URL-based navigation. The existing app uses `navigate()` which sets `S.phase`. On page load, the app needs to check URL params for `?tab=` and navigate accordingly. This is a small addition to the init code.

---

## Build Order (Dependency Graph)

Features have clear dependency relationships:

```
Phase 1: Foundation (no dependencies)
  Haptic feedback ---------> standalone, no state changes
  Web Share API -----------> standalone, replaces copyRoomLink()
  Wake Lock API -----------> standalone, hooks into navigate()
  Manifest enhancements ---> standalone, JSON changes

Phase 2: Draft Clock (depends on: nothing new, but benefits from haptic)
  Draft clock state -------> extends S.ds, needs targeted DOM updates
  Clock display -----------> render integration, setInterval for countdown
  Auto-pick logic ---------> deterministic, all clients converge
  Clock in renderDraft() --> UI additions

Phase 3: Push Infrastructure (depends on: Blaze plan upgrade)
  Service worker FCM ------> modify sw.js with importScripts + handlers
  Client FCM setup --------> add messaging SDK, token management
  FCM token storage -------> new Firestore subcollection + rules
  Cloud Functions ---------> new functions/ directory, Blaze plan required
  App badge ---------------> simple, but most valuable after push is working
```

**Why this order:**

1. **Phase 1 features are zero-risk.** They are pure progressive enhancement with feature detection. No state changes, no backend, no build step. They can ship immediately.

2. **Draft Clock is the highest-value feature** for the tournament but carries moderate risk (clock sync across clients, auto-pick edge cases). It should be built and tested before the draft happens. It only touches the client side and the existing Firestore sync.

3. **Push Notifications are the highest-complexity feature.** They require a new backend (Cloud Functions), a billing change (Blaze plan), service worker modifications (which can break caching if done wrong), and cross-browser testing for iOS PWA push (only works when installed). This should be built last, and can be deferred if the timeline is too tight -- the badge and push features provide value over weeks (during games), not during the draft itself.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Calling render() for Clock Updates
**What:** Using the existing `render()` to update the countdown display every second.
**Why bad:** `render()` rebuilds the entire DOM via `innerHTML`. At 1Hz+ this causes: input field loss, scroll position reset, visible flicker, and poor performance on mobile.
**Instead:** Use targeted DOM updates via `document.getElementById('draft-clock').textContent = remaining`. Only call full `render()` on actual state changes (pick made, clock expired).

### Anti-Pattern 2: Separate firebase-messaging-sw.js
**What:** Creating a second service worker file for Firebase messaging.
**Why bad:** A scope can only have one active service worker. Two workers would conflict, and the Firebase-registered one would override the existing caching worker.
**Instead:** Extend the existing `sw.js` with `importScripts` for Firebase SDK and messaging handlers. Pass the existing registration to `getToken()`.

### Anti-Pattern 3: Storing FCM Tokens in the Room State Object
**What:** Adding FCM tokens to the `S` state object that syncs to Firestore.
**Why bad:** Every client receives every `onSnapshot` update. Tokens are sensitive identifiers and should not be broadcast to all room participants. It also bloats the state JSON.
**Instead:** Use a Firestore subcollection `rooms/{roomId}/tokens/{playerId}` that is write-only from clients and read-only from Cloud Functions (admin SDK).

### Anti-Pattern 4: Using setInterval for Firestore-Synced Clock
**What:** Running a `setInterval` that decrements a `remaining` counter and syncs to Firestore.
**Why bad:** Each client would decrement at slightly different rates, causing state conflicts. The 800ms debounce would create a flood of writes. Clients would fight over the "correct" remaining value.
**Instead:** Store an absolute `clockExpAt` timestamp. Each client computes remaining locally. Only write to Firestore on actual events (start, pause, pick, expiry).

### Anti-Pattern 5: Cloud Function Writing Back to Room State
**What:** Having the Cloud Function modify the room's `state` field (e.g., to mark a notification as sent).
**Why bad:** The `onDocumentUpdated` trigger would fire again, creating an infinite loop. The room state is owned by the clients.
**Instead:** Cloud Functions should be read-only on the room state. If tracking notification-sent status is needed, write to a separate subcollection or field outside `state`.

---

## Scalability Considerations

| Concern | 10-20 rooms (current) | 100+ rooms (future) | Notes |
|---------|----------------------|---------------------|-------|
| Clock accuracy | Sub-second via local interval | Same | No server dependency for display |
| Firestore writes | ~1 write/pick (debounced) | Same per room | Well within free tier |
| Cloud Function invocations | ~1 per pick per room | Linear scale | Free tier: 2M/month |
| FCM messages | ~1 per pick per room | Linear scale | FCM is free, no per-message cost |
| Service worker cache | ~5 assets cached | Same | Cache size is fixed |
| Token cleanup | Minimal stale tokens | May need periodic cleanup | Handle `token-not-registered` errors |

---

## Cross-Browser Compatibility Matrix

| Feature | Chrome Android | Safari iOS (installed PWA) | Desktop Chrome | Notes |
|---------|---------------|---------------------------|----------------|-------|
| Vibration API | YES | NO (never) | YES (laptops rarely have motors) | Feature detect, Android-only in practice |
| Web Share API | YES | YES | YES (macOS 12+) | Clipboard fallback for unsupported |
| Wake Lock | YES | YES (iOS 18.4+) | YES | Silent fail on older iOS |
| App Badge | YES | YES (iOS 16.4+) | YES (Windows, macOS) | Requires installed PWA |
| Push Notifications | YES | YES (iOS 16.4+, installed only) | YES | iOS requires PWA installation |
| Service Worker | YES | YES | YES | Already working |

**The iOS "installed only" constraint** for push and badge is significant. The app already has an install banner (`showInstallBanner()`). For push to be useful, users must install the PWA. Consider showing a prompt explaining why installation matters when push is requested.

---

## Sources

- [Firebase Cloud Messaging Web Setup](https://firebase.google.com/docs/cloud-messaging/web/get-started) -- official docs, HIGH confidence
- [FCM Receive Messages / Custom Service Worker](https://firebase.google.com/docs/cloud-messaging/web/receive-messages) -- official docs on getToken with serviceWorkerRegistration, HIGH confidence
- [Cloud Functions v2 Firestore Triggers](https://firebase.google.com/docs/functions/firestore-events) -- onDocumentUpdated syntax, HIGH confidence
- [Badging API / setAppBadge (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge) -- HIGH confidence
- [Screen Wake Lock API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) -- HIGH confidence
- [Wake Lock Baseline Status](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers) -- Baseline Newly Available 2025-03-31, HIGH confidence
- [Web Share API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share) -- HIGH confidence
- [Vibration API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API) -- confirms no Safari support, HIGH confidence
- [PWA Push Notifications on iOS](https://brainhub.eu/library/pwa-on-ios) -- iOS 16.4+ with installation requirement, MEDIUM confidence
- [Firebase Pricing / Blaze Plan](https://firebase.google.com/pricing) -- Cloud Functions requires Blaze, free tier generous, HIGH confidence
- [Complete Guide: Push Notifications in PWA with FCM](https://blog.coffeeinc.in/complete-guide-push-notifications-in-pwa-with-firebase-cloud-messaging-a515965372f7) -- Jan 2026 guide, MEDIUM confidence
