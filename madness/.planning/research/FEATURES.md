# Feature Landscape: PWA Enhancement for March Madness Draft App

**Domain:** Real-time multiplayer fantasy draft PWA with live scoring
**Researched:** 2026-03-11
**Mode:** Ecosystem (PWA native features in production)

---

## Table Stakes

Features users expect from a polished draft app that claims to be "native-feeling." Missing any of these makes the app feel incomplete or amateurish compared to ESPN, Yahoo Fantasy, or NFL.com draft experiences.

| Feature | Why Expected | Complexity | Browser Support | Notes |
|---------|-------------|------------|-----------------|-------|
| **Draft Clock / Timer** | Every fantasy draft platform has one. Users will not take the draft seriously without time pressure. NFL Fantasy, ESPN, Yahoo all enforce pick timers with auto-pick. | Medium | N/A (pure JS + Firestore) | Sync pattern is the hard part, not the UI |
| **Native Share (Web Share API)** | Users already share room links via clipboard. Native share sheets are what mobile users reach for instinctively. Current clipboard-only feels like a workaround. | Low | iOS Safari 12.2+, Chrome Android 61+, Edge 93+. Firefox desktop: NO | Progressive enhancement over existing clipboard fallback |
| **Screen Wake Lock** | Live Scores tab is a "lean back and watch" experience during games. Screen dimming during a game is a known frustration for sports apps. | Low | iOS Safari 16.4+, Chrome 85+, Firefox 126+, Edge 90+. 94.6% global coverage | Best cross-browser support of all features listed here |

### Draft Clock / Timer -- Deep Dive

**What production draft clocks do:**
- Configurable duration per pick (common defaults: 60s, 90s, 120s)
- Visual countdown with color changes at thresholds (green > yellow > red)
- Audio/visual alert when time is low (last 10 seconds)
- Auto-pick on expiry (highest available seed in this app's case)
- Option for "no clock" / untimed drafts
- Clock pauses or resets between picks
- All players see the same remaining time

**Sync pattern (Firestore):**
Store `pickDeadline` as a Firestore server timestamp (`FieldValue.serverTimestamp()` + duration offset). Each client calculates remaining time locally from `pickDeadline - Date.now()`. This avoids syncing decrements and handles app restarts gracefully. Time passes at the same rate on all clients, so a shared deadline is the correct abstraction -- not a shared "seconds remaining" counter.

**Auto-pick logic:**
When the timer expires, the picking client (or a Cloud Function) writes the auto-pick to Firestore. To avoid race conditions where multiple clients try to auto-pick, use a Firestore transaction or security rule that only allows the current drafter to write their pick. A simpler approach: let ANY client that detects expiry attempt the write, but use a Firestore transaction that checks the pick hasn't already been made.

**Confidence:** HIGH -- This is a well-understood pattern. Firestore server timestamps are designed for exactly this use case.

### Native Share -- Deep Dive

**What the Web Share API does in practice:**
- `navigator.share({ title, text, url })` triggers the OS-native share sheet
- On iOS: shows the standard share sheet with Messages, WhatsApp, AirDrop, etc.
- On Android: shows the system share intent picker
- Must be called from a user gesture (button click), not programmatically
- Returns a Promise that resolves on success, rejects on cancel or error

**Implementation pattern:**
```javascript
async function shareRoom(roomCode) {
  const shareData = {
    title: 'March Madness Draft',
    text: `Join my draft room: ${roomCode}`,
    url: `${location.origin}/madness/?room=${roomCode}`
  };

  if (navigator.share && navigator.canShare(shareData)) {
    await navigator.share(shareData);
  } else {
    // Existing clipboard fallback
    await navigator.clipboard.writeText(shareData.url);
  }
}
```

**Confidence:** HIGH -- This API is mature, well-documented, and the existing clipboard fallback means this is pure progressive enhancement.

### Screen Wake Lock -- Deep Dive

**Production usage pattern:**
- Acquire lock when entering Live Scores tab
- Release lock when leaving the tab
- Re-acquire on `visibilitychange` event (lock auto-releases when tab loses focus)
- Wrap in try/catch -- system can reject (battery saver, low battery)
- Feature-detect with `if ('wakeLock' in navigator)`

**Key gotcha:** The lock is automatically released when the document becomes hidden (user switches tabs/apps). You MUST listen for `visibilitychange` and re-acquire. This is the most commonly missed implementation detail.

```javascript
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) {
      // System refused (battery saver, etc.) -- fail silently
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) {
    requestWakeLock();
  }
});
```

**Confidence:** HIGH -- Excellent browser support (94.6% global), simple API, well-documented pattern.

---

## Differentiators

Features that set this app apart from a basic bracket pool. Not expected, but make the experience feel premium and native.

| Feature | Value Proposition | Complexity | Browser Support | Notes |
|---------|-------------------|------------|-----------------|-------|
| **Haptic Feedback (Vibration API)** | Makes draft picks, bracket advances, and scoring events feel tactile. A 27% increase in form completion was reported from one case study using haptics. | Low | Chrome Android: YES. **iOS Safari: NOT SUPPORTED.** | Android-only enhancement. Must degrade silently on iOS. |
| **App Shortcuts (manifest.json)** | Long-press app icon shows "Live Scores", "My Bracket", "Leaderboard" -- direct entry points. Saves taps during the tournament. | Low | Chrome Android: first 3 shown. Chrome desktop: first 10. **iOS Safari: NOT SUPPORTED.** | Android/desktop only. Zero iOS benefit. |
| **Enhanced Splash Screen** | Better branding on app launch. Android uses manifest values automatically. iOS requires proprietary `apple-touch-startup-image` link tags. | Medium | Android: automatic from manifest. iOS: manual `<link>` tags per device resolution. | iOS implementation is painful -- many device sizes to cover. |
| **Badge API** | "Your turn" badge on the app icon during drafts. Pulls users back when it's their pick. | Low-Medium | Chrome desktop: YES. iOS Safari 16.4+: YES (home screen PWA only). Android: automatic from notifications, API ignored. | On Android, badges come from unread notifications, not the Badge API. |
| **Push Notifications (FCM)** | "It's your turn to pick!", "Game final: Duke 72 - UNC 68", "You moved to 1st place!" -- re-engagement when app is closed. | High | Chrome: YES. iOS Safari 16.4+: YES (home screen PWA only, must request after user interaction). Android: YES. | Requires Firebase Cloud Functions (backend). Highest complexity feature. |

### Haptic Feedback -- Deep Dive

**Critical finding: iOS Safari does NOT support the Vibration API.** WebKit removed it. There was a recent (March 2026) report suggesting `navigator.vibrate()` may have started working on the latest iOS Safari, but this is unverified from a single GitHub issue. Do NOT rely on this.

**What to implement (Android Chrome only):**

| Event | Vibration Pattern | Feel |
|-------|-------------------|------|
| Draft pick made (your pick) | `navigator.vibrate(50)` | Quick tap confirmation |
| Draft pick made (other player) | `navigator.vibrate(20)` | Subtle acknowledgment |
| Auto-picked (timer expired) | `navigator.vibrate([100, 50, 100])` | Urgent double-buzz |
| Bracket team advanced | `navigator.vibrate(30)` | Light confirmation |
| Game final score | `navigator.vibrate([50, 30, 50])` | Attention pattern |
| Your turn to draft | `navigator.vibrate([200, 100, 200, 100, 200])` | Insistent alert |

**Implementation:** Always feature-detect. Always make optional (users should be able to disable). Never use vibration as the sole feedback mechanism.

```javascript
function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
```

**Confidence:** HIGH that it works on Android Chrome. HIGH that it does NOT work on iOS Safari (verified via Can I Use). LOW confidence on the recent iOS report.

### App Shortcuts -- Deep Dive

**Manifest configuration:**
```json
{
  "shortcuts": [
    {
      "name": "Live Scores",
      "short_name": "Scores",
      "url": "/madness/?tab=scores",
      "icons": [{ "src": "/madness/icons/scores-192.png", "sizes": "192x192" }]
    },
    {
      "name": "My Bracket",
      "short_name": "Bracket",
      "url": "/madness/?tab=bracket",
      "icons": [{ "src": "/madness/icons/bracket-192.png", "sizes": "192x192" }]
    },
    {
      "name": "Leaderboard",
      "short_name": "Leaders",
      "url": "/madness/?tab=leaderboard",
      "icons": [{ "src": "/madness/icons/leaderboard-192.png", "sizes": "192x192" }]
    }
  ]
}
```

**Key constraints:**
- Maximum 4 shortcuts in the spec, but Chrome Android shows only the first 3
- URLs must be within the manifest scope
- 192x192 PNG icons recommended
- iOS Safari does not support manifest shortcuts at all
- Shortcuts only appear for installed PWAs (not browser tabs)

**Confidence:** HIGH -- Simple manifest-only change. Well-documented.

### Enhanced Splash Screen -- Deep Dive

**Android (easy):** Chrome auto-generates a splash screen from `name`, `background_color`, `theme_color`, and the 512x512 icon in manifest.json. Just ensure these are set correctly. The `display_override` member lets you specify a fallback chain (e.g., `["standalone", "minimal-ui"]`) but does not directly affect splash screens.

**iOS (painful):** Safari ignores the manifest for splash screens entirely. You must provide `apple-touch-startup-image` link tags with exact-resolution PNGs for every device size and orientation. This means generating images for ~20+ device configurations.

**Practical recommendation:** For the tournament deadline, focus on getting the Android splash right (manifest values only -- nearly zero effort) and use a splash screen generator tool for iOS images. Do NOT hand-craft iOS splash screens.

**`display_override` value:** For this app, `display_override: ["standalone"]` is sufficient. The `window-controls-overlay` and `tabbed` modes are experimental and irrelevant to a mobile-first sports app.

**Confidence:** MEDIUM -- Android is straightforward. iOS splash screen tooling works but is fragile across iOS updates.

### Badge API -- Deep Dive

**Platform behavior differs significantly:**

| Platform | Badge API Support | Behavior |
|----------|-------------------|----------|
| iOS Safari (home screen PWA) | Yes (16.4+) | `setAppBadge(count)` works. `setAppBadge(0)` clears badge. Does NOT show generic dot (spec deviation). |
| Chrome desktop (installed PWA) | Yes | Full spec support |
| Android Chrome | No | Android shows badges automatically from unread notifications. `setAppBadge()` is ignored. |

**This means:** On Android, the Badge API is irrelevant -- you get badges "for free" from push notifications. On iOS, you can use it independently of notifications to show "Your turn" status. On desktop, it works as expected.

**Implementation:**
```javascript
async function updateBadge(count) {
  if (navigator.setAppBadge) {
    if (count > 0) {
      await navigator.setAppBadge(count);
    } else {
      await navigator.clearAppBadge();
    }
  }
}
```

**When to badge:** When it becomes the user's turn to draft and they are not on the draft page. Clear when they make their pick or when their turn passes (auto-pick).

**Confidence:** MEDIUM -- Works but platform differences mean you cannot have a uniform experience. The iOS spec deviation (no generic dot) is a known issue.

### Push Notifications (FCM) -- Deep Dive

**This is the highest complexity feature on the list.** It requires:

1. **Firebase Cloud Functions** (backend) -- GitHub Pages cannot send push notifications. You need a server-side component to trigger notifications based on Firestore events.
2. **Service worker** (`firebase-messaging-sw.js`) -- Must be at the root of the PWA's scope. On GitHub Pages at `stoekmedia.com/madness/`, this means the service worker must be at `/madness/firebase-messaging-sw.js`.
3. **FCM token management** -- Each client registers for FCM and stores its token in Firestore. When a notification needs to be sent, the Cloud Function looks up the target user's token and sends via FCM Admin SDK.
4. **iOS-specific requirements:**
   - PWA must be installed to home screen
   - Permission can only be requested after user interaction
   - Uses Apple Push Notification service (APNs) under the hood
   - No Background Sync, so missed notifications are missed
5. **Notification permission UX** -- Never prompt on first visit. Wait until a contextual moment (e.g., user joins a draft, show "Get notified when it's your turn?").

**Notification triggers to implement:**

| Trigger | Message | Priority |
|---------|---------|----------|
| Your turn to draft | "You're on the clock! Pick #{N}" | High -- time-sensitive |
| Auto-picked for you | "Timer expired. {Team} was auto-picked for you." | Medium |
| Game final | "{Team1} {Score1} - {Team2} {Score2} (Final)" | Low |
| Leaderboard change | "You moved to #{position}!" | Low |

**Cloud Function architecture:**
- `onDocumentUpdated` trigger on the room's draft state document
- When `currentPicker` changes, send notification to the new picker
- Use FCM topic messaging per room for broadcast events (game finals, leaderboard)

**Confidence:** MEDIUM -- Well-documented pattern, but this is the only feature requiring backend infrastructure (Cloud Functions). Adds billing, deployment complexity, and a new failure surface. The iOS requirements add friction (must be installed PWA + user must grant permission after interaction).

---

## Anti-Features

Features to deliberately NOT build. These would waste time, add complexity, or degrade the experience.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Custom notification sounds** | Requires the Notification API's `sound` property which is not widely supported. Adds audio file hosting complexity for minimal benefit. | Use default system notification sounds. They are familiar and reliable. |
| **Background Sync for draft picks** | The Background Sync API is not supported on iOS Safari. Draft picks must be real-time anyway -- a queued background sync defeats the purpose of a live draft. | Use Firestore's built-in offline persistence. When connectivity returns, Firestore automatically syncs pending writes. |
| **Periodic Background Sync for live scores** | Not supported on iOS. Even on Android, requires the browser to grant periodic sync permission based on "site engagement score" -- unreliable. | Keep the existing 30-second auto-refresh on the Live Scores tab. Use push notifications for game finals. |
| **Share Target (receiving shared content)** | The app has nothing meaningful to do with incoming shared content. Being a share target adds manifest complexity and an edge case surface for no user value. | Only implement outbound sharing (Web Share API). |
| **Geolocation-based features** | No use case for location in a bracket pool app. Adding location permissions erodes trust. | Do not request any permissions beyond notifications (and only when contextually appropriate). |
| **Camera / media capture** | No use case. Would require permissions that feel invasive for a bracket pool. | N/A |
| **Full-screen mode (`display: fullscreen`)** | Sports apps need the status bar for time/battery. Fullscreen hides the clock, which matters during timed drafts. | Use `display: standalone` which keeps the status bar visible. |
| **Custom install prompt timing** | Aggressive install prompts annoy users. Chrome's default `beforeinstallprompt` timing is already optimized. | Let the browser handle install prompting. At most, add a subtle "Add to Home Screen" hint after the user has used the app for a session. |
| **Web Bluetooth / NFC** | No use case. | N/A |
| **Notification actions (action buttons)** | Limited browser support, complex to implement, and the notification click itself should open the relevant page. Action buttons add marginal value for significant complexity. | A single notification tap opens the draft/scores/leaderboard page directly. |

---

## Feature Dependencies

```
Draft Clock / Timer
  --> (no dependencies, standalone)
  --> (enables) Badge API ("your turn" badge)
  --> (enables) Push Notifications ("your turn" notification)
  --> (enables) Haptic Feedback (vibrate on auto-pick)

Native Share (Web Share API)
  --> (no dependencies, replaces existing clipboard sharing)

Screen Wake Lock
  --> (no dependencies, standalone)

Haptic Feedback
  --> (no dependencies, but most valuable when paired with Draft Clock events)

App Shortcuts
  --> (no dependencies, manifest-only change)
  --> (requires) tab routing via URL params (?tab=scores, ?tab=bracket, etc.)

Enhanced Splash Screen
  --> (no dependencies for Android -- manifest values only)
  --> (requires) iOS: apple-touch-startup-image generation tooling

Badge API
  --> (depends on) Draft Clock (needs "your turn" state to badge)
  --> (works independently of) Push Notifications on iOS
  --> (comes free with) Push Notifications on Android

Push Notifications (FCM)
  --> (depends on) Firebase Cloud Functions deployment
  --> (depends on) Service worker updates for firebase-messaging-sw.js
  --> (depends on) FCM token storage in Firestore per user
  --> (depends on) Draft Clock (for "your turn" triggers)
  --> (depends on) Live Scores data (for game final triggers)
```

**Critical path:** Draft Clock is the foundation. Badge API and Push Notifications both depend on knowing whose turn it is. Push Notifications require the most infrastructure (Cloud Functions).

---

## MVP Recommendation

**Prioritize for the 2026 tournament (days away):**

1. **Draft Clock / Timer** -- Table stakes. The single most impactful feature for the draft experience. Without it, the draft has no urgency. Pure client-side with Firestore server timestamps. No backend required.

2. **Native Share (Web Share API)** -- Table stakes. Trivial to implement (swap clipboard copy for `navigator.share()` with fallback). Immediate UX improvement for room sharing.

3. **Screen Wake Lock** -- Table stakes. ~10 lines of code. Prevents the most common complaint during live game viewing.

4. **Haptic Feedback** -- Differentiator but nearly zero effort. A single `haptic()` utility function sprinkled at key interaction points. Android-only but degrades silently.

5. **App Shortcuts** -- Differentiator with zero code changes. Manifest.json addition only. Requires URL-param-based tab routing (which may already exist).

**Defer to post-launch (or mid-tournament if time allows):**

6. **Enhanced Splash Screen** -- Android splash is likely already working from existing manifest values. iOS splash screen generation is a nice-to-have polish item, not worth the pre-tournament time.

7. **Badge API** -- Small effort but depends on the draft clock being complete. Implement alongside or just after the draft clock.

8. **Push Notifications (FCM)** -- Highest value differentiator but highest complexity. Requires Cloud Functions infrastructure, FCM token management, service worker updates, and iOS-specific permission handling. This is a post-launch feature unless Cloud Functions are already deployed and tested.

**Reasoning:** Features 1-5 can all be implemented in a single day by a solo developer. Features 6-8 add infrastructure complexity that risks destabilizing the app right before tournament time. Push notifications alone could take 2-3 days including Cloud Functions setup, testing across iOS and Android, and permission UX design.

---

## Browser Support Matrix (Summary)

| Feature | iOS Safari | Chrome Android | Chrome Desktop | Firefox |
|---------|-----------|---------------|----------------|---------|
| Draft Clock | Yes (JS) | Yes (JS) | Yes (JS) | Yes (JS) |
| Web Share API | 12.2+ | 61+ | 89+ (Windows/ChromeOS) | No (desktop), 79+ (Android) |
| Screen Wake Lock | 16.4+ | 85+ | 85+ | 126+ |
| Vibration API | **NO** | Yes | No (no hardware) | Yes |
| App Shortcuts | **NO** | Yes (3 max) | Yes (10 max) | No |
| Splash Screen | Manual `<link>` tags | Auto from manifest | N/A | N/A |
| Badge API | 16.4+ (PWA only) | No (use notifications) | Yes (installed PWA) | No |
| Push Notifications | 16.4+ (PWA only) | Yes | Yes | Yes |

**Key takeaway:** iOS Safari is the weakest link. Haptics and app shortcuts will be Android-only. Push notifications and badges require the PWA to be installed to the home screen on iOS. All features should be implemented with progressive enhancement -- feature-detect and degrade gracefully.

---

## Sources

### Official Documentation (HIGH confidence)
- [MDN: Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)
- [MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [MDN: Web Share API - Navigator.share()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- [MDN: Manifest shortcuts](https://developer.mozilla.org/en-US/docs/Web/Manifest/shortcuts)
- [MDN: Badge API - setAppBadge()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge)
- [MDN: display_override manifest member](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display_override)
- [Firebase: Cloud Messaging Web Setup](https://firebase.google.com/docs/cloud-messaging/web/get-started)
- [Firebase: Firestore Triggers for Cloud Functions](https://firebase.google.com/docs/functions/firestore-events)
- [Chrome Developers: Badging API](https://developer.chrome.com/docs/capabilities/web-apis/badging-api)
- [WebKit: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)

### Browser Support Data (HIGH confidence)
- [Can I Use: Vibration API](https://caniuse.com/vibration)
- [Can I Use: Wake Lock](https://caniuse.com/wake-lock)
- [Can I Use: Web Share](https://caniuse.com/web-share)

### Community / Industry Sources (MEDIUM confidence)
- [web.dev: PWA Enhancements](https://web.dev/learn/pwa/enhancements)
- [Brainhub: PWA on iOS - Current Status & Limitations 2025](https://brainhub.eu/library/pwa-on-ios)
- [MagicBell: PWA iOS Limitations and Safari Support](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Progressier: PWA Capabilities Demos](https://progressier.com/pwa-capabilities/vibration-api)
- [Pretius: PWA Push Notifications with FCM](https://pretius.com/blog/pwa-push-notifications)
- [FanDraft: Draft Timer Duration Best Practices](https://fandraft.com/blog/on-the-clock-how-long-should-you-set-the-draft-pick-timer)

### Unverified / LOW confidence
- [GitHub issue: navigator.vibrate() may now work on iOS Safari (March 2026)](https://github.com/mdn/browser-compat-data/issues/29166) -- Single report, unverified. Do not rely on this.
