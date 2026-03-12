# Technology Stack: PWA Enhancement APIs

**Project:** March Madness Snake Draft -- PWA Native Features
**Researched:** 2026-03-11
**Overall Confidence:** HIGH (all APIs are standardized W3C/WHATWG specs with official documentation)

---

## Recommended Stack

This document covers the APIs, libraries, and configuration needed to add native-feeling PWA capabilities to the existing vanilla JS app. It does NOT re-cover the existing stack (Firebase Firestore, ESPN API, vanilla JS, GitHub Pages).

### Existing Foundation (Relevant Context)

| Asset | Current State | Implication for PWA Features |
|-------|---------------|------------------------------|
| `sw.js` | Cache-first service worker at `/madness/sw.js` | Must be extended (not replaced) for push notification handling |
| `manifest.json` | Basic manifest with `"display": "standalone"` | Must be extended with `shortcuts`, `display_override`, and potentially `id` |
| Firebase SDK | v10.8.0 compat via CDN (`firebase-app-compat.js`, `firebase-firestore-compat.js`) | FCM messaging compat SDK must match this version pattern |
| Hosting | GitHub Pages at `stoekmedia.com/madness` (subdirectory) | Service worker scope is `/madness/` -- FCM requires custom SW registration path |

---

## PWA API Reference: Per-Feature Breakdown

### 1. Vibration API (`navigator.vibrate()`)

**Purpose:** Haptic feedback on draft picks, bracket actions, timer warnings
**Confidence:** HIGH

| Browser | Support | Version |
|---------|---------|---------|
| Chrome Android | YES | 30+ |
| Desktop Chrome | YES (no hardware vibrator, no-ops silently) | 30+ |
| iOS Safari | **NO -- never supported, no roadmap** | None |
| Firefox | **NO -- removed in v129** | Removed |

**API surface:**
```javascript
// Single vibration (ms)
navigator.vibrate(200);

// Pattern: [vibrate, pause, vibrate, pause, ...]
navigator.vibrate([100, 50, 100]);

// Cancel vibration
navigator.vibrate(0);
```

**Implementation approach:** Pure progressive enhancement. Wrap every call in feature detection. iOS users get no haptic feedback from this API -- there is no polyfill or workaround for iOS web.

```javascript
function haptic(pattern = 50) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}
```

**What NOT to do:**
- Do NOT try to use AudioContext or WebAudio as a "vibration polyfill" -- it does not produce haptic feedback
- Do NOT use any npm package claiming cross-platform vibration -- they all just wrap this same API
- Do NOT block on vibration availability -- the app must feel complete without it

**Source:** [Can I Use: Vibration](https://caniuse.com/vibration), [MDN: Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)

---

### 2. Web Share API (`navigator.share()`)

**Purpose:** Native share sheets for room invites, bracket screenshots, leaderboard results
**Confidence:** HIGH

| Browser | Support | Version | Notes |
|---------|---------|---------|-------|
| Chrome Android | YES | 61+ (partial), 128+ (full) | Full Level 2 support (files) |
| iOS Safari | YES | 12.2+ | Excellent support, longest track record |
| Desktop Chrome | YES | 89+ (partial), 128+ (full) | macOS/Windows only, not Linux |
| Firefox | **NO** | None | No support, no announced roadmap |

**API surface:**
```javascript
// Basic share (text/url)
await navigator.share({
  title: 'Join My March Madness Draft',
  text: 'Use room code XYZ to join!',
  url: 'https://stoekmedia.com/madness/?room=XYZ'
});

// File share (Level 2) -- for bracket screenshots
const file = new File([blob], 'bracket.png', { type: 'image/png' });
if (navigator.canShare?.({ files: [file] })) {
  await navigator.share({ files: [file] });
}
```

**Implementation approach:** Use Web Share API as primary, clipboard copy as fallback. The existing clipboard sharing already works -- Web Share is an upgrade, not a replacement.

```javascript
async function shareRoom(roomCode, roomUrl) {
  const shareData = {
    title: 'March Madness Draft',
    text: `Join my draft! Room: ${roomCode}`,
    url: roomUrl
  };
  if (navigator.share && navigator.canShare?.(shareData)) {
    await navigator.share(shareData);
  } else {
    await navigator.clipboard.writeText(roomUrl);
    // show "Link copied" toast
  }
}
```

**What NOT to do:**
- Do NOT call `navigator.share()` outside a user gesture (click/tap) -- browsers will reject it
- Do NOT remove the clipboard fallback -- Firefox users and desktop Linux users need it
- Do NOT use third-party share libraries (e.g., `share-api-polyfill`) -- they add complexity for zero benefit when you already have a clipboard fallback

**Source:** [Can I Use: Web Share](https://caniuse.com/web-share), [MDN: Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)

---

### 3. Screen Wake Lock API (`navigator.wakeLock.request()`)

**Purpose:** Keep screen on during Live Scores tab (30-second auto-refresh is useless if screen locks)
**Confidence:** HIGH

| Browser | Support | Version | Notes |
|---------|---------|---------|-------|
| Chrome Android | YES | 84+ | Full support |
| iOS Safari | YES | 16.4+ | Fixed in iOS 18.4 for installed PWAs |
| Desktop Chrome | YES | 84+ | Full support |
| Firefox | YES | 126+ | Full support |

**Global support:** 94.6% (Baseline 2025). This is the best-supported API in this entire list.

**API surface:**
```javascript
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch (err) {
      // Permission denied or not supported
    }
  }
}

function releaseWakeLock() {
  wakeLock?.release();
  wakeLock = null;
}
```

**Critical behavior:** The wake lock is automatically released when the tab/page becomes hidden (user switches tabs, minimizes browser). You MUST re-acquire it when the page becomes visible again:

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && shouldKeepAwake) {
    requestWakeLock();
  }
});
```

**Implementation approach:** Activate wake lock when user navigates to Live Scores tab. Release when navigating away. Re-acquire on visibility change. This is a simple, self-contained feature.

**What NOT to do:**
- Do NOT keep wake lock active on all tabs -- only Live Scores and during active draft
- Do NOT forget the `visibilitychange` re-acquisition -- this is the most common bug
- Do NOT use the deprecated `navigator.wakeLock.request('system')` -- only `'screen'` is standardized

**iOS PWA bug (now fixed):** There was a long-standing WebKit bug where Wake Lock did not work in installed PWAs. This was fixed in iOS 18.4. Users on iOS 16.4-18.3 may still experience this issue in installed PWA mode, but the API works fine in Safari browser.

**Source:** [Can I Use: Wake Lock](https://caniuse.com/wake-lock), [web.dev: Screen Wake Lock supported in all browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers)

---

### 4. Badging API (`navigator.setAppBadge()`)

**Purpose:** Show badge on app icon when it is your turn to draft
**Confidence:** HIGH

| Browser | Support | Version | Notes |
|---------|---------|---------|-------|
| Chrome Android | **NO (API)** | N/A | Android auto-badges from unread notifications instead |
| iOS Safari | YES | 16.4+ | PWA must be installed to home screen |
| Desktop Chrome | YES | 81+ | Windows/macOS only, not Linux |
| Desktop Edge | YES | 81+ | Windows/macOS |
| Firefox | **NO** | None | Not supported |

**API surface:**
```javascript
// Set badge with count
navigator.setAppBadge(3);

// Set badge without count (just a dot)
navigator.setAppBadge();

// Clear badge
navigator.clearAppBadge();
```

**Critical constraints:**
- Only works when the PWA is **installed** (added to home screen / dock)
- On Android, do NOT call `setAppBadge()` -- instead, Android automatically badges the icon when there are unread notifications. So push notifications handle badging for free on Android.
- On iOS Safari, there is a known spec deviation: calling `navigator.setAppBadge(0)` or `navigator.setAppBadge()` with no argument **removes** the badge instead of showing a dot. This is an Apple bug but unlikely to be fixed soon.
- Can be called from a Service Worker context (useful for updating badge when handling push events)

**Implementation approach:** Use the Badging API on supported platforms as progressive enhancement. On Android, rely on push notification badges instead.

```javascript
function updateDraftBadge(pendingPicks) {
  if ('setAppBadge' in navigator) {
    if (pendingPicks > 0) {
      navigator.setAppBadge(pendingPicks);
    } else {
      navigator.clearAppBadge();
    }
  }
}
```

**What NOT to do:**
- Do NOT treat badging as a critical feature -- it only works on installed PWAs and support varies
- Do NOT try to badge on Android via the API -- let push notifications handle it
- Do NOT use `navigator.setAppBadge()` (no argument) expecting a dot indicator on iOS -- it clears the badge

**Source:** [MDN: Display badge on app icon](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon), [WebKit: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)

---

### 5. Push Notifications (Firebase Cloud Messaging)

**Purpose:** Notify users when it is their turn to draft, when games finish, when leaderboard changes
**Confidence:** MEDIUM (most complex feature; iOS has constraints; requires backend)

| Browser | Support | Version | Notes |
|---------|---------|---------|-------|
| Chrome Android | YES | 50+ | Full support via FCM/VAPID |
| iOS Safari | PARTIAL | 16.4+ | PWA must be installed AND `display: standalone` in manifest |
| Desktop Chrome | YES | 50+ | Full support |
| Firefox | YES | 44+ | Uses Mozilla push service, not FCM directly |

#### Architecture Requirements

**This is the only feature that requires server-side code.** FCM messages must be sent from a trusted server, never from the client. For this project, that means Firebase Cloud Functions.

```
[Firestore change] --> [Cloud Function trigger] --> [FCM Admin SDK] --> [Push Service] --> [User's device]
```

#### Required Components

| Component | What | Why |
|-----------|------|-----|
| `firebase-messaging-compat.js` | Client SDK for FCM (CDN) | Handles token registration, foreground message handling |
| `firebase-messaging-sw.js` | Service worker for background push | Receives and displays notifications when app is not in foreground |
| Firebase Cloud Functions | Server-side trigger logic | Sends FCM messages when draft turn changes, games end, etc. |
| VAPID key pair | Web push credentials | Authenticates push requests to browser push services |
| Firestore `fcmTokens` collection | Token storage | Maps user passphrases to their FCM device tokens |

#### Firebase SDK Setup (CDN/Compat -- Matching Existing Pattern)

The existing app uses Firebase compat SDK v10.8.0 via CDN. FCM must use the same approach:

```html
<!-- Add to index.html alongside existing Firebase scripts -->
<script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js"></script>
```

```javascript
// Client-side initialization
const messaging = firebase.messaging();

// Register service worker at correct subdirectory path (CRITICAL for GitHub Pages)
const swRegistration = await navigator.serviceWorker.register(
  '/madness/firebase-messaging-sw.js',
  { scope: '/madness/' }
);

// Get FCM token with VAPID key
const token = await messaging.getToken({
  vapidKey: '<YOUR_VAPID_PUBLIC_KEY>',
  serviceWorkerRegistration: swRegistration
});

// Store token in Firestore associated with user's passphrase
```

#### Service Worker for FCM (`firebase-messaging-sw.js`)

This is a SEPARATE service worker file from the existing `sw.js`. It handles background push notifications.

```javascript
// firebase-messaging-sw.js (placed at /madness/firebase-messaging-sw.js)
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  // Same config as main app
  apiKey: '...',
  projectId: 'march-madness-snake-draft',
  messagingSenderId: '...',
  appId: '...'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: icon || '/madness/icons/icon-192.png',
    badge: '/madness/icons/icon-192.png',
    data: payload.data
  });
});
```

**Alternative approach:** Merge FCM handling into the existing `sw.js` instead of a separate file. This avoids managing two service workers for the same scope, which browsers do not allow. This is the recommended path -- extend `sw.js` with `importScripts` and FCM handlers.

#### Firebase Cloud Functions (Server-Side)

**Requirement:** The Firebase project must be on the **Blaze (pay-as-you-go) plan** to deploy Cloud Functions. The free Spark plan does not support Cloud Functions.

However, the Blaze plan includes a generous free tier:
- 2 million Cloud Function invocations/month free
- 400,000 GB-seconds compute time free
- For a 10-20 room tournament app, costs will be effectively $0

```javascript
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Trigger when draft turn changes
exports.notifyDraftTurn = functions.firestore
  .document('rooms/{roomId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.currentPick !== after.currentPick) {
      const currentPlayer = after.players[after.currentPick % after.players.length];
      // Fetch FCM token for currentPlayer from Firestore
      // Send notification via admin.messaging().send()
    }
  });
```

#### iOS Safari Push -- Critical Requirements

1. **Manifest MUST have `"display": "standalone"`** -- already satisfied
2. **PWA MUST be installed** (added to home screen) -- cannot receive push in browser
3. **Permission prompt MUST be triggered by user gesture** (tap a "Enable notifications" button)
4. **FCM web SDK handles VAPID-to-APNs routing automatically** -- no Apple Developer account needed
5. **No silent push** -- every push must show a visible notification on iOS

#### VAPID Key Setup

1. Go to Firebase Console > Project Settings > Cloud Messaging
2. Under "Web configuration", generate a key pair (or import existing)
3. The **public key** goes in client code (`getToken({ vapidKey: publicKey })`)
4. The **private key** stays in Firebase Cloud Functions environment

**What NOT to do:**
- Do NOT try to send FCM messages from client-side JavaScript -- the server key must never be in client code
- Do NOT use the legacy FCM HTTP API (`fcm.googleapis.com/fcm/send`) -- use the v1 API (`fcm.googleapis.com/v1/projects/*/messages:send`) via Admin SDK
- Do NOT create a separate `firebase-messaging-sw.js` file AND keep `sw.js` registering for the same scope -- merge them or use `serviceWorkerRegistration` option in `getToken()`
- Do NOT forget the subdirectory registration path -- FCM defaults to domain root, which will 404 on GitHub Pages at `/madness/`
- Do NOT use any third-party push service (OneSignal, Pusher, etc.) -- FCM is already in the Firebase ecosystem and handles VAPID+APNs routing

**Source:** [Firebase: FCM for Safari](https://firebase.blog/posts/2023/08/fcm-for-safari/), [Firebase: FCM Web Setup](https://firebase.google.com/docs/cloud-messaging/js/client), [GitHub Issue: FCM in subdirectory](https://github.com/firebase/firebase-js-sdk/issues/2831)

---

### 6. App Shortcuts (manifest.json `shortcuts` member)

**Purpose:** Long-press app icon to jump to Live Scores, Bracket, or Leaderboard
**Confidence:** HIGH

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome Android | YES | Shows up to 3 shortcuts on long-press |
| Desktop Chrome | YES | Shows up to 10 in taskbar context menu |
| Desktop Edge | YES | Shows up to 10 in taskbar context menu |
| iOS Safari | **NO** | No support, no announced roadmap |
| Firefox | **NO** | No support |

**Implementation:** Pure manifest.json addition. No JavaScript required.

```json
{
  "shortcuts": [
    {
      "name": "Live Scores",
      "short_name": "Scores",
      "description": "View live game scores",
      "url": "./?tab=scores",
      "icons": [{ "src": "icons/scores-96.png", "sizes": "96x96" }]
    },
    {
      "name": "My Bracket",
      "short_name": "Bracket",
      "description": "View your bracket",
      "url": "./?tab=bracket",
      "icons": [{ "src": "icons/bracket-96.png", "sizes": "96x96" }]
    },
    {
      "name": "Leaderboard",
      "short_name": "Leaders",
      "description": "View current standings",
      "url": "./?tab=leaderboard",
      "icons": [{ "src": "icons/leaderboard-96.png", "sizes": "96x96" }]
    }
  ]
}
```

**Requirements:**
- Shortcut icons should be 96x96 PNG (required for Android)
- URLs must be within the PWA scope
- The `url` values need to work with the app's routing -- since this is a single-page app with tab-based navigation, use query parameters that the app reads on load
- Max 3 shortcuts for Android (Chrome ignores extras), max 10 for desktop

**What NOT to do:**
- Do NOT add more than 3 shortcuts -- Android will only show 3, keep it focused
- Do NOT use shortcut URLs that point outside the PWA scope
- Do NOT rely on shortcuts as the only navigation method -- they are a convenience feature, not a replacement for in-app navigation

**Source:** [MDN: Expose common actions as shortcuts](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Expose_common_actions_as_shortcuts), [web.dev: PWA Enhancements](https://web.dev/learn/pwa/enhancements)

---

### 7. Enhanced Manifest (`display_override`)

**Purpose:** Better native-app feel with display mode fallback chain
**Confidence:** HIGH

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | YES | 93+ |
| Edge | YES | 93+ |
| Safari | **NO** | Falls back to `display` property (no harm) |
| Firefox | **NO** | Falls back to `display` property (no harm) |

```json
{
  "display": "standalone",
  "display_override": ["standalone"]
}
```

For this app, `display_override` with just `["standalone"]` is sufficient. The `window-controls-overlay` mode is desktop-only and overkill for a tournament bracket app. Using `display_override` mainly future-proofs the manifest -- browsers that don't support it safely ignore it and use `display`.

**What NOT to do:**
- Do NOT add `window-controls-overlay` -- it is for desktop apps that need custom title bars, irrelevant here
- Do NOT remove the `display` property -- it is the required fallback for browsers that ignore `display_override`

---

## Draft Timer Sync (Firestore -- Not a New API)

**Purpose:** Synchronized countdown timer across all draft participants
**Confidence:** HIGH (uses existing Firestore real-time sync)

This is NOT a new browser API. It uses the existing Firestore `onSnapshot` listener. The key decisions are architectural, not technological:

**Approach:** Store `draftTimerEnd` (server timestamp + duration) in the room document. All clients compute remaining time locally from this shared reference point. When timer expires, any client can trigger the auto-pick, but use Firestore security rules or a Cloud Function to ensure only one auto-pick executes.

**Key consideration:** If Cloud Functions are already being deployed for push notifications, the auto-pick logic should also live in Cloud Functions (server-authoritative) rather than relying on client-side expiry detection, which is subject to clock skew and race conditions.

---

## Consolidated Manifest.json Changes

All manifest modifications in one place:

```json
{
  "name": "March Madness Draft",
  "short_name": "MM Draft",
  "description": "March Madness bracket pool with snake draft",
  "start_url": ".",
  "display": "standalone",
  "display_override": ["standalone"],
  "background_color": "#ffffff",
  "theme_color": "#C5991A",
  "id": "/madness/",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "shortcuts": [
    {
      "name": "Live Scores",
      "short_name": "Scores",
      "url": "./?tab=scores",
      "icons": [{ "src": "icons/scores-96.png", "sizes": "96x96", "type": "image/png" }]
    },
    {
      "name": "My Bracket",
      "short_name": "Bracket",
      "url": "./?tab=bracket",
      "icons": [{ "src": "icons/bracket-96.png", "sizes": "96x96", "type": "image/png" }]
    },
    {
      "name": "Leaderboard",
      "short_name": "Leaders",
      "url": "./?tab=leaderboard",
      "icons": [{ "src": "icons/leaderboard-96.png", "sizes": "96x96", "type": "image/png" }]
    }
  ]
}
```

---

## Service Worker Strategy

**Critical decision:** The app currently has ONE service worker (`sw.js`) registered at `/madness/` scope. Browsers only allow ONE active service worker per scope. Firebase Cloud Messaging needs `firebase-messaging-sw.js`. These must be merged.

**Recommended approach:** Extend `sw.js` to include FCM handling:

```javascript
// At the top of existing sw.js, add:
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({ /* config */ });
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Handle background push notifications
});

// ... existing cache-first logic below ...
```

Then in client code, pass the existing SW registration to FCM:

```javascript
const registration = await navigator.serviceWorker.ready;
const token = await messaging.getToken({
  vapidKey: '<VAPID_PUBLIC_KEY>',
  serviceWorkerRegistration: registration
});
```

This avoids the separate `firebase-messaging-sw.js` file entirely, which is cleaner and avoids the GitHub Pages subdirectory registration issue.

---

## Additional CDN Script Required

Only ONE new CDN script is needed beyond what the app already loads:

```html
<script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js"></script>
```

No npm packages. No bundler. No build step. This matches the existing zero-dependency CDN approach.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| Push service | Firebase Cloud Messaging | OneSignal, Pusher, Web Push directly | Already in Firebase ecosystem; FCM handles VAPID+APNs routing; no additional vendor |
| Push backend | Firebase Cloud Functions | Custom server, Cloudflare Workers | Cloud Functions integrates natively with Firestore triggers and FCM Admin SDK |
| Vibration polyfill | None (feature detect + skip) | AudioContext haptic simulation | Does not actually produce haptic feedback on any platform |
| Share fallback | Clipboard API (already exists) | share-api-polyfill npm package | Adds dependency for no benefit -- clipboard fallback already works |
| Badge alternative | Push notifications (auto-badge on Android) | Favicon badge manipulation | Favicon badges are hacky and don't work on mobile home screens |
| Timer sync | Firestore server timestamp | WebSocket, custom server | Already using Firestore for all real-time sync |

---

## Browser Compatibility Matrix (Summary)

| API | Chrome Android | iOS Safari | Desktop Chrome | Firefox |
|-----|---------------|------------|---------------|---------|
| Vibration | YES | **NO** | YES (no-ops) | **NO (removed)** |
| Web Share | YES | YES | YES (partial Linux) | **NO** |
| Wake Lock | YES | YES (16.4+) | YES | YES (126+) |
| Badging | NO (auto via notif) | YES (16.4+, installed) | YES | **NO** |
| Push (FCM) | YES | PARTIAL (installed only) | YES | YES |
| App Shortcuts | YES (3 max) | **NO** | YES (10 max) | **NO** |
| display_override | YES | **NO** (harmless) | YES | **NO** (harmless) |

**Key takeaway:** Every feature in this list works on Chrome Android. iOS Safari supports the critical features (Wake Lock, Push, Badge, Web Share) but NOT Vibration or Shortcuts. All features use progressive enhancement -- the app must be fully functional without any of them.

---

## Firebase Project Requirements

| Requirement | Current Status | Action Needed |
|-------------|---------------|---------------|
| Blaze plan | Unknown | **Must upgrade from Spark to Blaze** for Cloud Functions |
| Cloud Functions enabled | Unknown | Enable in Firebase Console |
| FCM Registration API | Unknown | Enable in Google Cloud Console |
| VAPID key pair | Does not exist | Generate in Firebase Console > Cloud Messaging |
| `firebase-admin` SDK | Not installed | `npm install firebase-admin firebase-functions` in a `/functions` directory |
| `fcmTokens` collection | Does not exist | Create Firestore collection to store user device tokens |

---

## Sources

- [Can I Use: Vibration](https://caniuse.com/vibration)
- [Can I Use: Web Share](https://caniuse.com/web-share)
- [Can I Use: Wake Lock](https://caniuse.com/wake-lock)
- [MDN: Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)
- [MDN: Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [MDN: Display badge on app icon](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon)
- [MDN: Expose common actions as shortcuts](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Expose_common_actions_as_shortcuts)
- [MDN: display_override](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display_override)
- [Firebase: FCM Web Setup](https://firebase.google.com/docs/cloud-messaging/js/client)
- [Firebase: FCM for Safari](https://firebase.blog/posts/2023/08/fcm-for-safari/)
- [Firebase: Cloud Functions Use Cases](https://firebase.google.com/docs/functions/use-cases)
- [Firebase: Pricing](https://firebase.google.com/pricing)
- [GitHub Issue: FCM in subdirectory](https://github.com/firebase/firebase-js-sdk/issues/2831)
- [WebKit: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)
- [web.dev: Screen Wake Lock in all browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers)
- [web.dev: PWA Enhancements](https://web.dev/learn/pwa/enhancements)
