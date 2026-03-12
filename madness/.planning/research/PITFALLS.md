# Domain Pitfalls: PWA Enhancement for March Madness Draft App

**Domain:** PWA native-API enhancement of existing vanilla JS single-file SPA
**Researched:** 2026-03-11
**Architecture:** Single `index.html` (~3,500 lines), Firebase Firestore, GitHub Pages at `/madness` subdirectory
**Target platforms:** iOS Safari, Chrome Android, Desktop Chrome

---

## Critical Pitfalls

Mistakes that cause features to silently fail on a target platform or require architectural rework.

---

### Pitfall 1: Vibration API Does Not Exist on iOS -- There Is No Fallback

**What goes wrong:** `navigator.vibrate()` is called for draft picks and bracket actions. It works perfectly on Android during development. On iOS (every browser, since all use WebKit), the API simply does not exist. If you build "haptic feedback" using only the Vibration API, 50%+ of your users get zero tactile feedback.

**Why it happens:** Apple has never implemented the Vibration API in WebKit and has shown no intention to. Every browser on iOS (Chrome, Firefox, Edge) uses WebKit under the hood, so none of them support it either.

**Consequences:** Half your users experience a feature-less app. Worse, if code assumes `navigator.vibrate` exists without feature detection, it throws a TypeError that could break the UI flow.

**Prevention:**
- Use the iOS Safari checkbox-switch hack: Safari 17.4+ introduced `<input type="checkbox" switch>` which triggers native haptic feedback when toggled. Libraries like `ios-haptics` (https://github.com/tijnjh/ios-haptics) wrap this pattern -- they create a hidden checkbox switch, programmatically click its label, and remove it.
- Architecture must be: try `navigator.vibrate()` on Android, fall back to checkbox-switch trick on iOS 17.4+, silently no-op on older iOS.
- Always feature-detect: `if ('vibrate' in navigator)` for Android path; user-agent sniff for iOS checkbox-switch path.

**Detection:** Test on a real iPhone. Simulators do not produce haptic output. If you only test in Chrome DevTools mobile emulation, you will miss this entirely.

**Confidence:** HIGH -- verified via MDN, caniuse, multiple sources. Vibration API has never shipped in WebKit.

**Phase:** Must address in the very first implementation of haptic feedback. Not deferrable.

---

### Pitfall 2: Service Worker Scope Conflict -- Firebase Messaging SW vs Existing PWA SW

**What goes wrong:** The app already registers `sw.js` at `/madness/sw.js` for offline caching. Firebase Cloud Messaging (FCM) expects to register its own `firebase-messaging-sw.js` at the root. You cannot have two service workers controlling the same scope. If you add FCM naively, one of two things happens: (a) FCM registers its SW at the root `/` and it cannot control pages under `/madness/`, or (b) you get a scope conflict where push notifications arrive but the existing cache-first strategy breaks.

**Why it happens:** A service worker's default scope is its directory. The existing `sw.js` lives at `/madness/sw.js` so its scope is `/madness/`. FCM by default looks for `/firebase-messaging-sw.js` at the domain root. GitHub Pages does not let you set `Service-Worker-Allowed` headers to broaden scope. The monorepo structure (stoekmedia.com with `/madness` as a subdirectory) makes this worse.

**Consequences:** Push notifications silently fail to register, or the existing offline caching breaks. Both are invisible failures -- no errors in the UI, just missing functionality.

**Prevention:**
- Merge FCM messaging logic INTO the existing `sw.js`. Import Firebase scripts via `importScripts()` at the top of `sw.js`. Handle both caching and messaging in one service worker file.
- Register FCM to use the existing SW: `const registration = await navigator.serviceWorker.register('sw.js'); const messaging = getMessaging(); messaging.useServiceWorker(registration);` (or the v9+ equivalent using `getToken({ serviceWorkerRegistration: registration })`).
- Place `sw.js` inside `/madness/` (where it already is). Do NOT attempt to place `firebase-messaging-sw.js` at the domain root; it will not control the `/madness/` scope on GitHub Pages.
- The `sw.js` fetch handler must pass through FCM-related network requests (add `fcm.googleapis.com` and `fcmregistrations.googleapis.com` to the passthrough list alongside the existing Firestore exclusions).

**Detection:** After implementation, check `chrome://serviceworker-internals` or DevTools > Application > Service Workers. You should see exactly ONE service worker for scope `/madness/`. If you see two, or if the scope is wrong, push will fail.

**Confidence:** HIGH -- this is a well-documented Firebase issue (firebase/firebase-js-sdk#2831, angular/angularfire#1870). The existing `sw.js` at `/madness/sw.js` confirms the scope constraint.

**Phase:** Must be resolved before any push notification work begins. This is architectural -- getting it wrong means rework.

---

### Pitfall 3: iOS Push Notifications Require Home Screen Installation AND User Gesture -- Double Gate

**What goes wrong:** Push notifications are implemented and tested on Android/Desktop. On iOS, they silently do nothing. The permission prompt never appears, `Notification.requestPermission()` resolves to "denied" without showing any UI, and there is no error message.

**Why it happens:** iOS Safari has TWO mandatory prerequisites that no other platform requires:
1. The PWA MUST be installed to the home screen (added via Share > Add to Home Screen). Push is completely unavailable in Safari browser tabs.
2. The permission request MUST be triggered by a direct user gesture (tap/click). You cannot request on page load, on a timer, or in a promise chain detached from user interaction.
3. The manifest MUST include `"display": "standalone"` (already present -- good).

**Consequences:** Users who access the app via Safari bookmark or browser tab will never receive push notifications. There is no error, no prompt, just silence. If you do not actively guide users to install the PWA, push notifications become Android-only.

**Prevention:**
- Build an explicit "Install App" prompt that detects whether the app is running in standalone mode (`window.matchMedia('(display-mode: standalone)').matches` or `navigator.standalone` for iOS) and shows installation instructions if not.
- Gate the "Enable Notifications" button behind installation detection. Do not show it unless the app is installed.
- The notification permission request must be directly inside a click/tap event handler. No `setTimeout`, no `await` chains before it, no calling it from a Firestore listener callback.
- Provide clear onboarding: "To get draft turn alerts, first add this app to your home screen, then tap 'Enable Notifications'."

**Detection:** Test on a real iPhone with the app opened from a home screen icon. If you only test in Safari browser, push will appear to be broken even with correct code.

**Confidence:** HIGH -- verified via Apple Developer Documentation (https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) and multiple implementation guides.

**Phase:** Must be addressed at the start of push notification implementation. The UX flow (install -> enable) needs to be designed before writing any FCM code.

---

### Pitfall 4: Draft Timer Drift in Background Tabs -- setInterval Is Throttled to 1-Minute Resolution

**What goes wrong:** A draft clock counting down (e.g., 90 seconds per pick) uses `setInterval` or `setTimeout`. When a user switches to another tab or locks their phone, the browser aggressively throttles the timer. Chrome 88+ throttles chained timers in background tabs to fire at most once per minute. When the user returns, the displayed timer is wildly inaccurate -- it might show 45 seconds remaining when the server-side truth is that time expired 30 seconds ago.

**Why it happens:** Browsers throttle JavaScript timers in inactive tabs to save battery and CPU. Chrome throttles to 1-second minimum for basic cases, and 1-minute minimum for "chained" timers (timers that reschedule themselves). Safari and iOS have similar throttling. This is by design and cannot be disabled.

**Consequences:** The draft timer appears frozen or shows wrong values. Auto-pick fires at the wrong time (or never fires) on the client. If timer logic is purely client-side, different players see different remaining times, causing confusion about whose turn it is.

**Prevention:**
- Timer authority MUST be server-side (Firestore). Store `pickDeadline` as an absolute timestamp (`Date.now() + durationMs`) in Firestore, not as a countdown value.
- Client displays `Math.max(0, pickDeadline - Date.now())` on each render tick. When the user returns to the tab, the next render immediately shows the correct remaining time.
- Use the Page Visibility API (`document.visibilitychange` event) to force an immediate re-render and Firestore re-sync when the tab becomes visible again.
- Auto-pick enforcement MUST happen server-side (Firebase Cloud Function or Firestore security rule with timestamp check), never purely on the client. A client-side-only auto-pick will fail if the picker's phone is locked.
- For the visual countdown, use `requestAnimationFrame` or a 1-second `setInterval` that recalculates from the absolute deadline each tick (self-correcting). Do NOT use an accumulator pattern (`remaining -= 1`).

**Detection:** Open the draft on two devices. Switch one to a background tab for 30+ seconds. Compare displayed timers when you return. If they diverge by more than 2 seconds, the timer architecture is wrong.

**Confidence:** HIGH -- browser timer throttling is well-documented (https://developer.chrome.com/blog/timer-throttling-in-chrome-88). The existing app has no timer logic yet, so this is a design-time decision.

**Phase:** Must be resolved during draft clock architecture design, before implementation. Getting this wrong means re-architecting the timer later.

---

### Pitfall 5: Cache-First Service Worker Serves Stale App on Tournament Day

**What goes wrong:** The existing `sw.js` uses a cache-first strategy: if a resource is cached, it returns the cached version and never hits the network. When you push a critical bug fix or feature during the tournament (when every minute counts), users' installed PWAs continue serving the old cached `index.html`. They have to manually clear the cache or wait for the service worker lifecycle to update.

**Why it happens:** The current `sw.js` calls `self.skipWaiting()` on install, which activates the new SW immediately. But the fetch handler still serves from cache first. The single-file architecture means `index.html` IS the entire app -- and it is cached. The SW only updates when the browser decides to check for updates (typically every 24 hours, or on page load for some browsers). During a live draft, users may have the app open for hours without a page load trigger.

**Consequences:** Users are stuck on an old version of the app during the most critical period (tournament games in progress). Bug fixes do not propagate. Features deployed after Selection Sunday may not reach users before their draft.

**Prevention:**
- Switch to a network-first strategy for `index.html` (the app shell). Cache-first is fine for static assets (icons, Firebase SDK).
- Implement a version check: embed a version string in the app, check it against a Firestore field or a tiny version file. If mismatched, show "Update available -- tap to refresh" and call `registration.update()` + `location.reload()`.
- For the SPA, add a visibility change listener that calls `registration.update()` when the tab regains focus, ensuring the SW checks for updates frequently during active use.
- Bump the `CACHE_NAME` version string (`mm-draft-v3` -> `mm-draft-v4`) with every deployment so the activate handler cleans old caches.

**Detection:** Deploy a change, then check if an already-open PWA instance picks it up within 60 seconds. If it does not, the cache strategy needs fixing.

**Confidence:** HIGH -- directly observed from reading the existing `sw.js` which uses cache-first for all requests.

**Phase:** Must be fixed before deploying any new features. Otherwise every subsequent feature deployment is unreliable.

---

## Moderate Pitfalls

Issues that cause degraded experience on some platforms but do not break core functionality.

---

### Pitfall 6: Web Share API Puts Text in Clipboard Instead of Sharing URL on iOS

**What goes wrong:** You call `navigator.share({ title: 'Join my draft', text: 'Room code: ABC123', url: 'https://stoekmedia.com/madness?room=ABC123' })`. On iOS Safari, if you include both `text` and `url`, the `text` gets copied to the clipboard instead of being included in the share sheet alongside the URL. The shared content is not what you intended.

**Why it happens:** iOS Safari's Web Share implementation has a quirk where the `text` parameter competes with `url`. When both are present, behavior is inconsistent across iOS versions.

**Prevention:**
- Only pass `title` and `url` to `navigator.share()`. Encode any room code or context into the URL itself (query params or hash).
- Feature-detect with `navigator.canShare()` before calling `share()` to validate the data payload.
- Always provide a clipboard fallback: `if (navigator.share) { ... } else { navigator.clipboard.writeText(url) }`.
- Wrap the entire share call in try/catch -- users can cancel the share sheet, which throws an `AbortError`.

**Detection:** Test sharing on a real iPhone. Check what appears in the Messages or Notes app share target. If you see the text string instead of a clickable link, the parameters are wrong.

**Confidence:** MEDIUM -- documented by Jeremy Keith (https://adactio.com/journal/15972) and multiple developers. Behavior may vary by iOS version.

**Phase:** Address when implementing the share feature. Low risk of architectural rework.

---

### Pitfall 7: App Shortcuts Do Not Work on iOS -- Manifest Feature Is Android/Desktop Only

**What goes wrong:** You add a `shortcuts` array to `manifest.json` with entries for "Live Scores", "Bracket", and "Leaderboard". On Android and Desktop Chrome, long-pressing the app icon shows the shortcuts. On iOS, nothing happens -- the shortcuts are completely ignored.

**Why it happens:** Apple has not implemented the `shortcuts` manifest member in WebKit. There is no workaround. This is not a bug; it is a missing feature with no announced timeline.

**Prevention:**
- Implement shortcuts as progressive enhancement -- they add value on Android/Desktop but should not be a core navigation mechanism.
- Do not spend significant time on shortcut-specific UX. Add the manifest entries (they are just JSON) and move on.
- Consider Siri Shortcuts integration if iOS presence is critical (but this requires a different approach entirely and is likely out of scope).

**Detection:** Check caniuse.com or test on iOS. The shortcuts array is silently ignored.

**Confidence:** HIGH -- confirmed by firt.dev iOS PWA compatibility tracker and web.dev documentation.

**Phase:** Low-effort manifest change. No phase dependency. Can be added anytime.

---

### Pitfall 8: Wake Lock Silently Releases on Page Visibility Change

**What goes wrong:** You acquire a screen wake lock on the Live Scores tab to keep the screen on during games. The user switches to another app briefly (checks a text message), then comes back. The wake lock has been silently released. The screen now dims and locks during the game.

**Why it happens:** The Screen Wake Lock API automatically releases the lock when the page becomes hidden (the `visibilitychange` event fires with `document.visibilityState === 'hidden'`). This is spec behavior, not a bug. On iOS specifically, the Wake Lock API was broken in installed PWAs until iOS 18.4 (WebKit bug 254545).

**Consequences:** Users think the "keep screen on" feature is broken. Their screen dims during live game tracking. On older iOS versions (pre-18.4), it never works at all in installed PWAs.

**Prevention:**
- Listen for `visibilitychange` and re-acquire the wake lock when the page becomes visible again:
  ```javascript
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLockEnabled) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  });
  ```
- Feature-detect: `if ('wakeLock' in navigator)`. Provide a UI toggle so users can enable/disable it.
- Note in UI that iOS users need iOS 18.4+ for this feature. For older iOS, there is no workaround (the old NoSleep.js video hack no longer works reliably).

**Detection:** Acquire the lock, switch apps, come back, check if `wakeLock.released` is true. If so, re-acquisition logic is needed.

**Confidence:** HIGH -- this is documented spec behavior (https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API). The iOS fix in 18.4 is confirmed via WebKit bug tracker.

**Phase:** Address during Wake Lock implementation. Simple to get right if you know about it; easy to miss if you don't.

---

### Pitfall 9: Badge API Requires Notification Permission on iOS -- Silent Dependency

**What goes wrong:** You call `navigator.setAppBadge(1)` to show a badge when it is the user's turn to draft. On Android and Desktop, the badge appears without any special permission. On iOS, the badge silently does nothing -- no error, no badge.

**Why it happens:** On iOS, `setAppBadge()` requires that the user has granted notification permission. The API call succeeds (no error thrown), but the badge is not displayed unless `Notification.permission === 'granted'`. This is an iOS-specific requirement not present on other platforms.

**Consequences:** The "your turn" badge indicator works on Android but silently fails on iOS for users who have not enabled notifications. Since the API does not throw an error, you will not detect this in error monitoring.

**Prevention:**
- Gate badge updates behind a notification permission check: only call `setAppBadge()` after confirming `Notification.permission === 'granted'`.
- Bundle the badge feature with push notifications in the UX flow. When users enable notifications, badge becomes available as a bonus.
- Provide an alternative "your turn" indicator for users without notification permission (e.g., a prominent in-app banner, tab title change with `document.title`).

**Detection:** Test on iOS with notification permission denied. Call `setAppBadge(1)` and check the home screen. The badge will not appear.

**Confidence:** HIGH -- documented by WebKit blog (https://webkit.org/blog/14112/badging-for-home-screen-web-apps/) and MDN browser-compat-data issue #19300.

**Phase:** Address alongside push notification implementation. The permission dependency means these two features share a prerequisite.

---

### Pitfall 10: Firebase Cloud Functions Required for Server-Side Push -- GitHub Pages Cannot Send Pushes

**What goes wrong:** You implement the client-side FCM token registration and notification handling. But push notifications need a server to call the FCM HTTP API with the token and payload. GitHub Pages is static hosting. There is no server to trigger pushes.

**Why it happens:** Push notifications are a server-to-client architecture. The client registers for a token, but something server-side must call `admin.messaging().send()` with that token when an event occurs (draft turn, game final). GitHub Pages cannot run server-side code.

**Consequences:** Client-side FCM setup works. Tokens are generated. But no notifications ever arrive because nothing triggers them.

**Prevention:**
- Deploy Firebase Cloud Functions (the `functions/` directory already exists in the stoekmedia repo root) to handle push triggers.
- Use Firestore triggers: a Cloud Function listens for writes to draft state documents. When `currentPickerIndex` changes, the function looks up the next player's FCM token and sends a push.
- CORS configuration is needed for any HTTP-callable functions. The origin will be `stoekmedia.com`, not a Firebase Hosting domain. Use `cors({ origin: 'https://stoekmedia.com' })` or a wildcard during development.
- Budget for Cloud Functions billing: the Blaze (pay-as-you-go) plan is required. The free Spark plan does not support Cloud Functions deployment as of 2024. For 10-20 rooms, costs will be negligible (well under $1/month).

**Detection:** After FCM client setup, check Firebase Console > Cloud Messaging. If tokens are registered but no messages are sent, the server-side trigger is missing.

**Confidence:** HIGH -- Firebase architecture is well-documented. The existing `functions/` directory in the monorepo suggests Cloud Functions are already partially set up.

**Phase:** Must be planned early. Cloud Functions deployment and testing adds significant scope. Do not treat push notifications as a client-only feature.

---

## Minor Pitfalls

Issues that cause minor friction or require small fixes.

---

### Pitfall 11: Clipboard API Fails Without HTTPS or User Gesture on Some Browsers

**What goes wrong:** The clipboard fallback for Web Share (`navigator.clipboard.writeText()`) fails silently or throws on some browsers when not in a secure context or not triggered by a user gesture.

**Prevention:**
- Ensure clipboard calls are inside click event handlers.
- GitHub Pages serves over HTTPS, so secure context is satisfied.
- Wrap in try/catch and show a manual "copy this text" fallback if both `share()` and `clipboard.writeText()` fail.

**Confidence:** MEDIUM -- clipboard API restrictions are browser-specific and vary by version.

**Phase:** Address alongside Web Share implementation.

---

### Pitfall 12: manifest.json `start_url` Relative Path May Break Shortcuts

**What goes wrong:** The current manifest has `"start_url": "."` which is relative. App shortcuts URLs must resolve correctly relative to the manifest location. If the manifest is fetched from a different path context, shortcuts may open the wrong URL.

**Prevention:**
- Use explicit relative paths for shortcuts that match the SPA's hash-based or query-param-based navigation: `"url": "./?tab=scores"`, `"url": "./?tab=bracket"`.
- Test each shortcut URL by navigating to it directly and confirming the correct tab opens.

**Confidence:** MEDIUM -- depends on how the SPA handles routing.

**Phase:** Address when adding shortcuts to the manifest.

---

### Pitfall 13: iOS Safari Fetches Manifest Only at Add-to-Home-Screen Time

**What goes wrong:** You update `manifest.json` with new shortcuts, icons, or display settings. Users who already installed the PWA never see the changes because iOS Safari only reads the manifest at installation time.

**Prevention:**
- Get the manifest right BEFORE the tournament starts and users install the app.
- Changes to manifest after installation require users to remove and re-add the PWA on iOS.
- On Android, manifest changes are picked up more frequently but still not immediately.

**Detection:** Install the PWA, change the manifest, check if the installed app reflects changes. On iOS, it will not.

**Confidence:** HIGH -- documented iOS behavior.

**Phase:** All manifest changes (shortcuts, display_override, icons) must ship before Selection Sunday when users will install the app.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Severity |
|-------------|---------------|------------|----------|
| Haptic Feedback | Vibration API absent on iOS (#1) | Implement checkbox-switch hack for iOS, `navigator.vibrate()` for Android | Critical |
| Draft Timer | Background tab throttling (#4) | Server-authoritative timestamps, Visibility API re-sync | Critical |
| Push Notifications | iOS double-gate: install + gesture (#3) | Installation detection + guided onboarding flow | Critical |
| Push Notifications | No server to send pushes (#10) | Firebase Cloud Functions with Firestore triggers | Critical |
| Push Notifications | Service worker scope conflict (#2) | Merge FCM into existing sw.js | Critical |
| Service Worker | Stale cache during tournament (#5) | Network-first for index.html, version check | Critical |
| Web Share | iOS text/url parameter quirk (#6) | Only pass title + url, encode room in URL | Moderate |
| App Shortcuts | Not supported on iOS (#7) | Progressive enhancement only, minimal effort | Low |
| Wake Lock | Releases on visibility change (#8) | Re-acquire on visibilitychange event | Moderate |
| Badge API | Needs notification permission on iOS (#9) | Gate behind permission check, bundle with push | Moderate |
| Manifest | iOS reads manifest only at install (#13) | Ship all manifest changes before Selection Sunday | Moderate |

## Architecture-Specific Risks

The single-file `index.html` architecture creates a compounding risk: because the entire app is one cached file, a stale cache means the ENTIRE app is stale. There is no way to update just one component. This makes the cache strategy pitfall (#5) especially critical. Every feature added increases the stakes of a cache miss.

The `/madness` subdirectory deployment on GitHub Pages constrains service worker scope. You cannot set custom HTTP headers on GitHub Pages, which rules out the `Service-Worker-Allowed` header workaround. All service worker files MUST live inside `/madness/`. This is not negotiable with this hosting setup.

## Timeline-Specific Risks

With Selection Sunday days away:
- Manifest changes must be finalized FIRST (users will install the PWA this weekend)
- Push notification infrastructure (Cloud Functions) has the longest lead time and should start immediately
- Features that do not work on iOS (shortcuts, vibration without hack) should be deprioritized in favor of features that work everywhere
- The cache strategy fix (#5) should ship before any new features, or those new features may never reach users

## Sources

- Apple Developer Documentation: Web Push Notifications - https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- WebKit Blog: Badging for Home Screen Web Apps - https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
- Chrome Blog: Timer Throttling in Chrome 88 - https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- MDN: Screen Wake Lock API - https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- MDN: Vibration API - https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API
- WebKit Bug 254545: Wake Lock in Home Screen Web Apps - https://bugs.webkit.org/show_bug.cgi?id=254545
- Firebase JS SDK Issue #2831: FCM in Subdirectory - https://github.com/firebase/firebase-js-sdk/issues/2831
- ios-haptics library - https://github.com/tijnjh/ios-haptics
- Jeremy Keith: Web Share API in Safari on iOS - https://adactio.com/journal/15972
- firt.dev: iOS PWA Compatibility - https://firt.dev/notes/pwa-ios/
- Firebase Documentation: Use Firebase in a PWA - https://firebase.google.com/docs/web/pwa
- MDN Browser-Compat-Data Issue #19300: Safari setAppBadge - https://github.com/mdn/browser-compat-data/issues/19300
