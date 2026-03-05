---
phase: 05-showingtime-sync
plan: 02
subsystem: ui
tags: [calendar, showingtime, css-pseudo-element, read-only, drag-prevention]

# Dependency graph
requires:
  - phase: 05-showingtime-sync
    plan: 01
    provides: Firestore showings with source:showingtime, iCal sync pipeline
provides:
  - ShowingTime events displayed in calendar with ST badge in month and week views
  - Read-only popover for ST events (no edit/delete/drag)
  - Calendar legend with ShowingTime entry
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [CSS ::after pseudo-element badge overlay, conditional draggable attribute, type-based popover action gating]

key-files:
  created: []
  modified:
    - js/calendar.js
    - app/calendar.html
    - css/greendoor.css

key-decisions:
  - "CSS ::after pseudo-element for ST badge avoids extra DOM elements and works with existing event rendering"
  - "Type-based gating (ev.type !== showingtime) for drag prevention at both HTML attribute and moveEvent guard levels"
  - "No separate Firestore query for ST showings -- existing showingsSnap already returns all showings including ST docs"

patterns-established:
  - "Conditional draggable: set draggable attribute only for editable event types"
  - "Popover action gating: wrap action buttons in type check to support read-only event types"

requirements-completed: [SHWT-09]

# Metrics
duration: 2min
completed: 2026-03-05
---

# Phase 5 Plan 2: ShowingTime Calendar Display Summary

**ST-badged ShowingTime events in calendar month/week views with read-only popover, drag prevention, and legend entry using CSS ::after pseudo-element badges**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-05T15:24:04Z
- **Completed:** 2026-03-05T15:26:02Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- ShowingTime showings display in both month and week calendar views with distinct green "ST" badge overlay
- ST showings are fully read-only: no draggable attribute, no dragstart listener, moveEvent early return guard
- ST popover shows datetime, location, and "Source: ShowingTime" label with no Edit/Delete/View Client buttons
- Calendar legend updated with 4th "ShowingTime" entry featuring ST-badged green dot

## Task Commits

Each task was committed atomically:

1. **Task 1: Calendar ST type detection, read-only popover, and drag prevention** - `865597e` (feat)
2. **Task 2: ST badge CSS and calendar legend** - `08f0b13` (feat)

## Files Created/Modified
- `js/calendar.js` - ST type detection in showingsSnap.forEach, conditional draggable in month/week views, read-only popover with location and source label, moveEvent guard
- `app/calendar.html` - 4th ShowingTime legend item with gd-legend-showingtime class
- `css/greendoor.css` - ST badge CSS for legend dot, month event dot, and week event block using ::after pseudo-element

## Decisions Made
- CSS ::after pseudo-element approach for ST badge: small white pill with green "ST" text positioned at top-right of event element, avoids extra DOM elements
- Type-based gating at multiple levels: draggable attribute removed from HTML, dragstart listener skipped, and moveEvent early return as defense-in-depth
- No separate Firestore query needed -- existing showingsSnap already contains ST documents from Plan 01's sync pipeline

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ShowingTime calendar integration is complete (SHWT-09)
- All Phase 5 plans are now complete -- the full ShowingTime iCal sync pipeline from backend (Plan 01) to calendar display (Plan 02) is operational
- No further phases remain; this completes the v1.0 milestone

## Self-Check: PASSED

All files exist, both commits verified, all must_have artifacts and key_links confirmed.

---
*Phase: 05-showingtime-sync*
*Completed: 2026-03-05*
