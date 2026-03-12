---
phase: 02-player-identity-draft-clock
plan: 02
subsystem: draft
tags: [draft-clock, turn-enforcement, countdown-timer, auto-pick, firestore-timestamp, snake-draft]

# Dependency graph
requires:
  - phase: 02-player-identity-draft-clock
    provides: "Player identity (getMyPlayerId, PIN auth, localStorage persistence)"
provides:
  - "Turn-based draft enforcement — only active drafter can pick, admin override preserved"
  - "Synchronized countdown timer using absolute Firestore Timestamps (survives background tab throttling)"
  - "Auto-pick highest available seed on timer expiry with 3-second fallback"
  - "Commissioner pause/resume clock controls"
  - "Configurable timer duration per room (60s, 90s, 120s, no limit)"
  - "Timer color transitions (green > yellow > red) with pulse animation"
affects: [02-03-audio-haptic, 03-badge-push]

# Tech tracking
tech-stack:
  added: []
  patterns: [absolute Firestore Timestamp for cross-client clock sync, setInterval-based local countdown with server-authoritative deadline]

key-files:
  created: []
  modified: [index.html]

key-decisions:
  - "Used absolute Firestore Timestamps (pickDeadline) instead of decrementing counters to survive background tab throttling"
  - "Active drafter's client is primary auto-picker; other clients use 3-second fallback to avoid race conditions"
  - "Admin override preserved — adminUnlocked users can pick on behalf of any player"
  - "Timestamp reconstructed after JSON deserialization in both connectToRoom() and loadState()"

patterns-established:
  - "Clock sync pattern: store absolute deadline in Firestore, compute remaining locally, auto-act on expiry"
  - "Turn enforcement pattern: compare getMyPlayerId() against ds.order[ds.cp], bypass with adminUnlocked"

requirements-completed: [AUTH-05, AUTH-06, DRFT-01, DRFT-02, DRFT-03, DRFT-04, DRFT-05]

# Metrics
duration: 5min
completed: 2026-03-11
---

# Phase 2 Plan 02: Draft Clock Summary

**Turn-based draft enforcement with synchronized countdown timer, auto-pick on expiry, commissioner pause/resume, and configurable duration using absolute Firestore Timestamps**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-11T21:55:00Z
- **Completed:** 2026-03-12T02:01:00Z
- **Tasks:** 2 (1 auto + 1 checkpoint)
- **Files modified:** 1

## Accomplishments
- Only the active drafter can make picks; non-active players see disabled pick buttons with "It's not your turn!" toast
- Admin-unlocked users retain override to pick on behalf of any player (draft management preserved)
- Countdown timer displays with color transitions: green (>30s), yellow (>10s), red (<=10s with pulse animation)
- Timer auto-picks the highest available seed on expiry, with active drafter as primary picker and 3-second fallback for other clients
- Commissioner can pause and resume the clock mid-pick, storing remaining milliseconds during pause
- Timer duration configurable in Setup tab (No Limit, 60s, 90s, 120s) before starting the draft
- Firestore Timestamp deserialization handled in both connectToRoom() and loadState() for cross-client sync

## Task Commits

Each task was committed atomically:

1. **Task 1: Turn-based draft enforcement and timer configuration** - `0c3be67` (feat)
2. **Task 2: Verify turn enforcement and draft clock** - checkpoint:human-verify (approved)

## Files Created/Modified
- `index.html` - Updated pickTeam() with turn check, startDraft() with timer init, undoDraft() with timer reset, resetDraft() with stopDraftClock(), renderDraft() with timer display and isMyTurn disable logic, added draft clock functions (startDraftClock, stopDraftClock, updateDraftClock, autoPickHighestSeed, pauseDraftClock, resumeDraftClock, setDraftClock), added timer CSS with color classes and pulse animation, added Timestamp reconstruction in connectToRoom() and loadState()

## Decisions Made
- Used absolute Firestore Timestamps (pickDeadline) rather than decrementing counters so the clock survives background tab throttling and stays synced across clients
- Active drafter's client is the primary auto-picker on expiry; other clients wait 3 seconds before attempting, avoiding duplicate picks from race conditions
- Admin override preserved in pickTeam() so the commissioner can still manage the draft on behalf of absent players
- Firestore Timestamp objects reconstructed after JSON.parse in both remote (connectToRoom) and local (loadState) deserialization paths

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Draft clock system complete, ready for audio/haptic alerts (02-03) to hook into the timer-red threshold
- The updateDraftClock() function provides the timing hook point for playing an audio beep at 10 seconds
- Turn enforcement is live, ready for badge notifications (Phase 3) to trigger on turn changes

## Self-Check: PASSED

- FOUND: index.html
- FOUND: commit 0c3be67
- FOUND: 02-02-SUMMARY.md

---
*Phase: 02-player-identity-draft-clock*
*Completed: 2026-03-11*
