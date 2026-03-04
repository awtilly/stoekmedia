---
phase: 03-webhook-pipeline
plan: 01
subsystem: api
tags: [boldsign, webhook, hmac, cloud-functions, firebase-storage, firestore]

# Dependency graph
requires:
  - phase: 02-compliance-documents
    provides: complianceDocs subcollection with boldSignDocumentId, sendComplianceDoc/sendBulkComplianceDocs exports, documentTemplates collection
provides:
  - boldSignWebhook onRequest Cloud Function with HMAC verification
  - Signed PDF auto-save to Firebase Storage closing-documents path
  - Firestore file record creation with signedSource flag and deterministic ID
  - complianceDocs status update to "signed" with signedAt timestamp
  - Idempotent webhook processing via deterministic file document IDs
affects: [03-02-signed-badges, 04-ai-closing-checklist]

# Tech tracking
tech-stack:
  added: []
  patterns: [onRequest HTTP endpoint alongside onCall functions, HMAC-SHA256 webhook verification with timingSafeEqual, deterministic IDs for idempotent webhook processing, collectionGroup query for cross-client document lookup]

key-files:
  created: []
  modified: [functions/index.js]

key-decisions:
  - "HMAC verification uses hex buffer comparison with crypto.timingSafeEqual to prevent timing attacks"
  - "Always return 200 to BoldSign even on internal errors to prevent retry loops"
  - "Deterministic file doc ID pattern: clientId_signed_templateId for natural idempotency"
  - "Read realtorId from complianceDocs.sentBy field (set during Phase 2 send flow)"

patterns-established:
  - "onRequest webhook pattern: method guard -> HMAC verify -> event filter -> try/catch pipeline -> always 200"
  - "verifyBoldSignSignature helper: parse X-BoldSign-Signature header (t=timestamp, s0=signature) format"
  - "Signed PDF filename convention: {TemplateName}_signed_{YYYY-MM-DD}.pdf with spaces replaced by underscores"

requirements-completed: [WHBK-01, WHBK-02, WHBK-03, WHBK-04, WHBK-05, WHBK-06, WHBK-07, WHBK-08, WHBK-09, WHBK-10]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 3 Plan 1: BoldSign Webhook Pipeline Summary

**Complete boldSignWebhook Cloud Function with HMAC-SHA256 verification, signed PDF download/upload pipeline, Firestore file record creation, and idempotent compliance status updates**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-04T22:33:12Z
- **Completed:** 2026-03-04T22:35:19Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `boldSignWebhook` onRequest export to functions/index.js implementing complete signed document pipeline
- HMAC-SHA256 signature verification with constant-time comparison prevents forged webhook requests
- Signed PDFs auto-downloaded from BoldSign API and uploaded to Firebase Storage under client's closing-documents path
- Deterministic Firestore file document IDs (clientId_signed_templateId) ensure duplicate BoldSign events are idempotent
- All 10 WHBK requirements addressed in a single linear pipeline with proper error handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Add boldSignWebhook onRequest export with HMAC verification and event filtering** - `0a6a014` (feat)

## Files Created/Modified
- `functions/index.js` - Added onRequest/getStorage/crypto imports, verifyBoldSignSignature helper, and boldSignWebhook export with 9-step pipeline (method guard, HMAC verify, event filter, collectionGroup lookup, idempotency check, PDF download, Storage upload, Firestore writes, 200 response)

## Decisions Made
- Used hex buffer comparison in crypto.timingSafeEqual for HMAC verification (prevents timing attacks on signature comparison)
- All errors inside the processing pipeline return 200 to prevent BoldSign from retrying permanently failing requests
- Template name read from documentTemplates collection for human-readable filenames; falls back to templateId if template doc not found
- getSignedUrl with 2030-01-01 expiry for download URLs (matches research recommendation; works automatically in Cloud Functions environment)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Before deploying, ensure the following environment variable is set in Cloud Functions:
- `BOLDSIGN_WEBHOOK_SECRET` - The HMAC secret from BoldSign webhook configuration dashboard
- `BOLDSIGN_API_KEY` - Already configured from Phase 2

After deploying, configure BoldSign to POST to the `boldSignWebhook` endpoint URL and create the Firestore composite index for `collectionGroup("complianceDocs")` on `boldSignDocumentId` (Firestore will provide the index creation URL on first invocation).

## Next Phase Readiness
- boldSignWebhook function is ready for deployment alongside existing Cloud Functions
- Plan 03-02 (signed document UI badges) can proceed - file records include `signedSource: true` flag for badge detection
- Phase 4 (AI Closing Checklist) can extend the webhook to auto-complete checklist items after status updates

## Self-Check: PASSED

- FOUND: functions/index.js
- FOUND: 03-01-SUMMARY.md
- FOUND: commit 0a6a014

---
*Phase: 03-webhook-pipeline*
*Completed: 2026-03-04*
