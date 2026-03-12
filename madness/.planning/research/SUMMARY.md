# Project Research Summary

**Project:** March Madness Snake Draft -- PWA Native Features
**Domain:** PWA progressive enhancement of an existing single-file vanilla JS sports draft app
**Researched:** 2026-03-11
**Confidence:** HIGH (stack and pitfalls verified against official specs; architecture grounded in existing codebase)

## Executive Summary

This project adds native-feeling PWA capabilities to an existing, working March Madness snake draft app: a ~3,500-line `index.html` backed by Firebase Firestore and hosted on GitHub Pages at `stoekmedia.com/madness`. The features divide cleanly into three tiers by complexity and risk. The first tier -- haptic feedback, native share, screen wake lock, app shortcuts, and manifest polish -- are pure progressive enhancement: zero backend dependencies, zero architectural risk, and can ship in a single day. The second tier is the draft clock: high value for the tournament experience, moderate complexity in getting Firestore-synced server-authoritative timestamps right, but entirely client-side. The third tier is push notifications via Firebase Cloud Messaging: genuinely transformative for re-engagement, but requiring backend infrastructure (Cloud Functions on the Blaze plan), service worker surgery, and platform-specific UX for iOS.

The recommended approach is to ship tiers one and two before Selection Sunday (when users install the PWA and begin drafting), and treat push notifications as a parallel workstream that can launch mid-tournament if ready. The single biggest architectural decision is the service worker: the app already has a `sw.js` at `/madness/` scope and Firebase's default FCM setup expects a separate `firebase-messaging-sw.js` at the domain root -- these cannot coexist. The correct solution is to extend the existing `sw.js` with FCM's `importScripts` handlers and pass the existing registration to `getToken()`. This decision must be made before any push work begins.

The two highest-consequence risks for the tournament timeline are: (1) the existing cache-first service worker will serve stale app code after any deployment -- this must be fixed to network-first for `index.html` before shipping any new features; and (2) iOS push notifications require the PWA to be installed to the home screen AND notification permission granted via a user gesture -- a UX flow must be designed around this double-gate or iOS users will never receive notifications. Every other pitfall has a straightforward mitigation documented in the research.

## Key Findings

### Recommended Stack

No new npm packages, bundlers, or build steps are needed. The existing CDN-based Firebase compat SDK pattern (v10.8.0) extends naturally: only one new CDN script is required -- `firebase-messaging-compat.js` -- to enable FCM on the client. All other features (Vibration, Web Share, Wake Lock, Badging, App Shortcuts) are native browser APIs with no dependencies. Cloud Functions introduce a Node.js server-side component (`functions/index.js`) that uses the Firebase Admin SDK, but this is isolated in a separate directory and does not touch the client-side architecture.

**Core technologies:**
- **Vibration API (`navigator.vibrate()`):** Haptic feedback on draft picks and timer events -- Android Chrome only; iOS Safari does not support it and never will; use feature detection + optional iOS checkbox-switch hack
- **Web Share API (`navigator.share()`):** Native OS share sheet for room invites -- progressive enhancement over existing clipboard copy; already works on iOS Safari 12.2+ and Chrome Android 61+
- **Screen Wake Lock API (`navigator.wakeLock.request()`):** Keeps screen on during Live Scores tab -- 94.6% global support as of Baseline 2025; must re-acquire on `visibilitychange`
- **Badging API (`navigator.setAppBadge()`):** "Your turn" badge on app icon -- iOS 16.4+ (installed PWA only) and desktop Chrome; Android gets badges automatically from push notifications
- **Firebase Cloud Messaging (FCM):** Push notifications for draft turns and game events -- requires Cloud Functions backend, VAPID key, and `firebase-messaging-compat.js` CDN addition; iOS requires installed PWA
- **Manifest `shortcuts` member:** Long-press app icon to jump to Live Scores, Bracket, Leaderboard -- JSON-only change, Chrome Android/Desktop only, iOS ignores silently
- **Manifest `display_override`:** Future-proof display mode fallback chain -- harmless on unsupported browsers
- **Firestore server timestamps:** Draft clock authority -- `clockExpAt` absolute timestamp in `S.ds`, not a decrementing counter; existing `onSnapshot` sync handles propagation

### Expected Features

**Must have (table stakes) -- ship before Selection Sunday:**
- **Draft clock / pick timer** -- every production fantasy draft platform enforces time pressure; without it the draft lacks urgency; configurable duration with visual countdown, color thresholds, auto-pick on expiry
- **Native share (Web Share API)** -- current clipboard-only feel is a workaround; mobile users reach for the OS share sheet instinctively; 10 lines of code with existing clipboard fallback preserved
- **Screen wake lock** -- Live Scores is a "lean back and watch" experience; screen dimming during games is a known frustration for sports apps; ~10 lines with `visibilitychange` re-acquisition

**Should have (differentiators) -- high value, low effort:**
- **Haptic feedback (Vibration API)** -- makes picks and bracket actions feel tactile on Android; degrades silently on iOS; one utility function, calls sprinkled at interaction points
- **App shortcuts (manifest.json)** -- direct entry points to Live Scores, Bracket, Leaderboard from long-press; JSON-only change; Android/Desktop only
- **Badge API** -- "your turn" badge on app icon during draft; pairs with draft clock; iOS requires notification permission first (silent dependency)
- **Enhanced manifest (display_override, maskable icons, `id` field)** -- polish for Android install experience; minimal effort

**Defer (post-launch or mid-tournament):**
- **Push notifications (FCM)** -- highest engagement value but requires Cloud Functions backend, Blaze plan, service worker surgery, FCM token storage in Firestore, and iOS-specific installation UX; estimated 2-3 days of work; does not affect the draft itself (unlike the timer)
- **iOS splash screen images** -- painful to generate (~20 device-specific PNGs); Android splash is automatic from manifest; not worth pre-tournament time

**Explicitly out of scope (anti-features):**
- Background Sync, Periodic Background Sync (iOS unsupported; Firestore offline persistence already handles this)
- Custom notification sounds (API not widely supported)
- Share Target (nothing meaningful to receive)
- `display: fullscreen` (hides status bar clock during timed draft)
- Aggressive install prompts (Chrome's timing is already optimized)

### Architecture Approach

The existing architecture is a clean unidirectional flow: global state `S` -> `render()` -> DOM -> user events -> mutate `S` -> `render()`, with `saveState()` debouncing Firestore writes and `onSnapshot` merging remote changes back into `S`. New features slot into this pattern via three integration categories. Client-only APIs (Vibration, Web Share, Wake Lock, Badge) are pure additions: utility functions that wrap browser APIs with feature detection and hook into existing event handlers. The draft clock extends `S.ds` with a `clockExpAt` absolute server timestamp and adds a targeted `setInterval` that updates only the clock DOM element -- never calling the full `render()` (which would flicker at 1Hz+). Push notifications are the only full-stack addition: they require modifying `sw.js` with FCM `importScripts` handlers, adding client-side FCM token management, creating a Firestore `rooms/{roomId}/tokens/{playerId}` subcollection, and deploying a `onDocumentUpdated` Cloud Function that reads the room's draft state and sends notifications when the current picker changes.

**Major components:**
1. **Haptic Module** -- wraps `navigator.vibrate()` with iOS feature detection; called from `pickTeam()`, bracket actions, nav buttons
2. **Share Module** -- wraps `navigator.share()` with clipboard fallback; replaces existing `copyRoomLink()` function
3. **Wake Lock Module** -- acquires/releases screen wake lock; hooked into `navigate()` and `visibilitychange`
4. **Draft Clock Module** -- extends `S.ds` with `clockExpAt` timestamp; targeted DOM updates via `setInterval(250ms)`; auto-pick on expiry using deterministic highest-seed logic; syncs via existing `saveState()` flow
5. **Push Permission Module** -- FCM token registration; writes tokens to Firestore subcollection; foreground message handling via in-app toast
6. **Badge Module** -- reads `S.ds` to determine if it is the current player's turn; called at end of `render()` and in `onSnapshot`
7. **Service Worker (`sw.js` extended)** -- adds FCM `importScripts`, `onBackgroundMessage`, and `notificationclick` handlers to existing cache-first logic
8. **Cloud Functions (`functions/index.js`)** -- `onDocumentUpdated` trigger sends FCM notifications when draft pick advances; read-only on room state; cleans up stale tokens

### Critical Pitfalls

1. **Cache-first SW serves stale app after every deployment** -- switch `index.html` to network-first strategy; add `registration.update()` on `visibilitychange`; bump `CACHE_NAME` on every deploy; ship this fix FIRST before any new features
2. **Service worker scope conflict (FCM vs existing sw.js)** -- merge FCM logic INTO existing `sw.js` via `importScripts`; pass existing registration to `getToken({ serviceWorkerRegistration: reg })`; never create a separate `firebase-messaging-sw.js` (GitHub Pages subdirectory constraint)
3. **iOS push requires installed PWA + user gesture -- double gate** -- build explicit installation detection (`window.matchMedia('(display-mode: standalone)')`); gate "Enable Notifications" button behind it; show guided onboarding before requesting permission
4. **Draft timer drifts in background tabs (setInterval throttled to 1-minute)** -- store `clockExpAt` as absolute Firestore server timestamp; compute remaining time as `clockExpAt - Date.now()` locally; re-sync on `visibilitychange`; enforce auto-pick server-side via Cloud Function
5. **Vibration API absent on iOS with no platform fallback** -- feature-detect with `'vibrate' in navigator`; optionally implement iOS 17.4+ checkbox-switch haptic hack for iOS path; treat vibration as Android-only enhancement
6. **iOS manifest only read at install time** -- finalize all manifest changes (shortcuts, icons, display_override) before Selection Sunday; changes after user installation require PWA reinstall on iOS

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation & Cache Fix
**Rationale:** The cache-first service worker bug means any feature shipped after this will not reliably reach users. This must be the first commit. Manifest polish is included here because iOS reads the manifest only at install time -- it must be correct before users install the app for the tournament.
**Delivers:** Reliable feature delivery pipeline; polished install experience; App Shortcuts on Android/Desktop
**Addresses:** Table stakes manifest requirements; App Shortcuts feature
**Avoids:** Pitfall 5 (stale cache), Pitfall 13 (iOS manifest freeze at install time), Pitfall 12 (shortcut URL routing)

### Phase 2: Client-Only PWA APIs (Low-Risk Enhancement Sprint)
**Rationale:** These features have zero backend dependencies, zero architectural risk, and complete progressive enhancement. They can be built and shipped in a single session. All are reversible with no downstream impact.
**Delivers:** Haptic feedback on draft picks; native OS share sheet for room invites; screen stays on during Live Scores
**Addresses:** Native Share (table stakes), Screen Wake Lock (table stakes), Haptic Feedback (differentiator)
**Avoids:** Pitfall 1 (iOS vibration -- feature detect only), Pitfall 6 (Web Share iOS text/url quirk -- pass title+url only), Pitfall 8 (wake lock releases on visibility -- re-acquire on visibilitychange)

### Phase 3: Draft Clock
**Rationale:** The draft timer is the single highest-value feature for the tournament experience. It requires careful architecture (server-authoritative timestamps, targeted DOM updates, deterministic auto-pick) but is entirely client-side. Should be built and stress-tested before draft day.
**Delivers:** Configurable countdown per pick; visual color thresholds; auto-pick on expiry; synchronized across all draft participants; haptic alert when time is low
**Addresses:** Draft Clock / Timer (table stakes)
**Avoids:** Pitfall 4 (background tab throttling -- absolute `clockExpAt` timestamp), Anti-pattern of calling `render()` for clock updates (use targeted DOM updates only)
**Research flag:** Standard pattern for Firestore-synced timers; no additional research needed

### Phase 4: Badge API
**Rationale:** Badge depends on having draft clock state ("whose turn is it?") established in Phase 3. It is a small addition that pairs naturally with the clock. On iOS, badge silently requires notification permission -- this phase surfaces that dependency without needing full push infrastructure.
**Delivers:** "Your turn" badge on app icon when it is the player's turn during a draft
**Addresses:** Badge API (differentiator)
**Avoids:** Pitfall 9 (iOS badge requires notification permission -- gate behind `Notification.permission === 'granted'`; provide in-app "your turn" banner as fallback)

### Phase 5: Push Notifications (FCM + Cloud Functions)
**Rationale:** Highest complexity, longest lead time, only feature requiring new backend infrastructure and billing changes. Building this last protects the tournament timeline -- the draft can run without push notifications (phases 1-4 deliver a complete experience). Push is a re-engagement layer for users who step away from the app.
**Delivers:** "Your turn to pick" notifications when app is closed; game final notifications; badge on Android (from notifications); iOS re-engagement for installed PWA users
**Addresses:** Push Notifications (differentiator)
**Implements:** Service Worker extension, Cloud Functions backend, FCM token subcollection
**Avoids:** Pitfall 2 (SW scope conflict -- merge into existing sw.js), Pitfall 3 (iOS double-gate -- build installation detection + guided onboarding), Pitfall 10 (GitHub Pages cannot send pushes -- Cloud Functions required), Anti-pattern of storing FCM tokens in room state (use subcollection)
**Research flag:** This phase needs careful testing across iOS (installed PWA) and Android before declaring complete. iOS push behavior with FCM has platform-specific quirks that only surface on real devices.

### Phase Ordering Rationale

- **Cache fix must come before everything else** -- otherwise new features may not reach users who already have the PWA installed
- **Manifest must ship before Selection Sunday** -- iOS users install the app once; the manifest is frozen at that point
- **Client-only APIs before clock** -- zero-risk features build confidence in the deploy pipeline before the more complex timer work
- **Clock before badge** -- badge depends on the "whose turn is it?" state that the clock establishes
- **Push last** -- the only feature that requires a billing change, backend deployment, and new failure surfaces; deferring it protects the core tournament experience

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Push Notifications):** iOS FCM behavior with installed PWAs has edge cases that documentation alone does not fully capture. Real-device testing on iOS 16.4, 17.x, and 18.x required. The notification click handler ordering relative to FCM's own handlers is a known source of subtle bugs.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Service worker cache strategies and manifest spec are well-documented; the existing sw.js makes the changes clear
- **Phase 2 (Client APIs):** All three APIs have official MDN documentation with canonical implementation patterns
- **Phase 3 (Draft Clock):** Firestore server timestamp pattern for synchronized timers is a well-documented, officially recommended approach
- **Phase 4 (Badge):** Simple API with known platform constraints; documentation is authoritative

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs are W3C/WHATWG standardized; browser support verified via caniuse.com and MDN compat data; Firebase SDK version matches existing codebase |
| Features | HIGH | Table stakes and differentiators well-established by comparison to production fantasy draft platforms; anti-features clearly justified |
| Architecture | HIGH | Grounded in actual codebase inspection (line numbers, existing function names, existing Firestore schema); Cloud Functions pattern verified against official Firebase docs |
| Pitfalls | HIGH | All critical pitfalls verified against official sources (Apple Developer docs, Chrome blog, WebKit bug tracker, Firebase SDK issue tracker) |

**Overall confidence:** HIGH

### Gaps to Address

- **iOS Vibration (checkbox-switch hack):** The `ios-haptics` library approach is documented but its reliability across iOS versions is LOW confidence. Treat as a bonus enhancement, not a commitment. Feature-detect only for now.
- **Blaze plan upgrade:** Research confirms it is required for Cloud Functions but the current billing status of the Firebase project (`march-madness-snake-draft`) is unknown. Must be verified and upgraded before Phase 5 can begin.
- **VAPID key generation:** The VAPID key pair does not yet exist. Must be generated in Firebase Console before any FCM client code can be tested.
- **URL-param tab routing:** App Shortcuts require `?tab=scores` / `?tab=bracket` / `?tab=leaderboard` URL params to be handled on page load. Whether this routing already exists in the SPA needs verification in the codebase before shortcut URLs are finalized.
- **iOS 17.4+ Safari vibrate report:** A single unverified GitHub issue (March 2026) suggests `navigator.vibrate()` may have started working on the latest iOS Safari. Do not rely on this -- test on real device if iOS haptics are a priority.
- **`functions/` directory status:** PITFALLS.md notes a `functions/` directory exists in the stoekmedia repo root. Whether Cloud Functions are already partially configured (firebase.json, package.json, existing functions) needs verification before Phase 5 planning.

## Sources

### Primary (HIGH confidence)
- [MDN: Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)
- [MDN: Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [MDN: Badge API (setAppBadge)](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge)
- [MDN: Manifest shortcuts](https://developer.mozilla.org/en-US/docs/Web/Manifest/shortcuts)
- [MDN: display_override](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display_override)
- [Firebase: FCM Web Setup](https://firebase.google.com/docs/cloud-messaging/js/client)
- [Firebase: FCM for Safari](https://firebase.blog/posts/2023/08/fcm-for-safari/)
- [Firebase: Cloud Functions Firestore Triggers](https://firebase.google.com/docs/functions/firestore-events)
- [Firebase: Pricing (Blaze plan)](https://firebase.google.com/pricing)
- [Can I Use: Vibration](https://caniuse.com/vibration)
- [Can I Use: Wake Lock](https://caniuse.com/wake-lock)
- [Can I Use: Web Share](https://caniuse.com/web-share)
- [web.dev: Screen Wake Lock in all browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers)
- [Apple Developer: Web Push Notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [Chrome Blog: Timer Throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [WebKit Blog: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)

### Secondary (MEDIUM confidence)
- [web.dev: PWA Enhancements](https://web.dev/learn/pwa/enhancements)
- [Firebase SDK Issue #2831: FCM in Subdirectory](https://github.com/firebase/firebase-js-sdk/issues/2831)
- [Brainhub: PWA on iOS Limitations 2025](https://brainhub.eu/library/pwa-on-ios)
- [Jeremy Keith: Web Share API in Safari on iOS](https://adactio.com/journal/15972)
- [firt.dev: iOS PWA Compatibility](https://firt.dev/notes/pwa-ios/)
- [FanDraft: Draft Timer Duration Best Practices](https://fandraft.com/blog/on-the-clock-how-long-should-you-set-the-draft-pick-timer)

### Tertiary (LOW confidence)
- [GitHub Issue: navigator.vibrate() on iOS Safari (March 2026)](https://github.com/mdn/browser-compat-data/issues/29166) -- single unverified report; do not rely on this

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
