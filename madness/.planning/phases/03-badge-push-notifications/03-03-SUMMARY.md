---
phase: 03-badge-push-notifications
plan: 03
subsystem: notifications
tags: [fcm, cloud-functions, push-notifications, game-finals, leaderboard, firestore-triggers]

# Dependency graph
requires:
  - phase: 03-badge-push-notifications
    plan: 01
    provides: "FCM client infrastructure, token storage in fcmTokens subcollection, service worker handlers"
provides:
  - "Client-side game final detection writing to Firestore gameResults subcollection"
  - "notifyGameFinal Cloud Function triggered on gameResults creates"
  - "Leaderboard change detection comparing before/after rankings"
  - "cleanupStaleTokens shared helper for all notification functions"
  - "computeRankings server-side scoring mirror"
affects: []

# Tech tracking
tech-stack:
  added: [firebase-admin ^12.0.0, firebase-functions ^6.0.0]
  patterns: [onDocumentCreated triggers for write-once subcollections, client-side deduplication via Set, server-side ranking computation]

key-files:
  created: [functions/index.js, functions/package.json]
  modified: [index.html, firestore.rules]

key-decisions:
  - "gameResults subcollection is write-once (create-only Firestore rules) for natural idempotency"
  - "ESPN game ID used as Firestore doc ID to prevent cross-client duplicates"
  - "_reportedFinals Set prevents same-session duplicate writes from polling"
  - "onDocumentCreated trigger (not onDocumentUpdated) ensures exactly one notification per game final"
  - "Leaderboard notification only sent when rankings actually change (not on every game final)"
  - "cleanupStaleTokens extracted as shared helper used by both notifyDraftTurn and notifyGameFinal"
  - "notifyDraftTurn included in functions/index.js (from Plan 02 spec) since functions/ dir did not exist yet"

patterns-established:
  - "Write-once subcollection pattern: client writes doc with deterministic ID, Cloud Function triggers on create"
  - "rankingsBefore snapshot in client write enables server-side before/after comparison without reading prior state"
  - "Token validity filtering: only send follow-up notifications to tokens that succeeded on the first send"

requirements-completed: [PUSH-02, PUSH-03]

# Metrics
duration: 3min
completed: 2026-03-12
---

# Phase 3 Plan 3: Game Final & Leaderboard Push Notifications Summary

**Client-side game final detection with Firestore gameResults write-once subcollection triggering Cloud Functions for score and leaderboard-change push notifications to all room members**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T15:35:49Z
- **Completed:** 2026-03-12T15:38:51Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Client-side checkGameFinals() detects newly completed ESPN games involving room teams and writes to Firestore gameResults subcollection
- notifyGameFinal Cloud Function sends game final notifications with scores and upset indicators to all room members
- Leaderboard change detection compares before/after rankings and sends shake-up notification only when rankings shift
- Shared cleanupStaleTokens helper and computeRankings scoring mirror reused across all notification functions

## Task Commits

Each task was committed atomically:

1. **Task 1: Client-side game final detection and Firestore gameResults write** - `949b5eb` (feat)
2. **Task 2: Cloud Functions for game final and leaderboard change notifications** - `7fd6737` (feat)

## Files Created/Modified
- `index.html` - checkGameFinals() function, _reportedFinals deduplication Set, checkGameFinals() call in refreshLiveScores()
- `firestore.rules` - gameResults subcollection rules (create-only, no update/delete)
- `functions/index.js` - notifyGameFinal Cloud Function, computeRankings helper, cleanupStaleTokens shared helper, notifyDraftTurn function
- `functions/package.json` - Node.js project with firebase-admin and firebase-functions dependencies

## Decisions Made
- Used ESPN game ID as Firestore document ID for natural cross-client idempotency -- second set() call overwrites with same data
- gameResults subcollection has create-only rules (no update/delete) to enforce write-once semantics
- _reportedFinals in-memory Set prevents redundant writes within a single client session (30s polling)
- onDocumentCreated trigger (not onDocumentUpdated) guarantees exactly one function invocation per game result
- Leaderboard notification gated on actual ranking change -- prevents notification spam when game finals do not affect standings
- Token validity check filters follow-up leaderboard notification to only tokens that succeeded on game final send
- computeRankings server-side helper mirrors the client-side scores() function logic including upset bonus scoring

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created functions/ infrastructure (notifyDraftTurn from Plan 02)**
- **Found during:** Task 2 (Cloud Functions setup)
- **Issue:** Plan 03 assumes functions/index.js exists with notifyDraftTurn from Plan 02, but Plan 02 has not been executed yet (functions/ directory did not exist)
- **Fix:** Created functions/package.json, installed dependencies, and included notifyDraftTurn in functions/index.js alongside the new notifyGameFinal function. notifyDraftTurn was implemented per Plan 02 spec but refactored to use the shared cleanupStaleTokens helper
- **Files modified:** functions/index.js, functions/package.json, functions/package-lock.json
- **Verification:** All grep checks pass for both notifyDraftTurn and notifyGameFinal
- **Committed in:** 7fd6737 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to unblock Task 2 execution. The notifyDraftTurn function follows Plan 02's spec exactly, with the improvement of using the shared cleanupStaleTokens helper. When Plan 02 executes, it should skip functions/index.js creation since it already exists.

## Issues Encountered
None

## User Setup Required

Cloud Functions require deployment before notifications will work:
- **Blaze plan:** Verify or enable Blaze billing for march-madness-snake-draft in Firebase Console
- **Deploy functions:** Run `cd madness && firebase deploy --only functions` to deploy notifyDraftTurn and notifyGameFinal
- **Deploy Firestore rules:** Run `firebase deploy --only firestore:rules` to push the gameResults subcollection rules

## Next Phase Readiness
- All three notification types are now implemented: draft turn (Plan 02), game final, and leaderboard change (this plan)
- The complete notification pipeline is: client detects event -> writes to Firestore -> Cloud Function triggers -> FCM sends push -> service worker shows notification
- Deployment of Cloud Functions and Firestore rules is the only remaining step before notifications are live

## Self-Check: PASSED

All files exist. All commits verified. All content checks pass.

---
*Phase: 03-badge-push-notifications*
*Completed: 2026-03-12*
