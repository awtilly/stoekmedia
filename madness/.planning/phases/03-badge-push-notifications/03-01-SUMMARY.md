---
phase: 03-badge-push-notifications
plan: 01
subsystem: notifications
tags: [fcm, pwa, badge-api, service-worker, push-notifications, firebase-messaging]

# Dependency graph
requires:
  - phase: 01-pwa-foundation
    provides: "Service worker (sw.js) and PWA manifest"
  - phase: 02-player-identity-draft-clock
    provides: "Player identity (getMyPlayerId), draft clock, pickTeam/autoPickHighestSeed functions"
provides:
  - "FCM service worker background message handler"
  - "FCM client token acquisition and Firestore storage"
  - "Badge API integration tied to draft turn state"
  - "Contextual notification permission prompt UX"
  - "Firebase CLI config for Cloud Functions deployment"
  - "Firestore rules for fcmTokens subcollection"
affects: [03-02, 03-03]

# Tech tracking
tech-stack:
  added: [firebase-messaging-compat 10.8.0, Badge API, Notification API]
  patterns: [data-only FCM payloads, token rotation on reconnect, contextual permission prompts]

key-files:
  created: [firebase.json, .firebaserc]
  modified: [sw.js, index.html, firestore.rules]

key-decisions:
  - "Data-only FCM payloads (not notification payloads) to allow SW badge control"
  - "VAPID_KEY left as empty placeholder -- user generates in Firebase Console"
  - "FCM token refreshed on every connectToRoom snapshot for rotation resilience"
  - "iOS non-standalone users see guided Home Screen install overlay instead of permission prompt"
  - "fcmTokens subcollection open read/write -- no Firebase Auth in sessionless PIN model"

patterns-established:
  - "FCM token stored per-player in rooms/{roomId}/fcmTokens/{playerId} with arrayUnion for multi-device"
  - "Badge API set/clear tied to draft state: badge=1 when user's turn, clear otherwise"
  - "Permission prompt shown at contextual moment (after join/claim), not on page load"
  - "localStorage flag mm4_notif_dismissed to respect prior dismissal"

requirements-completed: [BDGE-01, BDGE-02, PUSH-04, PUSH-06]

# Metrics
duration: 4min
completed: 2026-03-12
---

# Phase 3 Plan 1: FCM Client Infrastructure Summary

**FCM service worker handlers, Badge API turn indicator, and contextual notification permission prompt with iOS guided onboarding**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-12T15:24:28Z
- **Completed:** 2026-03-12T15:29:26Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Service worker handles FCM background messages with data-only payloads and notification click routing
- Badge API shows badge count of 1 when it is the user's turn to draft, clears on pick or turn change
- Contextual notification permission prompt appears after selfRegister() and claimPlayer() with iOS Home Screen guidance
- FCM token acquired on permission grant and stored in Firestore fcmTokens subcollection for Cloud Functions (Plan 02) to consume
- Firebase CLI config files created for march-madness-snake-draft project (functions deployment)
- Firestore rules updated to allow fcmTokens subcollection access

## Task Commits

Each task was committed atomically:

1. **Task 1: Firebase CLI config, service worker FCM integration, and FCM client token management** - `5ea9870` (feat)
2. **Task 2: Badge API integration, contextual permission prompt, and Firestore rules update** - `35dbc0b` (feat)

## Files Created/Modified
- `firebase.json` - Firebase CLI config with functions source and runtime
- `.firebaserc` - Default project binding to march-madness-snake-draft
- `sw.js` - FCM importScripts, onBackgroundMessage handler, notificationclick listener, cache bump to v5
- `index.html` - firebase-messaging-compat CDN, VAPID_KEY, initFCM(), onMessage handler, updateAppBadge(), showNotificationPrompt(), requestNotificationPermission(), notification prompt CSS
- `firestore.rules` - fcmTokens subcollection read/write rules

## Decisions Made
- Used data-only FCM payloads (not notification payloads) so the service worker can control badge count via setAppBadge in onBackgroundMessage
- Left VAPID_KEY as empty string placeholder -- user must generate in Firebase Console (documented in plan user_setup)
- FCM token refreshed on every connectToRoom snapshot callback to handle token rotation (per research Pitfall 6)
- iOS non-standalone users shown a guided overlay explaining Home Screen installation instead of a doomed permission request
- fcmTokens subcollection has open read/write access since there is no Firebase Auth (sessionless PIN model) and FCM tokens are non-sensitive opaque strings

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

External services require manual configuration before push notifications will work:
- **VAPID key:** Generate Web Push certificate key pair in Firebase Console -> Project Settings -> Cloud Messaging -> Web Push certificates. Replace the empty `VAPID_KEY` constant in index.html.
- **Blaze plan:** Verify or enable Blaze billing plan for march-madness-snake-draft (required for Cloud Functions in Plan 02).
- **Firestore rules deploy:** Run `firebase deploy --only firestore:rules` to push the updated fcmTokens rules.

## Next Phase Readiness
- FCM client infrastructure is complete and ready for Plan 02 (Cloud Functions) to send notifications
- FCM tokens will be stored in Firestore as users grant permission
- Badge API will work immediately once draft rooms are active
- Plan 02 can read fcmTokens subcollection and send data-only payloads that trigger the SW handlers built here

## Self-Check: PASSED

All files exist. All commits verified. All content checks pass.

---
*Phase: 03-badge-push-notifications*
*Completed: 2026-03-12*
