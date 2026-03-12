---
phase: 03-badge-push-notifications
plan: 02
subsystem: infra
tags: [cloud-functions, firebase-admin, fcm, push-notifications, firestore-triggers]

# Dependency graph
requires:
  - phase: 03-badge-push-notifications
    plan: 01
    provides: "FCM client token storage in rooms/{roomId}/fcmTokens/{playerId}"
provides:
  - "Cloud Function: notifyDraftTurn triggered on room document updates"
  - "Firebase Cloud Functions project (functions/ directory with firebase-admin + firebase-functions)"
  - "Stale FCM token cleanup on delivery failure"
affects: [03-03]

# Tech tracking
tech-stack:
  added: [firebase-admin 12.x, firebase-functions 6.x, onDocumentUpdated v2 trigger]
  patterns: [data-only FCM multicast, stale token cleanup, JSON state parsing from Firestore]

key-files:
  created: [functions/index.js, functions/package.json, .gitignore]
  modified: []

key-decisions:
  - "Data-only FCM payload (data key, not notification key) for SW badge control"
  - "sendEachForMulticast for multi-device token delivery with per-token error handling"
  - "Stale token cleanup via FieldValue.arrayRemove on registration-token-not-registered"
  - "No writes to room document from Cloud Function (infinite loop prevention)"

patterns-established:
  - "Cloud Functions project in functions/ with Node 20 runtime"
  - "Firestore onDocumentUpdated trigger parses JSON state field to detect changes"
  - "FCM token cleanup pattern: check resp.error.code per token index, batch remove stale"

requirements-completed: [PUSH-05, PUSH-01]

# Metrics
duration: 4min
completed: 2026-03-12
---

# Phase 3 Plan 2: Cloud Functions Infrastructure + Draft Turn Push Summary

**notifyDraftTurn Cloud Function detects ds.cp changes on room updates and sends data-only FCM multicast to current drafter's devices with stale token cleanup**

## Performance

- **Duration:** 4 min (excludes checkpoint wait for deployment)
- **Started:** 2026-03-12T15:33:34Z
- **Completed:** 2026-03-12T16:07:32Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Cloud Functions project created with firebase-admin and firebase-functions dependencies (Node 20 runtime)
- notifyDraftTurn function triggers on rooms/{roomId} document updates and detects draft turn changes via ds.cp comparison
- Data-only FCM payload includes pick number, round number, and deep link URL for the service worker to construct notifications
- Stale FCM tokens automatically cleaned up on messaging/registration-token-not-registered errors via FieldValue.arrayRemove
- Function deployed successfully to march-madness-snake-draft (us-central1) and verified live in Firebase Console

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Cloud Functions project and deploy draft turn notification** - `45827d0` (feat)
2. **Task 2: Deploy Cloud Functions and verify draft turn notification** - Checkpoint: user deployed via `firebase deploy --only functions` (verified live)

## Files Created/Modified
- `functions/index.js` - Cloud Function: notifyDraftTurn (onDocumentUpdated trigger on rooms/{roomId})
- `functions/package.json` - Node.js project with firebase-admin and firebase-functions dependencies
- `functions/package-lock.json` - Locked dependency tree (239 packages)
- `.gitignore` - Excludes functions/node_modules/ and functions/.eslintrc.js

## Decisions Made
- Used data-only FCM payload (data key only, no notification key) so the service worker can control badge count and notification display
- sendEachForMulticast chosen over sendMulticast for per-token error response access needed by stale token cleanup
- Stale token cleanup writes only to fcmTokens subcollection (never to the room document) to prevent infinite trigger loops
- Node 20 runtime specified in package.json engines to match Firebase Cloud Functions supported runtime

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- npm warned about Node 25 engine mismatch vs engines.node=20 in package.json -- expected since local Node is newer than the Firebase runtime target; no impact on deployment

## User Setup Required

Deployment was completed during the checkpoint:
- **Blaze billing:** Verified/enabled for march-madness-snake-draft
- **Firebase CLI auth:** User logged in and deployed successfully
- **Deployment:** `firebase deploy --only functions` completed with notifyDraftTurn live in us-central1

## Next Phase Readiness
- Cloud Functions infrastructure is live and processing room document updates
- notifyDraftTurn will send push notifications when users grant notification permission (Plan 01) and have FCM tokens stored
- Plan 03 (game final and leaderboard notifications) shares the same functions/ directory and has already been merged
- All Phase 3 plans complete after this summary is filed

## Self-Check: PASSED

All files exist. All commits verified. All content checks pass.

---
*Phase: 03-badge-push-notifications*
*Completed: 2026-03-12*
