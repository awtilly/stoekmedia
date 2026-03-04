---
phase: 02-compliance-documents
plan: 02
subsystem: database
tags: [firestore, boldsign, compliance, merge-fields, seed-script]

# Dependency graph
requires:
  - phase: 01-foundations
    provides: transaction type field on client record (transactionType values used for filtering)
provides:
  - documentTemplates Firestore collection schema and 7 MO form seed data
  - buildMergeFields utility for resolving BoldSign template fields from client/listing/agent data
  - COMPLIANCE_STATUSES, COMPLIANCE_CATEGORIES, MO_FORM_STUBS constants
  - formatComplianceStatus HTML badge helper
affects: [02-03-compliance-documents, 03-webhook-pipeline]

# Tech tracking
tech-stack:
  added: [firebase-admin (seed script only)]
  patterns: [dot-path field resolution, deterministic Firestore document IDs, idempotent batch seed]

key-files:
  created:
    - js/compliance.js
    - functions/seed-templates.js
  modified: []

key-decisions:
  - "Duplicated form data in seed script (CommonJS) vs compliance.js (ES module) -- intentional; seed runs once, Firestore becomes source of truth"
  - "Deterministic document IDs (mo-purchase-agreement, etc.) enable idempotent re-runs of seed script"
  - "Empty boldSignTemplateId in stubs -- templates created in BoldSign dashboard first, then IDs pasted into Firestore"
  - "buildMergeFields returns both resolved fields and missing field list for UI warning in confirm dialog"

patterns-established:
  - "Dot-path field resolution: split source string by period, walk nested object path with optional chaining"
  - "Compliance status badge pattern: gd-badge-compliance-notsent/sent/signed CSS classes"
  - "Date merge field special case: source 'date' resolves to current locale date string at send time"

requirements-completed: [COMP-01, COMP-02, COMP-03]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 2 Plan 02: Compliance Template Library Summary

**documentTemplates schema with 7 MO form stubs, buildMergeFields dot-path resolver, and Firebase seed script for idempotent collection seeding**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-04T21:20:15Z
- **Completed:** 2026-03-04T21:22:24Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created compliance.js ES module exporting COMPLIANCE_STATUSES, COMPLIANCE_CATEGORIES, MO_FORM_STUBS (7 forms), buildMergeFields utility, and formatComplianceStatus badge helper
- Created functions/seed-templates.js standalone Node.js script that batch-writes all 7 MO form stubs to the documentTemplates Firestore collection with deterministic IDs
- buildMergeFields resolves nested dot-path field mappings (e.g., "listing.address.full") from client/listing/agent data sources with missing field tracking

## Task Commits

Each task was committed atomically:

1. **Task 1: Create compliance.js with buildMergeFields, constants, and shared helpers** - `a24604e` (feat)
2. **Task 2: Create seed script for documentTemplates Firestore collection** - `102fdcb` (feat)

## Files Created/Modified
- `js/compliance.js` - ES module with compliance data layer: constants, 7 MO form stubs with mergeFields arrays, buildMergeFields dot-path resolver, formatComplianceStatus badge helper
- `functions/seed-templates.js` - Standalone CommonJS seed script using firebase-admin to batch-write 7 MO form stubs to documentTemplates collection with deterministic IDs and merge:true for idempotent re-runs

## Decisions Made
- Duplicated form data between compliance.js (ES module for browser) and seed-templates.js (CommonJS for Node.js) -- intentional separation; the seed script runs once and Firestore becomes the source of truth
- Used deterministic document IDs (mo-purchase-agreement, mo-listing-agreement, etc.) so the seed script can be safely re-run without creating duplicate documents
- Set boldSignTemplateId to empty string (not placeholder text) -- real template IDs will be set after creating templates in BoldSign's dashboard
- buildMergeFields handles "date" as a special source value, resolving to the current locale date at send time rather than reading from a data source
- formatComplianceStatus handles Firestore Timestamps via toDate() for signed date display

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. The seed script can be run when ready: `cd functions && node seed-templates.js`

## Next Phase Readiness
- compliance.js provides the data layer that Plan 02-03 UI will consume (template constants, merge field resolver, status badges)
- Seed script is ready to populate Firestore -- should be run before testing the Compliance Docs tab
- After seeding, BoldSign templates need to be created in the dashboard and their IDs updated in Firestore documentTemplates documents
- Plan 02-03 can begin immediately -- it depends on the exports from compliance.js and the seeded documentTemplates collection

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 02-compliance-documents*
*Completed: 2026-03-04*
