---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
stopped_at: Completed 03-02-PLAN.md (all plans complete)
last_updated: "2026-03-12T16:14:34.945Z"
last_activity: 2026-03-12 -- Completed 03-02 (Cloud Functions Infrastructure + Draft Turn Push)
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 8
  completed_plans: 8
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** The draft and live scoring experience must feel like a native app -- instant, tactile, and always connected
**Current focus:** All phases complete

## Current Position

Phase: 3 of 3 (Badge & Push Notifications) -- COMPLETE
Plan: 3 of 3 in current phase -- COMPLETE
Status: All Phases Complete
Last activity: 2026-03-12 -- Completed 03-02 (Cloud Functions Infrastructure + Draft Turn Push)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 2min | 2 tasks | 3 files |
| Phase 01 P02 | 2min | 2 tasks | 1 files |
| Phase 02 P01 | 5min | 2 tasks | 1 files |
| Phase 02 P02 | 5min | 2 tasks | 1 files |
| Phase 02 P03 | 2min | 1 tasks | 1 files |
| Phase 03 P01 | 4min | 2 tasks | 5 files |
| Phase 03 P02 | 4min | 2 tasks | 3 files |
| Phase 03 P03 | 3min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Coarse granularity -- 3 phases (Foundation, Draft, Notifications)
- [Roadmap]: Foundation + client-only APIs grouped into Phase 1 (all zero-backend, ship before Selection Sunday)
- [Roadmap]: Auth + Draft Clock grouped into Phase 2 (identity is prerequisite for draft enforcement)
- [Roadmap]: Badge + Push grouped into Phase 3 (both are re-engagement; push requires backend; can ship mid-tournament)
- [Phase 01]: Reused icon-512.png as maskable icon (validate padding later)
- [Phase 01]: Live scores shortcut works without room context (tab is room-independent)
- [Phase 01]: Kept copyRoomLink() for backward compat, added shareRoomLink() with Web Share API
- [Phase 01]: Wake lock lifecycle tied to startLiveRefresh/stopLiveRefresh for all code paths
- [Phase 02]: Mandatory 4-digit PIN replaces optional passphrase for all players
- [Phase 02]: Legacy passphrase players migrated to PIN on next reclaim (one-time prompt)
- [Phase 02]: Name collision check prevents duplicate player names in selfRegister() and addPlayer()
- [Phase 02]: Removed S.phase = 'leaderboard' from claimPlayer -- render() handles tab routing naturally
- [Phase 02]: Absolute Firestore Timestamps for draft clock (pickDeadline) to survive background tab throttling
- [Phase 02]: Active drafter is primary auto-picker on expiry; 3-second fallback for other clients avoids race conditions
- [Phase 02]: Admin override preserved in pickTeam() -- adminUnlocked bypasses turn check
- [Phase 02]: 880Hz sine wave (A5) at 0.3 gain with 300ms decay for draft clock audio alert
- [Phase 02]: iOS haptic via hidden checkbox switch trick since Vibration API unsupported on iOS
- [Phase 02]: _beeped flag reset in all pick-transition functions for exactly one alert per turn
- [Phase 03]: Data-only FCM payloads (not notification payloads) to allow SW badge control
- [Phase 03]: VAPID_KEY left as empty placeholder -- user generates in Firebase Console
- [Phase 03]: FCM token refreshed on every connectToRoom snapshot for rotation resilience
- [Phase 03]: iOS non-standalone users see guided Home Screen install overlay instead of permission prompt
- [Phase 03]: fcmTokens subcollection open read/write -- no Firebase Auth in sessionless PIN model
- [Phase 03]: gameResults subcollection is write-once (create-only rules) with ESPN game ID as doc ID for idempotency
- [Phase 03]: onDocumentCreated trigger (not onDocumentUpdated) for exactly one notification per game final
- [Phase 03]: Leaderboard notification gated on actual ranking change to prevent spam
- [Phase 03]: cleanupStaleTokens extracted as shared helper for all notification functions
- [Phase 03]: notifyDraftTurn + notifyGameFinal bundled in functions/index.js (Plan 02 functions dir created here)
- [Phase 03]: sendEachForMulticast for per-token error response access needed by stale token cleanup
- [Phase 03]: No writes to room document from Cloud Function (infinite loop prevention via Pitfall 5)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 3]: Firebase Blaze plan billing status unknown -- must verify before Phase 3 can begin
- [Phase 3]: VAPID key not yet generated -- required for FCM client code
- [Phase 1]: iOS reads manifest only at install time -- manifest must be finalized before Selection Sunday installs
- [Phase 2]: Background tab throttling means draft clock must use absolute timestamps, not decrementing counters

## Session Continuity

Last session: 2026-03-12T16:08:41Z
Stopped at: Completed 03-02-PLAN.md (all plans complete)
Resume file: .planning/phases/03-badge-push-notifications/03-02-SUMMARY.md
