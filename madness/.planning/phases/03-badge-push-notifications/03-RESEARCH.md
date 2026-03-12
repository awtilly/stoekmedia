# Phase 3: Badge & Push Notifications - Research

**Researched:** 2026-03-12
**Domain:** PWA Badge API, Firebase Cloud Messaging (FCM), Firebase Cloud Functions v2, Push Notification UX
**Confidence:** MEDIUM

## Summary

Phase 3 adds re-engagement features to the March Madness PWA: app icon badges when it is a user's turn to draft, and push notifications for draft turns, game finals, and leaderboard changes. This is the only phase requiring server-side infrastructure -- Firebase Cloud Functions must be set up from scratch for the `march-madness-snake-draft` Firebase project, which currently has zero backend configuration (no `firebase.json`, no `.firebaserc`, no `functions/` directory in the `madness/` subdirectory).

The Badge API is straightforward (a few lines of client code), but platform behavior varies significantly: iOS requires notification permission before badges appear, Android ignores the Badge API entirely (badges come from unread notifications automatically). Push notifications via FCM require four moving parts: (1) a VAPID key from the Firebase console, (2) client-side FCM token acquisition using the compat SDK loaded via CDN, (3) FCM messaging integrated into the existing `sw.js` service worker, and (4) Cloud Functions that trigger on Firestore room document changes to send notifications via the Admin SDK. The client-side web SDK does NOT support topic subscription -- all topic management must happen server-side.

**Primary recommendation:** Structure implementation as three plans: (1) Badge API + FCM client setup + permission UX, (2) Cloud Functions infrastructure + draft turn notifications, (3) game final + leaderboard change notifications. The Blaze billing plan must be verified/enabled before Cloud Functions can deploy.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BDGE-01 | App icon badge shows pending pick count when it's user's turn to draft | Badge API section -- `navigator.setAppBadge(count)` with platform behavior matrix |
| BDGE-02 | Badge clears when user makes their pick or turn passes | Badge API section -- `navigator.clearAppBadge()` on pick/auto-pick events |
| PUSH-01 | "It's your turn to draft" push notification when user's pick is up | Cloud Functions `onDocumentUpdated` trigger on room doc, detect `ds.cp` change |
| PUSH-02 | "Game just went final" notification with score and upset alert | Cloud Function polling ESPN API or client-triggered callable function |
| PUSH-03 | "Leaderboard shake-up" notification when rankings change | Cloud Function comparing previous/current leaderboard state on room update |
| PUSH-04 | FCM token management -- store per player per room in Firestore | Token storage architecture section -- subcollection `rooms/{roomId}/fcmTokens/{playerId}` |
| PUSH-05 | Firebase Cloud Functions deployed for server-side push triggers | Cloud Functions infrastructure section -- full setup from scratch required |
| PUSH-06 | Contextual permission prompt (after joining draft, not on first visit) | Permission UX section -- timing, iOS onboarding flow |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Firebase Compat SDK (CDN) | 10.8.0 | FCM client (`firebase-messaging-compat.js`) | Already using 10.8.0 for app + firestore compat; messaging compat is the CDN-compatible option |
| firebase-admin | ^12.0.0 | Server-side FCM message sending | Standard for Cloud Functions; same version as existing greendoor functions |
| firebase-functions | ^6.0.0 | Cloud Functions v2 triggers | v2 API with `onDocumentUpdated` from `firebase-functions/v2/firestore` |
| Badge API | Browser native | App icon badge count | `navigator.setAppBadge()` -- no library needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| firebase-tools CLI | 15.x (installed globally) | Deploy Cloud Functions | Already installed; used for `firebase deploy --only functions` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FCM compat SDK via CDN | Modular SDK with bundler | Would require adding a build step; not worth it for this zero-dependency vanilla JS project |
| Cloud Functions for game finals | Client-triggered callable | Simpler but requires app to be open; CF can poll independently on a schedule |
| Separate firebase-messaging-sw.js | Integrate into existing sw.js | Must use existing sw.js since only one SW per scope; pass registration to `getToken()` |

**Installation (Cloud Functions only -- client is CDN):**
```bash
# In madness/ directory after firebase init
cd functions && npm install firebase-admin firebase-functions
```

## Architecture Patterns

### Firebase Project Setup for madness/
The `madness/` subdirectory currently has NO Firebase CLI configuration. The repo root `.firebaserc` points to `greendoor-2da47`. The madness app uses `march-madness-snake-draft` (project ID from `firebaseConfig` in index.html). Two options:

**Recommended:** Create `madness/firebase.json` and `madness/.firebaserc` scoped to `march-madness-snake-draft`. Run `firebase init functions` from within `madness/`. This keeps the two Firebase projects (greendoor vs madness) cleanly separated.

```
madness/
  firebase.json          # NEW -- functions config for march-madness-snake-draft
  .firebaserc            # NEW -- default project: march-madness-snake-draft
  functions/             # NEW -- Cloud Functions source
    index.js             # Notification triggers
    package.json         # firebase-admin, firebase-functions
  sw.js                  # MODIFIED -- add FCM messaging handlers
  index.html             # MODIFIED -- add FCM client code
  manifest.json          # unchanged
  firestore.rules        # MODIFIED -- add fcmTokens subcollection rules
```

### FCM Token Storage
```
Firestore structure:
rooms/{roomId}                          # existing room document
rooms/{roomId}/fcmTokens/{playerId}     # NEW subcollection
  {
    tokens: ["token1", "token2"],       # array -- one player can have multiple devices
    updatedAt: Timestamp
  }
```

Why a subcollection instead of a field on the room doc: the room doc is already large (entire game state serialized as JSON string). FCM tokens are metadata that don't need to be synced to all clients on every render. A subcollection keeps them separate and allows Cloud Functions to read tokens without loading the full room state.

### Service Worker Integration Pattern
**Critical:** Firebase messaging requires a service worker. The app already has `sw.js`. You CANNOT have two service workers at the same scope. Do NOT create a separate `firebase-messaging-sw.js`.

**Pattern:** Add FCM messaging initialization inside the existing `sw.js`, then pass the existing service worker registration to `getToken()` via the `serviceWorkerRegistration` option.

```javascript
// In sw.js -- add at the top:
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({ /* same config as index.html */ });
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, url } = payload.data;
  self.registration.showNotification(title, {
    body,
    icon: icon || '/madness/icons/icon-192.png',
    data: { url: url || '/madness/' }
  });
});

// notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/madness/';
  event.waitUntil(clients.openWindow(url));
});
```

```javascript
// In index.html -- FCM client initialization:
// After service worker registration, pass it to getToken()
const swReg = await navigator.serviceWorker.ready;
const messaging = firebase.messaging();
const token = await messaging.getToken({
  vapidKey: 'YOUR_VAPID_KEY',
  serviceWorkerRegistration: swReg
});
```

### Cloud Function Architecture
```javascript
// functions/index.js
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

exports.onRoomUpdated = onDocumentUpdated('rooms/{roomId}', async (event) => {
  const before = JSON.parse(event.data.before.data().state || '{}');
  const after = JSON.parse(event.data.after.data().state || '{}');

  // Detect draft turn change
  if (after.ds?.cp !== before.ds?.cp && !after.ds?.complete) {
    const currentDrafterId = after.ds.order[after.ds.cp];
    // Look up FCM tokens for that player
    const tokenDoc = await getFirestore()
      .doc(`rooms/${event.params.roomId}/fcmTokens/${currentDrafterId}`)
      .get();
    if (tokenDoc.exists) {
      const tokens = tokenDoc.data().tokens || [];
      // Send to all devices
      await getMessaging().sendEachForMulticast({
        tokens,
        data: {
          title: "You're on the clock!",
          body: `Pick #${after.ds.cp + 1} -- it's your turn to draft`,
          url: `/madness/?room=${event.params.roomId}`
        }
      });
    }
  }
});
```

### Badge API Integration Points
```javascript
// In index.html -- call from render() or connectToRoom() onSnapshot callback:
function updateAppBadge() {
  if (!navigator.setAppBadge) return;
  const myId = getMyPlayerId();
  const ds = S.ds;
  if (ds && ds.started && !ds.complete && myId === ds.order[ds.cp]) {
    navigator.setAppBadge(1).catch(() => {});
  } else {
    navigator.clearAppBadge().catch(() => {});
  }
}
```

Call `updateAppBadge()` in: `connectToRoom` onSnapshot handler (after state update), `pickTeam()` (after pick), `autoPickHighestSeed()` (after auto-pick).

### Permission Prompt UX Flow
```
User joins room via link
  -> selfRegister() completes (name + PIN)
  -> User lands in room
  -> Show contextual prompt: "Get notified when it's your turn to draft?"
     [Enable Notifications] [Not now]
  -> If iOS + not standalone:
     Show guided overlay: "To receive notifications, first add this app
     to your Home Screen, then enable notifications"
  -> Notification.requestPermission()
  -> If granted: getToken() -> store in Firestore
  -> If denied: respect decision, hide prompt
```

### Anti-Patterns to Avoid
- **Separate firebase-messaging-sw.js:** Only one service worker per scope. Integrate into existing `sw.js`.
- **Storing FCM tokens on the room document:** The room doc is already large and synced to all clients on every change. Tokens are metadata, not game state.
- **Client-side topic subscription:** The web SDK does NOT support `subscribeToTopic()`. All topic management must happen server-side via Admin SDK.
- **Requesting notification permission on page load:** Browsers will auto-reject. Must be after user gesture and at a contextual moment.
- **Using `notification` key in FCM payload:** When using the `notification` key, the browser handles display automatically and you lose control of the notification content. Use `data`-only payloads with `onBackgroundMessage` for full control.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Push notification delivery | Custom WebSocket server | Firebase Cloud Messaging | FCM handles APNs integration for iOS, token refresh, delivery retry, and cross-platform differences |
| Token refresh | Manual token refresh polling | FCM SDK `getToken()` | FCM SDK handles token rotation automatically; just call `getToken()` and update Firestore if it changed |
| Background notification display | Custom push event handler | `messaging.onBackgroundMessage()` | FCM compat SDK handles the push event parsing; you just customize the notification UI |
| Notification permission state | Manual `Notification.permission` tracking | Permissions API + FCM | `navigator.permissions.query({name: 'notifications'})` gives change events |

**Key insight:** FCM abstracts the massive complexity difference between Chrome push (straightforward) and iOS Safari push (requires APNs under the hood, home screen install, user gesture permission). Using FCM means one API for both platforms.

## Common Pitfalls

### Pitfall 1: Firebase Project Confusion
**What goes wrong:** Deploying Cloud Functions to the wrong Firebase project (greendoor instead of march-madness-snake-draft) because the repo root `.firebaserc` points to greendoor.
**Why it happens:** The repo is a monorepo with two Firebase projects.
**How to avoid:** Create `madness/.firebaserc` with `march-madness-snake-draft` as default. Always `cd madness` before running `firebase deploy`.
**Warning signs:** Functions appear in the wrong Firebase console; Firestore triggers don't fire.

### Pitfall 2: Service Worker Scope Conflict
**What goes wrong:** Creating `firebase-messaging-sw.js` alongside `sw.js` causes registration conflicts or the FCM SW overrides the cache SW.
**Why it happens:** Firebase docs tell you to create firebase-messaging-sw.js, but the app already has a custom SW.
**How to avoid:** Integrate FCM into the existing `sw.js`. Pass the existing SW registration to `getToken({ serviceWorkerRegistration })`.
**Warning signs:** Cache stops working, notifications work but offline doesn't (or vice versa).

### Pitfall 3: iOS Badge Requires Notification Permission
**What goes wrong:** `setAppBadge()` is called but badge never appears on iOS.
**Why it happens:** On iOS/iPadOS, badges will NOT display unless the user has granted notification permission, even though the API call succeeds silently.
**How to avoid:** Request notification permission first, then badges work automatically. On iOS, badge and push are bundled -- you can't have one without the other.
**Warning signs:** Badge works on desktop Chrome but not on iOS Safari PWA.

### Pitfall 4: Blaze Plan Required for Cloud Functions
**What goes wrong:** `firebase deploy --only functions` fails with billing error.
**Why it happens:** Cloud Functions require the Blaze (pay-as-you-go) billing plan. The Spark (free) plan does not support Cloud Functions at all.
**How to avoid:** Verify/upgrade to Blaze plan in Firebase console BEFORE starting implementation. Free tier is generous: 2M invocations/month, 400K GB-seconds/month.
**Warning signs:** Deploy command returns billing-related error.

### Pitfall 5: Infinite Loop in Firestore Triggers
**What goes wrong:** Cloud Function triggers on room document update, writes back to the same document, triggering itself indefinitely.
**Why it happens:** `onDocumentUpdated` fires on ANY update, including ones made by the function itself.
**How to avoid:** The notification function should ONLY READ tokens and send notifications -- it should NEVER write back to the room document. If it needs to track state (e.g., "already notified for this pick"), use a separate collection.
**Warning signs:** Rapidly escalating Cloud Function invocations, billing spike.

### Pitfall 6: FCM Token Staleness
**What goes wrong:** Push notifications fail silently because stored tokens have expired or been rotated.
**Why it happens:** FCM tokens can expire, especially on iOS where the token may change after a device restart.
**How to avoid:** Call `getToken()` on every app open and compare with stored token. If different, update Firestore. Handle `messaging/token-not-registered` errors in Cloud Functions by removing stale tokens.
**Warning signs:** Notifications worked initially but stop working after a few days.

### Pitfall 7: Data-Only vs Notification Payloads
**What goes wrong:** Background notifications show generic content or don't trigger `onBackgroundMessage`.
**Why it happens:** When using the `notification` key in the FCM payload, the browser displays the notification automatically and `onBackgroundMessage` is NOT called. When using `data`-only payloads, `onBackgroundMessage` IS called and you have full control.
**How to avoid:** Always use `data`-only payloads from Cloud Functions. Format the notification in the service worker's `onBackgroundMessage` handler.
**Warning signs:** Notification shows "Firebase Cloud Messaging" as title instead of custom content.

## Code Examples

### Badge API -- Set and Clear
```javascript
// Source: WebKit Blog, MDN Badge API docs
function updateAppBadge() {
  if (!navigator.setAppBadge) return;
  const myId = getMyPlayerId();
  const ds = S.ds;
  if (ds && ds.started && !ds.complete && myId === ds.order[ds.cp]) {
    navigator.setAppBadge(1).catch(() => {});
  } else {
    navigator.clearAppBadge().catch(() => {});
  }
}
```

### FCM Client Token Acquisition (Compat SDK, CDN)
```javascript
// Source: Firebase FCM web docs
// Add to index.html after firebase-messaging-compat.js script tag
async function initFCM() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const messaging = firebase.messaging();
    const swReg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({
      vapidKey: 'YOUR_VAPID_KEY_HERE',
      serviceWorkerRegistration: swReg
    });
    if (token && roomId) {
      const myId = getMyPlayerId();
      if (myId) {
        await db.collection('rooms').doc(roomId)
          .collection('fcmTokens').doc(myId)
          .set({
            tokens: firebase.firestore.FieldValue.arrayUnion(token),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
      }
    }
  } catch (err) {
    console.warn('FCM init failed:', err);
  }
}
```

### Foreground Message Handler
```javascript
// Source: Firebase FCM web docs
// In index.html -- show toast instead of system notification when app is focused
const messaging = firebase.messaging();
messaging.onMessage((payload) => {
  const { title, body } = payload.data;
  showToast(`${title}: ${body}`);
});
```

### Service Worker Background Handler
```javascript
// Source: Firebase FCM web docs
// In sw.js -- after Firebase init
messaging.onBackgroundMessage((payload) => {
  const { title, body, url } = payload.data;
  self.registration.showNotification(title, {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: url || './' },
    tag: payload.data.tag || 'default'  // collapse duplicates
  });

  // Update badge count from push event
  if (self.navigator.setAppBadge && payload.data.badgeCount) {
    self.navigator.setAppBadge(parseInt(payload.data.badgeCount));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Focus existing window if open
        for (const client of windowClients) {
          if (client.url.includes('/madness/') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open new window
        return clients.openWindow(url);
      })
  );
});
```

### Cloud Function -- Draft Turn Notification
```javascript
// Source: Firebase Cloud Functions v2 docs, Firebase Admin Messaging docs
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp } = require('firebase-admin/app');

initializeApp();
const db = getFirestore();

exports.notifyDraftTurn = onDocumentUpdated('rooms/{roomId}', async (event) => {
  const beforeState = JSON.parse(event.data.before.data().state || '{}');
  const afterState = JSON.parse(event.data.after.data().state || '{}');

  const beforeDs = beforeState.ds || {};
  const afterDs = afterState.ds || {};

  // Only fire when draft pick index changes (new turn)
  if (afterDs.cp === beforeDs.cp) return;
  if (afterDs.complete) return;
  if (!afterDs.started) return;

  const currentDrafterId = afterDs.order?.[afterDs.cp];
  if (!currentDrafterId) return;

  const drafterName = afterState.players?.find(p => p.id === currentDrafterId)?.name || 'Player';
  const pickNumber = afterDs.cp + 1;
  const roundNumber = Math.floor(afterDs.cp / afterState.players.length) + 1;

  // Get FCM tokens for the current drafter
  const tokenDoc = await db
    .doc(`rooms/${event.params.roomId}/fcmTokens/${currentDrafterId}`)
    .get();

  if (!tokenDoc.exists) return;
  const tokens = tokenDoc.data().tokens || [];
  if (tokens.length === 0) return;

  const message = {
    tokens,
    data: {
      title: "You're on the clock!",
      body: `Pick #${pickNumber} (Round ${roundNumber}) -- make your selection`,
      url: `/madness/?room=${event.params.roomId}`,
      tag: 'draft-turn',
      badgeCount: '1'
    }
  };

  const response = await getMessaging().sendEachForMulticast(message);

  // Clean up failed tokens
  const failedTokens = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
      failedTokens.push(tokens[idx]);
    }
  });

  if (failedTokens.length > 0) {
    const { FieldValue } = require('firebase-admin/firestore');
    await db.doc(`rooms/${event.params.roomId}/fcmTokens/${currentDrafterId}`)
      .update({ tokens: FieldValue.arrayRemove(...failedTokens) });
  }
});
```

### Contextual Permission Prompt
```javascript
// Source: WebKit blog, MDN Notification.requestPermission docs
async function requestNotificationPermission() {
  // Check if notifications are supported
  if (!('Notification' in window)) {
    showToast('Notifications not supported in this browser');
    return false;
  }

  // Check if already granted
  if (Notification.permission === 'granted') {
    await initFCM();
    return true;
  }

  // Check if permanently denied
  if (Notification.permission === 'denied') {
    showToast('Notifications are blocked. Enable in browser settings.');
    return false;
  }

  // Request permission (must be from user gesture)
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    await initFCM();
    return true;
  }
  return false;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `messaging.useServiceWorker(reg)` | `getToken({ serviceWorkerRegistration: reg })` | Firebase JS SDK v8+ | `useServiceWorker()` is deprecated; pass registration via `getToken()` options |
| Cloud Functions v1 `functions.firestore.document().onUpdate()` | `onDocumentUpdated` from `firebase-functions/v2/firestore` | CF v2 (2023) | v2 has better concurrency, longer timeout, region config in code |
| FCM Legacy HTTP API | FCM HTTP v1 API / Admin SDK | June 2024 (legacy deprecated) | Admin SDK `getMessaging().send()` uses v1 API automatically |
| `messaging.setBackgroundMessageHandler()` | `messaging.onBackgroundMessage()` | Firebase JS SDK v9+ | API renamed but functionally identical in compat mode |

**Deprecated/outdated:**
- `useServiceWorker()` -- deprecated, use `getToken({ serviceWorkerRegistration })` instead
- FCM Legacy HTTP API (`fcm.googleapis.com/fcm/send`) -- deprecated June 2024, use Admin SDK or HTTP v1
- `messaging.setBackgroundMessageHandler()` -- renamed to `onBackgroundMessage()` in SDK v9+

## Platform Behavior Matrix

| Feature | iOS Safari (Home Screen PWA) | Chrome Android | Chrome Desktop |
|---------|------------------------------|---------------|----------------|
| `setAppBadge(count)` | Yes (16.4+), requires notification permission | No (ignored; badges come from notifications) | Yes (installed PWA) |
| Push notifications | Yes (16.4+), home screen only, user gesture permission | Yes | Yes |
| `onBackgroundMessage` | Yes (when installed as PWA) | Yes | Yes |
| Token persistence | Fragile -- may reset on device restart | Stable | Stable |
| Notification actions | No | Limited | Limited |

**Key implication:** On Android, the Badge API is irrelevant -- you get badges for free from push notifications. On iOS, you need notification permission for both badges AND push. This means the Badge API and push permission are effectively bundled on both major mobile platforms.

## Open Questions

1. **Blaze plan billing status**
   - What we know: Cloud Functions require Blaze plan. The `march-madness-snake-draft` project's billing status is unknown.
   - What's unclear: Whether Blaze is already enabled or needs to be upgraded.
   - Recommendation: Check Firebase console before starting implementation. This is a hard blocker for PUSH-05.

2. **VAPID key generation**
   - What we know: A VAPID key must be generated in the Firebase console under Cloud Messaging > Web configuration.
   - What's unclear: Whether the Cloud Messaging API is already enabled for this project.
   - Recommendation: Generate the VAPID key in the console as part of the first implementation task. Store it as a constant in the client code (VAPID public keys are safe to expose).

3. **Game final detection approach**
   - What we know: Live scores are currently fetched client-side from ESPN API every 30 seconds. There is no server-side score tracking.
   - What's unclear: Whether to (a) have a Cloud Function poll ESPN on a schedule, or (b) have clients report game finals to Firestore and trigger notifications from those writes.
   - Recommendation: Option (b) is simpler -- when a client detects a game went final, it writes the result to a subcollection (e.g., `rooms/{roomId}/gameResults/{gameId}`). A Cloud Function triggers on that write and sends notifications to other players. This avoids giving the Cloud Function ESPN API access and keeps polling client-side.

4. **Leaderboard change detection**
   - What we know: Scores are computed client-side from game results. There is no persisted leaderboard state in Firestore.
   - What's unclear: How to detect ranking changes server-side when leaderboard data isn't stored.
   - Recommendation: When a game final is written, the Cloud Function can compute scores and compare rankings before/after. OR: simpler approach -- include previous rankings in the game result write, let the CF compare.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None -- no test infrastructure exists |
| Config file | none -- see Wave 0 |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BDGE-01 | Badge shows when it's user's turn | manual-only | Manual: install PWA, start draft, verify badge on home screen | N/A |
| BDGE-02 | Badge clears on pick or turn pass | manual-only | Manual: make pick, verify badge clears | N/A |
| PUSH-01 | Draft turn push notification received | manual-only | Manual: close app, have another player pick, verify notification | N/A |
| PUSH-02 | Game final notification received | manual-only | Manual: trigger game final event, verify notification | N/A |
| PUSH-03 | Leaderboard change notification | manual-only | Manual: trigger ranking change, verify notification | N/A |
| PUSH-04 | FCM token stored in Firestore | smoke | Check Firestore console for token doc after granting permission | N/A |
| PUSH-05 | Cloud Functions deployed and triggered | smoke | `firebase functions:log` after room update | N/A |
| PUSH-06 | Permission prompt at contextual moment | manual-only | Manual: join draft room, verify prompt appears | N/A |

### Sampling Rate
- **Per task commit:** Manual smoke test -- open app on phone, verify notification flow
- **Per wave merge:** Full manual test matrix across iOS Safari PWA + Chrome Android + Chrome Desktop
- **Phase gate:** All notification types verified on at least one mobile platform

### Wave 0 Gaps
- [ ] Firebase CLI initialized in `madness/` directory (`.firebaserc`, `firebase.json`)
- [ ] Blaze billing plan verified/enabled for `march-madness-snake-draft`
- [ ] VAPID key generated in Firebase console
- [ ] `madness/functions/` directory created with `package.json`

Note: Push notifications and badges are inherently manual-test features. They depend on OS-level behavior (notification display, app icon badges, home screen installation) that cannot be automated in a unit test. The validation approach is manual smoke testing across platforms.

## Sources

### Primary (HIGH confidence)
- [Firebase FCM Web Client Setup](https://firebase.google.com/docs/cloud-messaging/js/client) -- token acquisition, VAPID key, service worker config
- [Firebase Cloud Functions Firestore Triggers](https://firebase.google.com/docs/functions/firestore-events) -- onDocumentUpdated v2 API
- [Firebase Admin SDK Messaging](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk) -- sendEachForMulticast, message format
- [WebKit: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/) -- iOS badge behavior, notification permission requirement, push event code example
- [MDN: Navigator.setAppBadge()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge) -- API reference, browser compat
- [MDN: Display badge on app icon](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon) -- PWA badge guide
- [Firebase Pricing](https://firebase.google.com/pricing) -- Blaze plan free tier limits

### Secondary (MEDIUM confidence)
- [Firebase FCM Receive Messages](https://firebase.google.com/docs/cloud-messaging/js/receive) -- onBackgroundMessage pattern
- [Firebase Organize Multiple Functions](https://firebase.google.com/docs/functions/organize-functions) -- codebase attribute for monorepo
- [Chrome Developers: Badging API](https://developer.chrome.com/docs/capabilities/web-apis/badging-api) -- desktop PWA badge behavior
- [Brainhub: PWA on iOS 2025](https://brainhub.eu/library/pwa-on-ios) -- iOS PWA limitations matrix
- [MagicBell: PWA iOS Limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) -- iOS notification permission UX

### Tertiary (LOW confidence)
- [GitHub firebase-js-sdk #8416](https://github.com/firebase/firebase-js-sdk/issues/8416) -- setAppBadge in onBackgroundMessage issues
- [GitHub firebase-js-sdk #8010](https://github.com/firebase/firebase-js-sdk/issues/8010) -- iOS web push token loss on device restart

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Firebase compat SDK and Cloud Functions v2 are well-documented, project already uses Firebase 10.8.0
- Architecture: MEDIUM -- Service worker integration pattern is well-established but token storage design and game final detection are design decisions not validated in production
- Pitfalls: HIGH -- Multiple verified sources document the iOS badge/permission coupling, SW scope conflicts, and data-only payload pattern
- Platform behavior: MEDIUM -- iOS push in PWAs is newer (16.4+, March 2023) and has known fragility around token persistence

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (30 days -- FCM and Badge APIs are stable)
