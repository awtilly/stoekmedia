---
phase: 05-showingtime-sync
plan: 01
subsystem: api, ui
tags: [node-ical, ical, firebase-functions, onSchedule, onCall, showingtime, calendar-sync]

# Dependency graph
requires:
  - phase: 01-core-client
    provides: Settings page structure, Firestore user profile, auth patterns
provides:
  - syncShowingTime callable Cloud Function (manual sync trigger)
  - scheduledShowingTimeSync scheduled Cloud Function (30-min cron)
  - syncFeedForUser shared helper (iCal fetch/parse/upsert/delete)
  - Settings Integrations card with connected/disconnected states
  - Firestore showings collection populated with source:"showingtime" documents
affects: [05-02-calendar-display]

# Tech tracking
tech-stack:
  added: [node-ical 0.22.x, firebase-functions/v2/scheduler onSchedule]
  patterns: [iCal feed sync pipeline, deterministic doc ID upsert with orphan deletion, batch chunking for Firestore 500 limit]

key-files:
  created: []
  modified:
    - functions/index.js
    - functions/package.json
    - functions/package-lock.json
    - app/settings.html
    - js/settings.js

key-decisions:
  - "Lazy require node-ical inside syncFeedForUser to avoid cold start cost for other functions"
  - "Batch chunking at 450 operations to stay safely under Firestore 500 limit"
  - "Operations array pattern for batch building enables clean chunking without counting mid-loop"
  - "Client-side disconnect uses Promise.all with individual deleteDoc rather than writeBatch for simplicity"

patterns-established:
  - "iCal sync pipeline: normalize URL -> fetch via node-ical -> filter VEVENTs -> deterministic ID upsert -> orphan deletion -> metadata update"
  - "Rate limiting via Firestore timestamp comparison server-side (15 min per user)"
  - "Integrations card rendering pattern: disconnected state with setup guide, connected state with status/actions"

requirements-completed: [SHWT-01, SHWT-02, SHWT-03, SHWT-04, SHWT-05, SHWT-06, SHWT-07, SHWT-08, SHWT-10, SHWT-11]

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 5 Plan 1: ShowingTime iCal Sync Backend and Settings UI Summary

**ShowingTime iCal sync pipeline with callable + scheduled Cloud Functions using node-ical, plus Settings Integrations card with feed URL management, sync trigger, and error display**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T15:17:46Z
- **Completed:** 2026-03-05T15:21:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Full iCal sync pipeline: fetches ShowingTime feed, parses VEVENTs, upserts to Firestore with deterministic IDs, deletes orphaned showings
- Two Cloud Functions: syncShowingTime callable for manual sync, scheduledShowingTimeSync for 30-minute automatic sync
- Settings Integrations card with disconnected state (step-by-step setup guide + URL input) and connected state (green status dot, truncated URL, last synced timestamp, Sync Now + Disconnect buttons)
- Server-side rate limiting at 15-minute intervals per user
- Error banner with actionable troubleshooting tips on sync failure

## Task Commits

Each task was committed atomically:

1. **Task 1: Sync Cloud Functions and node-ical dependency** - `a629a08` (feat)
2. **Task 2: Settings Integrations card with feed URL management** - `2e7740b` (feat)

## Files Created/Modified
- `functions/index.js` - Added syncFeedForUser helper, syncShowingTime callable, scheduledShowingTimeSync scheduled, sanitizeIcalUid helper, onSchedule import
- `functions/package.json` - Added node-ical ^0.22.0 dependency
- `functions/package-lock.json` - Generated lockfile with node-ical dependencies
- `app/settings.html` - Added Integrations card with showingtime-integration div between Email Sending and Help & Support
- `js/settings.js` - Added renderShowingTimeIntegration, saveShowingTimeFeed, syncShowingTimeNow, disconnectShowingTime; imported formatDateTime

## Decisions Made
- Lazy require of node-ical inside syncFeedForUser to minimize cold start impact on other functions
- Operations array with chunked batch commits at 450 ops (safety margin under Firestore 500 limit)
- Client-side disconnect uses Promise.all with individual deleteDoc for simplicity over writeBatch
- Integrations card uses generic title "Integrations" (future-proofed for additional integrations)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. The Cloud Functions use existing Firebase infrastructure.

## Next Phase Readiness
- Showing documents are being written to the top-level `showings` collection with `source: "showingtime"`, ready for calendar.js to display them
- Plan 02 (Calendar Display) can query these documents via existing showings queries and add ST badge rendering
- Composite Firestore index for `showings` collection on `(realtorId, source)` will be auto-suggested by Firebase on first Cloud Function execution

## Self-Check: PASSED

All files exist, both commits verified, all must_have artifacts and key_links confirmed.

---
*Phase: 05-showingtime-sync*
*Completed: 2026-03-05*
