---
phase: 03-badge-push-notifications
verified: 2026-03-12T17:00:00Z
status: human_needed
score: 11/12 must-haves verified
human_verification:
  - test: "Deploy Cloud Functions and verify notifyDraftTurn fires on draft turn"
    expected: "notifyDraftTurn and notifyGameFinal visible in Firebase Console Functions tab; push notification arrives on device when another player picks"
    why_human: "Deployment requires authenticated Firebase CLI with Blaze billing; SUMMARY says deployed but verifier cannot confirm remote Firebase state"
  - test: "Grant notification permission in a real browser, advance to a draft turn"
    expected: "FCM token is acquired and stored in Firestore under rooms/{roomId}/fcmTokens/{playerId}; app icon badge shows count of 1"
    why_human: "VAPID_KEY is an empty string placeholder -- token acquisition will silently fail until user fills it in from Firebase Console; Badge API requires real OS context"
  - test: "Open app on iOS device that has NOT added to Home Screen, join a room"
    expected: "iOS guided overlay appears explaining Share -> Add to Home Screen flow, not a broken permission request"
    why_human: "iOS standalone detection requires real device; cannot verify navigator.standalone behavior programmatically"
---

# Phase 3: Badge and Push Notifications Verification Report

**Phase Goal:** Badge notifications and push notifications for draft turns, game finals, and leaderboard changes
**Verified:** 2026-03-12T17:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | App icon badge appears when it is the user's turn to draft | VERIFIED | `updateAppBadge()` in index.html line 2298 calls `navigator.setAppBadge(1)` when `myId === ds.order[ds.cp]` |
| 2 | Badge clears when the user picks or their turn passes | VERIFIED | `updateAppBadge()` calls `navigator.clearAppBadge()` in else branch; called at end of `pickTeam()` (line 3613) and `autoPickHighestSeed()` (line 3770) |
| 3 | After joining a draft room, user sees a contextual prompt to enable notifications | VERIFIED | `showNotificationPrompt()` called at end of `selfRegister()` (line 2575) and `claimPlayer()` (line 2557); not on page load |
| 4 | Granting permission stores the FCM token in Firestore under rooms/{roomId}/fcmTokens/{playerId} | VERIFIED (code path exists) | `initFCM()` at line 2268 calls `messaging.getToken()` then `db.collection('rooms').doc(roomId).collection('fcmTokens').doc(myId).set()`; VAPID_KEY is empty string pending user setup |
| 5 | iOS users who have not installed the PWA see guided instructions before the permission prompt | VERIFIED | `showNotificationPrompt()` at line 2318 checks `isIOS && !isStandalone` and renders overlay with "add this app to your Home Screen" message |
| 6 | Cloud Functions deploy successfully to march-madness-snake-draft Firebase project | HUMAN NEEDED | Code passes all static checks; SUMMARY 03-02 claims successful deployment; cannot verify remote Firebase state programmatically |
| 7 | When the active drafter changes, the new drafter's devices receive a push notification | VERIFIED (code) | `notifyDraftTurn` in functions/index.js line 59 triggers on `onDocumentUpdated('rooms/{roomId}')`, compares `beforeDs.cp` vs `afterDs.cp`, sends to `currentDrafterId` only |
| 8 | The push notification includes pick number, round number, and a deep link | VERIFIED | Payload at line 88-97: `title: "You're on the clock!"`, body with `Pick #${pickNumber} (Round ${roundNumber})`, `url: /madness/?room=${roomId}` |
| 9 | Stale FCM tokens are automatically cleaned up when delivery fails | VERIFIED | `cleanupStaleTokens()` helper at line 38 removes tokens with `messaging/registration-token-not-registered`; used by both `notifyDraftTurn` and `notifyGameFinal` |
| 10 | When a game goes final, players receive a push notification with score and upset indicator | VERIFIED | `notifyGameFinal` at line 107 triggers on `onDocumentCreated('rooms/{roomId}/gameResults/{gameId}')`; builds `scoreText` and `upsetText`, sends to all player tokens |
| 11 | When game results change leaderboard rankings, affected players receive a shake-up notification | VERIFIED | Lines 163-186 in functions/index.js: compares `rankingsBefore` with `computeRankings(state)`, sends 'Leaderboard Shake-up!' only when `rankingsChanged === true` |
| 12 | Notifications are only sent once per game final | VERIFIED | `onDocumentCreated` trigger (not `onDocumentUpdated`) fires exactly once per doc; ESPN game ID as Firestore doc ID prevents cross-client duplicates; `_reportedFinals` Set prevents duplicate client writes in same session |

**Score:** 11/12 truths verified (1 requires human confirmation for live deployment)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `firebase.json` | Firebase CLI config for march-madness-snake-draft functions | VERIFIED | Contains `functions.source: "functions"`, `functions.runtime: "nodejs20"`, and `firestore.rules` key |
| `.firebaserc` | Default Firebase project binding | VERIFIED | `{ "projects": { "default": "march-madness-snake-draft" } }` |
| `sw.js` | FCM background message handler and notification click handler | VERIFIED | `importScripts` for firebase-app-compat + firebase-messaging-compat at lines 2-3; `messaging.onBackgroundMessage()` at line 16; `notificationclick` handler at line 33; existing cache logic preserved; CACHE_NAME bumped to `mm-draft-v5` |
| `index.html` | Badge API, FCM token management, permission prompt UX, foreground handler | VERIFIED | `setAppBadge`/`clearAppBadge` in `updateAppBadge()`; `initFCM()` with token storage; `showNotificationPrompt()` with iOS handling; `onMessage` foreground toast handler; `firebase-messaging-compat.js` CDN script at line 1935 |
| `functions/index.js` | Cloud Functions: notifyDraftTurn, notifyGameFinal | VERIFIED | Both exports present; correct triggers (`onDocumentUpdated`/`onDocumentCreated`); helpers `computeRankings` and `cleanupStaleTokens` present |
| `functions/package.json` | Node.js project with firebase-admin and firebase-functions | VERIFIED | `firebase-admin: ^12.0.0`, `firebase-functions: ^6.0.0`, `engines.node: "20"` |
| `firestore.rules` | fcmTokens and gameResults subcollection rules | VERIFIED | `match /fcmTokens/{playerId}` with `allow read, write: if true`; `match /gameResults/{gameId}` with `allow read, create: if true`, `allow update, delete: if false` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `index.html` | `sw.js` | `getToken({ serviceWorkerRegistration: swReg })` | VERIFIED | Line 2273: `messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg })` |
| `index.html` | Firestore `fcmTokens` subcollection | `db.collection('rooms').doc(roomId).collection('fcmTokens')` | VERIFIED | Line 2277 in `initFCM()`: exact path wired with `arrayUnion` merge |
| `sw.js` | `firebase-messaging-compat.js` | `importScripts` | VERIFIED | Line 3: `importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js')` |
| `functions/index.js` | Firestore `rooms/{roomId}` | `onDocumentUpdated` trigger | VERIFIED | Line 59: `onDocumentUpdated('rooms/{roomId}', ...)` |
| `functions/index.js` | Firestore `rooms/{roomId}/fcmTokens/{playerId}` | `getFirestore().doc()` read | VERIFIED | Line 80-81: `db.doc('rooms/.../fcmTokens/${currentDrafterId}').get()` |
| `functions/index.js` | FCM delivery | `getMessaging().sendEachForMulticast()` | VERIFIED | Lines 99, 159, 184: three separate `sendEachForMulticast` calls |
| `index.html` | Firestore `rooms/{roomId}/gameResults/{gameId}` | `db.collection('rooms').doc(roomId).collection('gameResults').doc(game.id).set()` | VERIFIED | Lines 2158-2160 in `checkGameFinals()` |
| `functions/index.js` | Firestore `rooms/{roomId}/gameResults/{gameId}` | `onDocumentCreated` trigger | VERIFIED | Line 107: `onDocumentCreated('rooms/{roomId}/gameResults/{gameId}', ...)` |
| `functions/index.js` | Firestore `rooms/{roomId}/fcmTokens` collection | collection read for all player tokens | VERIFIED | Line 132: `db.collection('rooms/${roomId}/fcmTokens').get()` |
| `index.html` (`refreshLiveScores`) | `checkGameFinals()` | Direct call after liveScores update | VERIFIED | Line 2119: `checkGameFinals()` called inside `if (data)` block after `liveScores` assignment |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BDGE-01 | 03-01 | App icon badge shows pending pick count when it's user's turn to draft | SATISFIED | `updateAppBadge()` in index.html; `navigator.setAppBadge(1)` when `myId === ds.order[ds.cp]` |
| BDGE-02 | 03-01 | Badge clears when user makes their pick or turn passes | SATISFIED | `clearAppBadge()` in else branch of `updateAppBadge()`; called in `pickTeam()` and `autoPickHighestSeed()` |
| PUSH-01 | 03-02 | "It's your turn to draft" push notification when user's pick is up | SATISFIED | `notifyDraftTurn` Cloud Function with "You're on the clock!" payload |
| PUSH-02 | 03-03 | "Game just went final" notification with score and upset alert | SATISFIED | `notifyGameFinal` builds `scoreText` and `upsetText`, sends to all room members |
| PUSH-03 | 03-03 | "Leaderboard shake-up" notification when rankings change | SATISFIED | Leaderboard block in `notifyGameFinal` compares `rankingsBefore` vs `computeRankings(state)`; sends 'Leaderboard Shake-up!' only on change |
| PUSH-04 | 03-01 | FCM token management -- store per player per room in Firestore | SATISFIED | `initFCM()` stores tokens via `arrayUnion` in `rooms/{roomId}/fcmTokens/{playerId}` |
| PUSH-05 | 03-02 | Firebase Cloud Functions deployed for server-side push triggers | SATISFIED (code) / HUMAN NEEDED (deployment) | Code verified; SUMMARY claims live deployment to us-central1; cannot confirm without Firebase Console access |
| PUSH-06 | 03-01 | Contextual permission prompt (after joining draft, not on first visit) | SATISFIED | `showNotificationPrompt()` called only in `selfRegister()` and `claimPlayer()` callbacks; localStorage dismissal flag respected |

All 8 Phase 3 requirement IDs (BDGE-01, BDGE-02, PUSH-01, PUSH-02, PUSH-03, PUSH-04, PUSH-05, PUSH-06) are claimed by plans and have implementation evidence. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `index.html` | 2266 | `const VAPID_KEY = '';` with TODO comment | Warning | FCM token acquisition will silently fail with empty VAPID_KEY; `initFCM()` is guarded by `try/catch` with `console.warn` so no crash, but push tokens will not register until key is filled in |

Note: This is an intentional design decision documented in 03-01-PLAN.md `user_setup` section and in the SUMMARY. The VAPID_KEY must be generated in Firebase Console and is not a code defect -- it is an operator setup step. The `try/catch` guard means the app does not crash; it degrades gracefully to no-push-notifications mode.

---

### Human Verification Required

#### 1. Cloud Functions Live Deployment Confirmation

**Test:** Check Firebase Console -> march-madness-snake-draft -> Functions tab
**Expected:** `notifyDraftTurn` and `notifyGameFinal` both appear as active functions in us-central1
**Why human:** SUMMARY 03-02 reports successful `firebase deploy --only functions` via a checkpoint task, but the verifier cannot query the Firebase Console programmatically. If functions are not deployed, PUSH-01, PUSH-02, PUSH-03, and PUSH-05 are blocked.

#### 2. End-to-End Push Notification with VAPID Key

**Test:** Generate VAPID key from Firebase Console -> Project Settings -> Cloud Messaging -> Web Push certificates. Insert value into `VAPID_KEY` constant in index.html line 2266. Open app, join a room, grant notification permission.
**Expected:** FCM token stored in Firestore `rooms/{roomId}/fcmTokens/{playerId}`; have another player advance the draft; device receives "You're on the clock!" push notification
**Why human:** VAPID_KEY is empty string; token acquisition cannot complete without it; real device + real browser session required to test permission grant flow and badge display

#### 3. Badge API on Installed PWA

**Test:** Install the PWA on a device (Android or desktop Chrome), join a room as a drafter, have another player make a pick so it becomes your turn
**Expected:** App icon on home screen/taskbar shows a badge count of 1; badge clears after you pick
**Why human:** Badge API requires installed PWA context; cannot verify badge display programmatically; setAppBadge silently no-ops on unsupported platforms

#### 4. iOS Non-Installed PWA Guided Overlay

**Test:** Open the app in Safari on iOS without having added to Home Screen, join a room
**Expected:** Guided overlay appears with "add this app to your Home Screen" message and a "Got it" button; no broken permission request
**Why human:** iOS `navigator.standalone` detection requires real Safari on iOS; code logic verified correct but UI rendering and user flow need human eyes

---

### Gaps Summary

No blocking gaps. All code artifacts exist, are substantive, and are correctly wired. The phase goal is achieved at the code level.

The single warning is the intentional `VAPID_KEY = ''` placeholder, which is an operator setup step documented in the plan's `user_setup` section -- not a code defect. Push notifications will not fire until the user completes Firebase Console setup (VAPID key + Blaze billing + function deployment), but all the code to support them is correctly in place.

Human verification items focus on confirming the deployment checkpoint result and runtime behaviors that require real devices.

---

_Verified: 2026-03-12T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
