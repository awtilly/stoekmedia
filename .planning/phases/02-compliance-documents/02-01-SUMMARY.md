---
phase: 02-compliance-documents
plan: 01
subsystem: api
tags: [boldsign, sender-identity, cloud-functions, firebase, esignature]

# Dependency graph
requires:
  - phase: 01-foundations
    provides: Firestore users/{uid} profile structure and Firebase project config
provides:
  - createSenderIdentity Cloud Function for BoldSign sender identity setup
  - sendComplianceDoc callable Cloud Function shell with sender email fallback
  - httpsCallable references in client-detail.js for compliance doc operations
affects: [02-compliance-documents]

# Tech tracking
tech-stack:
  added: [firebase-functions v4, firebase-admin v12]
  patterns: [BoldSign Sender Identity API integration, email fallback chain (Firestore -> Auth)]

key-files:
  created: [functions/index.js, functions/package.json]
  modified: [js/client-detail.js]

key-decisions:
  - "Node 18 native fetch for BoldSign API calls -- no node-fetch dependency needed"
  - "Graceful degradation: sendComplianceDoc proceeds without onBehalfOf if sender identity not approved"

patterns-established:
  - "Email fallback chain: userData.email || request.auth.token.email for sender identity"
  - "Cloud Functions v2 onCall pattern with region us-central1 for all new functions"

requirements-completed: [BSND-01, BSND-02, BSND-03, BSND-04]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 2 Plan 1: Sender Identity Summary

**BoldSign sender identity Cloud Function with Firestore-backed approval tracking and sendComplianceDoc callable shell using email fallback chain**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-04T21:20:11Z
- **Completed:** 2026-03-04T21:22:02Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created createSenderIdentity Cloud Function that calls BoldSign Sender Identity API, stores approval status in Firestore users/{uid}, and implements email fallback from Firestore profile to Firebase Auth
- Created sendComplianceDoc callable shell with auth validation, sender email resolution, and sender identity status checking (graceful degradation if not approved)
- Added sendComplianceDocFn and createSenderIdentityFn httpsCallable references in client-detail.js ready for Plan 02-03

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Cloud Functions file with createSenderIdentity and sendComplianceDoc shell** - `edd3569` (feat)
2. **Task 2: Add sendComplianceDocFn callable reference in client-detail.js** - `a24604e` (feat)

## Files Created/Modified
- `functions/index.js` - Cloud Functions with createSenderIdentity (full) and sendComplianceDoc (shell)
- `functions/package.json` - Node 18 engine, firebase-admin ^12.x, firebase-functions ^4.x
- `js/client-detail.js` - Added sendComplianceDocFn and createSenderIdentityFn callable references

## Decisions Made
- Used Node 18 native fetch for BoldSign API calls instead of adding node-fetch dependency
- sendComplianceDoc gracefully degrades when sender identity is not approved -- logs warning but proceeds without onBehalfOf so emails still send (just with default BoldSign sender)
- Skipped sender identity creation if already approved status in Firestore (idempotent)

## Deviations from Plan

None - plan executed exactly as written.

## User Setup Required

**External services require manual configuration** before sender identity can be used:
- **BOLDSIGN_API_KEY**: Must be set as a Cloud Functions environment variable (should already exist from existing BoldSign integration)
- **Sender Identity Approval**: After calling createSenderIdentity, the realtor must click the approval link in the email sent by BoldSign
- **Deployment**: `functions/index.js` must be deployed to Firebase Cloud Functions (us-central1)

## Next Phase Readiness
- Sender identity infrastructure ready for Plan 02-03's sendComplianceDoc full implementation
- sendComplianceDoc shell has all auth and sender email resolution logic in place -- Plan 02-03 adds template lookup, merge field resolution, and BoldSign API call
- client-detail.js callable references ready for Plan 02-03's compliance tab UI

## Self-Check: PASSED

All files verified to exist. All commit hashes found in git log.

---
*Phase: 02-compliance-documents*
*Completed: 2026-03-04*
