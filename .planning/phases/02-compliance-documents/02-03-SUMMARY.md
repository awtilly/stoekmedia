---
phase: 02-compliance-documents
plan: 03
subsystem: ui, api
tags: [boldsign, firebase, firestore, compliance, esignature, cloud-functions, real-time]

# Dependency graph
requires:
  - phase: 02-compliance-documents/02-01
    provides: "createSenderIdentity + sendComplianceDoc callable shell with sender identity check"
  - phase: 02-compliance-documents/02-02
    provides: "compliance.js data layer with MO_FORM_STUBS, buildMergeFields, formatComplianceStatus, documentTemplates seed"
provides:
  - "Compliance Docs tab on client detail page with template listing filtered by transaction type"
  - "Send-for-signature confirm dialog with merge field preview and listing selector"
  - "sendComplianceDoc Cloud Function calling BoldSign /v1/template/send with existingFormFields and onBehalfOf"
  - "sendBulkComplianceDocs Cloud Function bundling templates via BoldSign /v1/template/mergeAndSend with sequential fallback"
  - "Real-time status tracking via Firestore onSnapshot on complianceDocs subcollection"
affects: [03-webhook-pipeline, 04-ai-closing-checklist]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BoldSign /v1/template/send API integration with existingFormFields for merge field injection"
    - "BoldSign /v1/template/mergeAndSend for multi-template envelope bundling with sequential fallback"
    - "Firestore onSnapshot real-time listener on complianceDocs subcollection for live status updates"
    - "Server-side merge field resolution using dot-path walking on client/listing/agent data"
    - "Confirm dialog pattern with listing selector, merge field preview, and missing field warnings"

key-files:
  created: []
  modified:
    - "app/client-detail.html"
    - "css/greendoor.css"
    - "functions/index.js"
    - "js/client-detail.js"

key-decisions:
  - "Graceful degradation: sendComplianceDoc omits onBehalfOf if sender identity not approved, logs warning"
  - "Bulk send uses BoldSign mergeAndSend for single envelope; auto-falls back to sequential /v1/template/send if endpoint rejects"
  - "Server-side merge field resolution mirrors client-side buildMergeFields logic for consistency"
  - "No transaction type shows all forms dimmed/disabled with warning banner rather than hiding them"

patterns-established:
  - "BoldSign template send: POST /v1/template/send with roles[0].existingFormFields for merge data"
  - "Compliance status subcollection: clients/{clientId}/complianceDocs/{templateId} with status, sentAt, signedAt"
  - "Real-time UI update: onSnapshot on subcollection triggers re-render without page refresh"
  - "Confirm dialog: modal with recipient info, listing selector, resolved merge fields, missing field warnings"

requirements-completed: [COMP-04, COMP-05, COMP-06, COMP-07, COMP-08, COMP-09, COMP-10]

# Metrics
duration: 12min
completed: 2026-03-04
---

# Phase 2 Plan 3: Compliance Docs Tab Summary

**Compliance Docs tab with send-for-signature flow, BoldSign Cloud Functions for single and bulk envelope send, and real-time Firestore status tracking**

## Performance

- **Duration:** ~12 min (across multiple executor sessions including checkpoint)
- **Started:** 2026-03-04T21:20:00Z (approximate, first task session)
- **Completed:** 2026-03-04T21:42:02Z
- **Tasks:** 4 (3 auto + 1 checkpoint)
- **Files modified:** 4

## Accomplishments
- Built complete Compliance Docs tab (6th tab on client detail) with template listing filtered by client transaction type, category grouping, and status badges
- Implemented send-for-signature confirm dialog with recipient info, listing selector, merge field preview, and missing field warnings
- Completed sendComplianceDoc Cloud Function: reads template/client/listing/agent data, resolves merge fields server-side, calls BoldSign /v1/template/send with existingFormFields and onBehalfOf
- Added sendBulkComplianceDocs Cloud Function bundling multiple templates into a single BoldSign envelope via /v1/template/mergeAndSend with automatic fallback to sequential sends
- Wired real-time onSnapshot listener on complianceDocs subcollection for live status updates without page refresh
- Exposed all onclick handlers (openSendDialog, closeComplianceConfirm, confirmAndSendCompliance) on window object

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Compliance Docs tab HTML, CSS, and complete sendComplianceDoc + sendBulkComplianceDocs Cloud Functions** - `3ea950f` (feat)
2. **Task 2a: Implement compliance tab template loading, rendering, real-time listener, and wiring** - `a3a1ace` (feat)
3. **Task 2b: Implement send dialog, confirm flow, bulk send, listing selector, and window exposures** - `3bb1d4d` (feat)
4. **Task 3: Verify Compliance Docs tab end-to-end in browser** - checkpoint approved (no commit)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `app/client-detail.html` - Added 6th Compliance Docs tab button, tab-compliance content div with toolbar/bulk select/template list, and compliance-confirm-modal dialog
- `css/greendoor.css` - Added compliance row styles, 3 status badge colors (gray/amber/green), category headers, confirm dialog sections, toolbar, and warning styles
- `functions/index.js` - Completed sendComplianceDoc with BoldSign /v1/template/send API call, merge field resolution, and Firestore write; added sendBulkComplianceDocs with mergeAndSend bundling and sequential fallback
- `js/client-detail.js` - Added compliance.js imports, loadComplianceTemplates, renderComplianceList with category grouping, startComplianceListener with onSnapshot, openSendDialog with listing selector and merge field preview, confirmAndSendCompliance, bulk send flow, and window function exposures

## Decisions Made
- Graceful degradation for sender identity: sendComplianceDoc proceeds without onBehalfOf if sender identity not approved, with warning log
- Bulk send bundles into single BoldSign envelope via mergeAndSend (locked user decision); auto-falls back to sequential sends if endpoint rejects
- Server-side merge field resolution duplicates client-side buildMergeFields logic for security (client cannot tamper with resolved values)
- No transaction type shows all forms dimmed with explanatory banner rather than empty state

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. BoldSign API key and template IDs are configured separately.

## Next Phase Readiness
- Phase 2 is now complete: sender identity (02-01), template library (02-02), and send flow with UI (02-03) are all implemented
- Phase 3 (Webhook Pipeline) can now build on the complianceDocs subcollection and boldSignDocumentId to process signed document events
- BoldSign template IDs need to be populated in Firestore documentTemplates collection for actual send functionality (operational task, not code)

## Self-Check: PASSED

- All 4 modified files exist on disk
- All 3 task commits verified in git log (3ea950f, a3a1ace, 3bb1d4d)
- SUMMARY.md created successfully

---
*Phase: 02-compliance-documents*
*Completed: 2026-03-04*
