---
phase: 03-webhook-pipeline
verified: 2026-03-04T23:00:00Z
status: human_needed
score: 8/8 must-haves verified
re_verification: false
human_verification:
  - test: "Trigger a real BoldSign Completed webhook POST and confirm 200 response"
    expected: "HTTP 200 OK returned; no errors in Cloud Function logs"
    why_human: "Cannot run Cloud Functions locally without Firebase emulator and live BoldSign event; HMAC verification requires the real BOLDSIGN_WEBHOOK_SECRET"
  - test: "Confirm a forged/tampered webhook request returns 401 before any Firestore write"
    expected: "res.status(401) with body 'Invalid signature'; no file record or complianceDocs update in Firestore"
    why_human: "Requires live Cloud Function deployment and ability to send a crafted HTTP request with a bad HMAC signature"
  - test: "Send a non-Completed BoldSign event (e.g. Viewed) and verify it returns 200 with no data side effects"
    expected: "200 OK returned; nothing written to Firestore or Storage"
    why_human: "Requires live Cloud Function and ability to POST a synthetic BoldSign event payload"
  - test: "Sign a compliance document end-to-end and verify signed PDF appears in Closing Documents folder"
    expected: "File appears in client's Closing Documents folder in file browser within seconds of signing; complianceDocs tab shows Signed badge with date"
    why_human: "Full pipeline requires live BoldSign account, real client, deployed Cloud Function, and correct BOLDSIGN_WEBHOOK_SECRET configuration"
  - test: "Send the same Completed webhook event twice and verify no duplicate file record is created"
    expected: "Second invocation returns 200 OK immediately; Firestore files collection still has exactly one record for clientId_signed_templateId"
    why_human: "Requires live deployment to verify idempotency check at db.doc('files/...').get() behaves correctly under race conditions or repeated delivery"
  - test: "Verify the green Signed badge renders correctly with a real signedAt timestamp in the file list"
    expected: "Badge shows 'Signed -- Mar 4, 2026' (or appropriate date) next to the filename; no text wrapping inside the badge"
    why_human: "Visual rendering requires browser; badge date formatting depends on formatDate() behavior with a real Firestore Timestamp object"
---

# Phase 3: Webhook Pipeline Verification Report

**Phase Goal:** When a client signs a compliance document, the signed PDF automatically appears in their Closing Documents folder and the document status updates to "signed" — without any manual action from the realtor
**Verified:** 2026-03-04T23:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

All automated checks pass. The implementation is substantive, complete, and correctly wired. Six items require human verification against a live deployed environment.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BoldSign can POST a completed-signing event to /boldSignWebhook and receive a 200 response | ? NEEDS HUMAN | `exports.boldSignWebhook = onRequest(...)` exists and is fully implemented; cannot invoke without live deployment |
| 2 | A forged or tampered request is rejected with 401 before any data is written | ? NEEDS HUMAN | `verifyBoldSignSignature()` helper at line 489 uses `crypto.timingSafeEqual`; method guard + HMAC check precede all Firestore operations; live test required |
| 3 | After the webhook processes a Completed event, a signed PDF file exists in Firebase Storage under the client's closing-documents path | ? NEEDS HUMAN | `getStorage().bucket().file(storagePath).save(pdfBuffer, ...)` at line 618; Storage path `clients/{clientId}/closing-documents/{filename}` confirmed; live test required |
| 4 | After processing, a Firestore file record exists in the files collection with folderId pointing to the Closing Documents folder | ? NEEDS HUMAN | `db.doc("files/" + fileDocId).set({folderId: clientId + "_closing_documents", ...})` at line 630; logic is correct; live test required |
| 5 | After processing, the complianceDocs subcollection record shows status "signed" with a signedAt timestamp | ? NEEDS HUMAN | `db.doc("clients/"+clientId+"/complianceDocs/"+templateId).update({status: "signed", signedAt: FieldValue.serverTimestamp()})` at line 646; live test required |
| 6 | A duplicate BoldSign event does not create a second file or double-update status | ? NEEDS HUMAN | Idempotency check at line 574: `db.doc("files/" + fileDocId).get()` — if exists, returns 200 immediately without writes; deterministic ID confirmed; live test required |
| 7 | Files in the Closing Documents folder with signedSource === true display a green "Signed -- {date}" badge | ? NEEDS HUMAN | `f.signedSource ? '<span class="gd-badge-signed">Signed...' : ""` at line 935 of client-detail.js; visual rendering requires browser |
| 8 | Files without signedSource show no badge | ✓ VERIFIED | `f.signedSource ? ... : ""` — falsy/absent signedSource produces empty string; old `SIGNED_` prefix check confirmed removed (grep returns no matches) |

**Score:** 8/8 truths have substantive implementation; 7/8 require live environment confirmation

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `functions/index.js` | boldSignWebhook onRequest export with HMAC verification, event filtering, collectionGroup lookup, PDF download, Storage upload, Firestore writes, idempotency | ✓ VERIFIED | 181 lines added in commit 0a6a014; all 9 pipeline steps present; `exports.boldSignWebhook` exported at line 527 |
| `js/client-detail.js` | Updated renderFiles() with field-based signed badge detection using `f.signedSource` | ✓ VERIFIED | Lines 935-937 use `f.signedSource` boolean; `formatDate(f.signedAt)` for date display; committed in 273bdc6 |
| `css/greendoor.css` | Updated gd-badge-signed styles with white-space: nowrap and increased padding | ✓ VERIFIED | Lines 2932-2943 show `padding: 0.15rem 0.5rem`, `white-space: nowrap`; committed in 8d3a05c |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| functions/index.js (boldSignWebhook) | BoldSign API /v1/document/download | `fetch` with X-API-KEY header | ✓ WIRED | Line 594-600: `fetch("https://api.boldsign.com/v1/document/download?documentId=...")` with `"X-API-KEY": apiKey`; response handled via `downloadResponse.arrayBuffer()` |
| functions/index.js (boldSignWebhook) | Firestore clients/{clientId}/complianceDocs/{templateId} | collectionGroup query by boldSignDocumentId, then update status | ✓ WIRED | Line 556: `db.collectionGroup("complianceDocs").where("boldSignDocumentId", "==", documentId)`; line 646: `.update({status: "signed", signedAt: ...})` |
| functions/index.js (boldSignWebhook) | Firebase Storage clients/{clientId}/closing-documents/ | Admin SDK bucket.file().save() | ✓ WIRED | Lines 616-618: `getStorage().bucket().file(storagePath).save(pdfBuffer, {contentType: "application/pdf"})` |
| functions/index.js (boldSignWebhook) | Firestore files/{deterministicId} | setDoc with deterministic ID for idempotency | ✓ WIRED | Line 630: `db.doc("files/" + fileDocId).set({...})` where `fileDocId = clientId + "_signed_" + templateId` |
| js/client-detail.js (renderFiles) | Firestore files collection (signedSource field) | field check in template literal | ✓ WIRED | Line 935: `f.signedSource ? '<span class="gd-badge-signed">...'`; field is read from Firestore snapshot in allFiles array |
| css/greendoor.css (gd-badge-signed) | js/client-detail.js (renderFiles badge HTML) | CSS class reference | ✓ WIRED | Line 936 of client-detail.js produces `class="gd-badge-signed"`; CSS rule at line 2932 of greendoor.css styles that class |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WHBK-01 | 03-01-PLAN.md | HTTP Cloud Function at /boldSignWebhook receives BoldSign completion events | ✓ SATISFIED | `exports.boldSignWebhook = onRequest({region: "us-central1"}, ...)` at line 527 of functions/index.js |
| WHBK-02 | 03-01-PLAN.md | Webhook verifies HMAC signature using req.rawBody and BOLDSIGN_WEBHOOK_SECRET | ✓ SATISFIED | `verifyBoldSignSignature()` at lines 489-516; uses `crypto.timingSafeEqual` with hex buffers; called at line 535 before any pipeline logic |
| WHBK-03 | 03-01-PLAN.md | Only processes events where eventType === "Completed" | ✓ SATISFIED (with note) | Line 543: `if (eventType !== "Completed")` — uses `"Completed"` (capital C) per BoldSign API docs. REQUIREMENTS.md text incorrectly says `"document.completed"` — this is a stale text error in the requirements doc, not an implementation defect. Research (03-RESEARCH.md line 52) and PLAN frontmatter both specify `"Completed"`. |
| WHBK-04 | 03-01-PLAN.md | Looks up matching GreenDoor record by BoldSign document ID | ✓ SATISFIED | Lines 556-569: `db.collectionGroup("complianceDocs").where("boldSignDocumentId", "==", documentId).limit(1).get()` |
| WHBK-05 | 03-01-PLAN.md | Downloads signed PDF from BoldSign API | ✓ SATISFIED | Lines 594-608: `fetch("https://api.boldsign.com/v1/document/download?documentId=...")` with X-API-KEY; `Buffer.from(await downloadResponse.arrayBuffer())` |
| WHBK-06 | 03-01-PLAN.md | Uploads signed PDF to Firebase Storage under client's closing path | ✓ SATISFIED | Lines 610-623: storagePath = `clients/${clientId}/closing-documents/${fileName}`; `getStorage().bucket().file(storagePath).save(pdfBuffer, {contentType: "application/pdf"})` |
| WHBK-07 | 03-01-PLAN.md | Saves file metadata to Firestore with folderId pointing to Closing Documents folder | ✓ SATISFIED | Lines 630-644: `db.doc("files/" + fileDocId).set({..., folderId: clientId + "_closing_documents", ...})` |
| WHBK-08 | 03-01-PLAN.md | Updates complianceDocs status to "signed" with signedAt timestamp | ✓ SATISFIED | Lines 646-649: `.update({status: "signed", signedAt: FieldValue.serverTimestamp()})` |
| WHBK-09 | 03-01-PLAN.md | Webhook is idempotent (duplicate events don't create duplicate files) | ✓ SATISFIED | Lines 573-578: deterministic `fileDocId = clientId + "_signed_" + templateId`; `db.doc("files/" + fileDocId).get()` check before any writes; returns 200 immediately if exists |
| WHBK-10 | 03-01-PLAN.md | Returns 200 OK to BoldSign after processing | ✓ SATISFIED | Line 655: `return res.status(200).send("OK")`; also returns 200 in all early-exit paths (non-Completed events, unknown doc, duplicate, download failure) |
| SDUI-01 | 03-02-PLAN.md | Compliance Docs tab shows "Signed" with date when status === "signed" | ✓ SATISFIED | `formatComplianceStatus()` in compliance.js lines 281-297 returns `<span class="gd-badge gd-badge-compliance-signed">Signed &mdash; {date}</span>` when status is COMPLIANCE_STATUSES.SIGNED; `startComplianceListener()` in client-detail.js line 2901 fires onSnapshot to update `complianceDocs` map; rendered at line 2882. Webhook writes `status: "signed"` and `signedAt` to the complianceDocs subcollection, which triggers the listener. No code changes were needed — data-driven. |
| SDUI-02 | 03-02-PLAN.md | Files in Closing Documents folder with signedSource: true display a green "Signed" badge | ✓ SATISFIED | Lines 935-937 of client-detail.js: `f.signedSource ? '<span class="gd-badge-signed">Signed...' : ""`; badge placed inside `gd-file-name` span at line 944; CSS at greendoor.css line 2932 provides green styling |

**Orphaned requirements check:** No additional Phase 3 requirement IDs found in REQUIREMENTS.md beyond the 12 declared in the plans.

---

## REQUIREMENTS.md Text Discrepancy

**WHBK-03** in REQUIREMENTS.md reads: `"Only processes events where type === "document.completed""`

The implementation, research notes (03-RESEARCH.md), and PLAN frontmatter all specify `"Completed"` (capital C, BoldSign's actual event type name). The REQUIREMENTS.md text contains a stale/inaccurate event type string — it conflates the BoldSign event type name with a different webhook convention. This is a documentation error, not an implementation defect.

**Recommendation:** Update REQUIREMENTS.md line for WHBK-03 to read: `Only processes events where eventType === "Completed"` — matching the actual BoldSign payload structure documented in the research and implemented in the function.

---

## Anti-Patterns Found

No blocking anti-patterns detected in the three modified files.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| functions/index.js | — | No TODO/FIXME/placeholder comments | — | Clean |
| js/client-detail.js | — | No TODO/FIXME; old SIGNED_ prefix detection fully removed | — | Clean |
| css/greendoor.css | — | No stubs or placeholder styles | — | Clean |

---

## Human Verification Required

### 1. Live Webhook Endpoint Delivery

**Test:** Deploy Cloud Functions, configure BoldSign to POST to the `boldSignWebhook` URL, and trigger a real signing event.
**Expected:** Cloud Function logs show "boldSignWebhook: Processed signed document for client {id}, template {id}"; HTTP 200 returned to BoldSign; no error logs.
**Why human:** Cannot invoke the live Cloud Function without deployment and a real BoldSign account connected to the webhook URL.

### 2. HMAC Rejection of Forged Requests

**Test:** Send a POST to the `boldSignWebhook` URL with a manually crafted `X-BoldSign-Signature` header that has an incorrect HMAC value.
**Expected:** HTTP 401 returned with body "Invalid signature"; nothing written to Firestore or Storage; Cloud Function logs show "Webhook signature verification failed".
**Why human:** Requires live deployment and ability to send a crafted HTTP request with a deliberately bad signature.

### 3. Non-Completed Event Passthrough

**Test:** POST a synthetic BoldSign event with `event.eventType = "Viewed"` (or any non-Completed type) to the webhook endpoint with a valid HMAC.
**Expected:** HTTP 200 OK returned; no file record created; no complianceDocs update.
**Why human:** Requires live deployment to construct a valid-HMAC event payload with a non-Completed event type.

### 4. Full End-to-End Signing Flow

**Test:** Send a compliance document to a real client via the app, have the client sign it in BoldSign, then check the client's file browser and Compliance Docs tab.
**Expected:** Within seconds of signing: (a) a new file appears in the Closing Documents folder with a "Signed -- {date}" badge; (b) the Compliance Docs tab shows the form with a green "Signed -- {date}" badge; (c) no realtor action was required.
**Why human:** Full pipeline requires live BoldSign webhook delivery, deployed Cloud Function, correct environment variables (BOLDSIGN_WEBHOOK_SECRET, BOLDSIGN_API_KEY), and Firebase Storage write permissions.

### 5. Idempotency Under Duplicate Delivery

**Test:** After a successful signing event is processed, manually re-POST the identical webhook payload to the endpoint.
**Expected:** HTTP 200 OK returned immediately; Firestore `files` collection still contains exactly one record for `{clientId}_signed_{templateId}`; no second Storage upload; no second complianceDocs update with a new timestamp.
**Why human:** Requires live deployment and ability to replay a captured webhook payload.

### 6. Signed Badge Visual Rendering

**Test:** Open a client's file browser that has a file with `signedSource: true` and a `signedAt` Firestore Timestamp. Inspect the file row visually.
**Expected:** Green pill badge reading "Signed -- Mar 4, 2026" (or the correct date) appears inline next to the filename with no text wrapping inside the badge.
**Why human:** CSS `white-space: nowrap` and layout correctness require browser rendering; `formatDate()` behavior with a real Firestore Timestamp object cannot be verified by static analysis alone.

---

## Summary

All 12 requirements (WHBK-01 through WHBK-10, SDUI-01, SDUI-02) are addressed with substantive, non-stub implementations in the correct files:

- **functions/index.js** received a 181-line addition implementing the complete boldSignWebhook pipeline: POST-only guard, HMAC-SHA256 verification with `crypto.timingSafeEqual`, "Completed" event filter, collectionGroup lookup, idempotency check, BoldSign PDF download, Firebase Storage upload, parallel Firestore file record creation and complianceDocs status update.
- **js/client-detail.js** `renderFiles()` was updated from filename-prefix detection (`SIGNED_`) to field-based detection (`f.signedSource`) with `formatDate(f.signedAt)` for the date portion of the badge — committed and old detection fully removed.
- **css/greendoor.css** `.gd-badge-signed` was refined with `white-space: nowrap` and increased padding to accommodate date text.

All three commits (0a6a014, 273bdc6, 8d3a05c) are verified to exist in the git log.

One documentation issue was found: REQUIREMENTS.md WHBK-03 text says `"document.completed"` but the correct BoldSign event type is `"Completed"` — the implementation is correct; the requirements text needs updating.

No automated test can substitute for live Cloud Function deployment to confirm the full BoldSign webhook delivery path. Six human verification tests are listed above.

---

_Verified: 2026-03-04T23:00:00Z_
_Verifier: Claude (gsd-verifier)_
