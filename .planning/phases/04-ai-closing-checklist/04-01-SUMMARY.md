---
phase: 04-ai-closing-checklist
plan: 01
subsystem: database
tags: [firestore, checklist, missouri, seeding, subcollection, closing-date]

# Dependency graph
requires:
  - phase: 02-compliance-docs
    provides: documentTemplates IDs (mo-purchase-agreement, etc.) used for linkedTemplateId mapping
provides:
  - MO_CLOSING_CHECKLIST_TEMPLATE constant (28 items across 3 categories)
  - seedChecklist function for Firestore closingChecklist subcollection
  - recalculateDeadlines function for batch deadline updates
  - parseTransactionType utility
  - CHECKLIST_CATEGORIES and CATEGORY_LABELS constants
  - Expected Closing Date field on client Overview tab
affects: [04-02-PLAN (checklist UI), 04-03-PLAN (AI check-in), boldSignWebhook auto-completion]

# Tech tracking
tech-stack:
  added: []
  patterns: [deterministic-subcollection-seeding, merge-true-idempotent-writes, deadline-offset-calculation]

key-files:
  created: [js/checklist.js]
  modified: [js/client-detail.js, app/client-detail.html]

key-decisions:
  - "Combined template with propertyTypes tags instead of separate per-property-type templates"
  - "Deterministic doc IDs with merge:true for idempotent re-seeding that preserves completion state"
  - "linkedTemplateId uses mo- prefixed IDs matching documentTemplates collection for rename-safe mapping"
  - "Closing date field placed in Overview tab Status & Source section (transaction-level, not checklist-level)"
  - "Deadline offsets based on MO residential practice: inspection -28d, financing -10d, walkthrough -1d, MO notice -45d"

patterns-established:
  - "Checklist template constant: array of items with id, task, category, transactionSide, propertyTypes, linkedTemplateId, deadlineOffsetDays, sortOrder"
  - "Subcollection seeding with writeBatch + merge:true for preserving existing state on re-seed"
  - "Deadline computation: closingDate + deadlineOffsetDays * 86400000 milliseconds"

requirements-completed: [CHKL-01, CHKL-02]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 4 Plan 1: Checklist Data Model Summary

**MO residential closing checklist template (28 items, 3 categories) with Firestore seeding logic and closing date integration on client-detail page**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-05T02:46:44Z
- **Completed:** 2026-03-05T02:49:01Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created js/checklist.js with complete MO residential transaction template (7 Pre-Contract, 14 Under Contract, 7 Closing items)
- 7 items linked to documentTemplates IDs for auto-completion mapping in Plan 02/03
- seedChecklist uses merge:true writes for idempotent re-seeding that preserves existing completion state
- Expected Closing Date field added to Overview tab with deadline recalculation on change

## Task Commits

Each task was committed atomically:

1. **Task 1: Create checklist.js module with MO template and seeding logic** - `0ce98f3` (feat)
2. **Task 2: Add closing date field and wire seeding to transaction type change** - `a08b2a2` (feat)

## Files Created/Modified
- `js/checklist.js` - Checklist template constant, seeding functions, category constants, parseTransactionType utility
- `js/client-detail.js` - Import checklist module, wire seedChecklist on transactionType change, closing date handler, closingDate in saveOverview
- `app/client-detail.html` - Expected Closing Date input field in Overview tab

## Decisions Made
- Combined template with propertyTypes tags: only 2-3 items differ by property type (HOA for Condo, land survey for Land), so a single tagged array is simpler than separate templates
- Closing date in Overview tab: it is a transaction-level property, not checklist-specific, so it belongs with other transaction metadata
- Deadline offsets follow standard MO residential timelines as documented in research

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Checklist data model ready for Plan 02 (checklist UI with rendering, toggle, progress bars)
- seedChecklist writes subcollection docs that onSnapshot listeners in Plan 02 will consume
- linkedTemplateId field ready for Plan 03 auto-completion via boldSignWebhook extension
- recalculateDeadlines ready for UI to display deadline dates

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 04-ai-closing-checklist*
*Completed: 2026-03-04*
