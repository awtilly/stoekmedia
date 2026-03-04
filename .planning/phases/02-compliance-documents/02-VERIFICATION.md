---
phase: 02-compliance-documents
verified: 2026-03-04T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
re_verification: false
human_verification:
  - test: "Navigate to a client detail page and verify the 6th Compliance Docs tab is visible and clickable"
    expected: "Tab appears after Properties tab; clicking it shows compliance-list content (loading or forms)"
    why_human: "Tab visibility and correct DOM ordering requires browser rendering"
  - test: "Set a client's transaction type to 'SFH - Buyer', then click Compliance Docs tab"
    expected: "Shows Purchase Agreement, Agency Disclosure, Lead Paint Disclosure, and Buyer Representation Agreement rows (4 forms). HOA Addendum, Listing Agreement, Seller's Disclosure are NOT shown."
    why_human: "Requires live Firestore documentTemplates data (collection must be seeded) and browser rendering"
  - test: "View a client with NO transaction type set, then open Compliance Docs tab"
    expected: "All forms appear dimmed/disabled and a yellow warning banner reads 'Set a transaction type on the Overview tab to enable compliance documents.'"
    why_human: "Visual state (disabled opacity, banner text) requires browser"
  - test: "Click 'Send' on any template row for a client that has an email address"
    expected: "Confirm dialog opens showing: recipient name + email, document name, listing dropdown, merge field preview rows (with field name on left and resolved value on right), and a warning for any empty fields"
    why_human: "Dialog rendering and merge field resolution with live data requires browser"
  - test: "Verify signature request emails show realtor name/email as sender (requires deployed Cloud Functions and an approved BoldSign sender identity)"
    expected: "Email recipient sees realtor's name and email as the From/sender, not BoldSign defaults"
    why_human: "Requires actual BoldSign API call with deployed functions; cannot verify programmatically"
---

# Phase 2: Compliance Documents Verification Report

**Phase Goal:** Realtors can send Missouri compliance documents for e-signature directly from a client's record, with merge fields auto-filled from client/listing/agent data and the realtor's name shown as sender
**Verified:** 2026-03-04
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Client detail page has a Compliance Docs tab showing only forms relevant to the client's transaction type | VERIFIED | `app/client-detail.html` line 77: `<button class="gd-tab" data-tab="compliance">Compliance Docs</button>`; `js/client-detail.js` lines 2808–2816: filters `complianceTemplates` by `clientData.transactionType` |
| 2 | Each form row shows name, category badge, required indicator, and current status (not sent / sent / signed) | VERIFIED | `js/client-detail.js` lines 2874–2882: renders row with `gd-compliance-name`, `gd-badge-{category}`, `gd-required-asterisk`, and `formatComplianceStatus(status, signedAt)` |
| 3 | Realtor can click "Send for Signature" and the document is sent via BoldSign with client/listing/agent fields pre-filled | VERIFIED | `js/client-detail.js` line 3079: calls `sendComplianceDocFn`; `functions/index.js` lines 218–248: resolves merge fields via `resolveServerMergeFields` and calls `POST /v1/template/send` with `existingFormFields` |
| 4 | Signature request emails show the realtor's display name and email address, not BoldSign defaults | VERIFIED* | `functions/index.js` lines 207–236: reads `agentProfile.email || request.auth.token.email`; sets `sendBody.onBehalfOf = senderEmail` when sender identity is approved. *Conditional: requires approved BoldSign sender identity — needs human to confirm email appearance |
| 5 | Status updates from Firestore appear in real time without a page refresh | VERIFIED | `js/client-detail.js` lines 2899–2908: `startComplianceListener` uses `onSnapshot` on `collection(db, "clients", cid, "complianceDocs")`; triggers `renderComplianceList()` on each change |

**Score:** 5/5 success criteria verified (automated checks pass)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `functions/index.js` | createSenderIdentity and sendComplianceDoc + sendBulkComplianceDocs Cloud Functions | VERIFIED | File exists, 482 lines, valid syntax, all three exports present |
| `functions/package.json` | Node 18 engine, firebase-admin ^12.x, firebase-functions ^4.x | VERIFIED | Node 18 engine, `firebase-admin: ^12.0.0`, `firebase-functions: ^4.0.0` |
| `functions/seed-templates.js` | Seed script for documentTemplates collection | VERIFIED | File exists, valid syntax, batch-writes 7 MO forms to `documentTemplates` with deterministic IDs and `merge: true` |
| `js/compliance.js` | buildMergeFields, MO_FORM_STUBS, COMPLIANCE_STATUSES, COMPLIANCE_CATEGORIES, formatComplianceStatus | VERIFIED | All 5 exports confirmed: lines 20, 26, 104, 238, 281 |
| `app/client-detail.html` | 6th tab button + tab-compliance content div + confirm dialog modal | VERIFIED | Line 77 (tab button), line 347 (tab-compliance div), line 926 (compliance-confirm-modal) |
| `js/client-detail.js` | loadComplianceTemplates, renderComplianceList, startComplianceListener, send flow, window exposures | VERIFIED | All functions present; window.openSendDialog, window.closeComplianceConfirm, window.confirmAndSendCompliance exposed at lines 3210–3212 |
| `css/greendoor.css` | Compliance row styles, 3 status badge colors, category headers, confirm dialog styles | VERIFIED | `.gd-compliance-row` (line 6522), `.gd-badge-compliance-notsent/sent/signed` (lines 6560/6569/6578), `.gd-compliance-category-header` (line ~6592), `.gd-confirm-section` (line 6608) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `js/client-detail.js` compliance tab | Firestore `documentTemplates` | `getDocs(query(collection(db, "documentTemplates"), orderBy("sortOrder")))` | WIRED | Line 2799–2800: query exists and results stored in `complianceTemplates` |
| `js/client-detail.js` send flow | `sendComplianceDocFn` Cloud Function | `httpsCallable` invocation | WIRED | Line 62 (declaration), line 3079 (invocation with templateId/clientId/listingId) |
| `js/client-detail.js` bulk send flow | `sendBulkComplianceDocsFn` Cloud Function | `httpsCallable` invocation with templateIds array | WIRED | Line 63 (declaration), line 3180 (invocation inside `handleBulkComplianceSend`) |
| `functions/index.js` sendComplianceDoc | BoldSign API `/v1/template/send` | `fetch` with `existingFormFields` and `onBehalfOf` | WIRED | Lines 239–248: fetch call to `https://api.boldsign.com/v1/template/send?templateId=...` |
| `functions/index.js` sendBulkComplianceDocs | BoldSign API `/v1/template/mergeAndSend` | `fetch` bundling multiple templates | WIRED | Line 374: fetch to `https://api.boldsign.com/v1/template/mergeAndSend`; fallback to sequential sends at line 437 |
| `js/client-detail.js` status listener | Firestore `clients/{clientId}/complianceDocs` | `onSnapshot` on subcollection | WIRED | Lines 2901–2908: `onSnapshot(collection(db, "clients", cid, "complianceDocs"), ...)` triggers `renderComplianceList()` |
| `functions/index.js` sendComplianceDoc | Firestore `clients/{clientId}/complianceDocs/{templateId}` | `setDoc` after successful BoldSign send | WIRED | Lines 260–268: `db.doc(clients/${clientId}/complianceDocs/${templateId}).set({...})` |
| `functions/index.js` createSenderIdentity | BoldSign Sender Identity API | `fetch` to `senderIdentities/create` | WIRED | Line 63: `fetch("https://api.boldsign.com/v1/senderIdentities/create", ...)` |
| `functions/index.js` createSenderIdentity | Firestore `users/{uid}` | `userRef.update({boldSignSenderIdentityStatus, boldSignSenderEmail})` | WIRED | Lines 84–87: writes `boldSignSenderIdentityStatus: "pending_approval"` and `boldSignSenderEmail` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BSND-01 | 02-01-PLAN.md | Document signature emails show realtor's display name as sender | SATISFIED | `functions/index.js` line 236: `sendBody.onBehalfOf = senderEmail`; `createSenderIdentity` stores realtor `fullName` in BoldSign via line 71 |
| BSND-02 | 02-01-PLAN.md | Document signature emails show realtor's email address as sender/reply-to | SATISFIED | `functions/index.js` line 51 (createSenderIdentity) and line 207 (sendComplianceDoc): `senderEmail` set as `onBehalfOf` |
| BSND-03 | 02-01-PLAN.md | Sender name and email fetched from realtor's Firestore profile (users/{uid}) | SATISFIED | `functions/index.js` lines 30–37 (createSenderIdentity reads profile), lines 200–207 (sendComplianceDoc reads `agentProfile`) |
| BSND-04 | 02-01-PLAN.md | If Firestore profile email missing, fall back to Firebase Auth email | SATISFIED | `functions/index.js` line 51: `userData.email \|\| request.auth.token.email`; line 207: same pattern in sendComplianceDoc |
| COMP-01 | 02-02-PLAN.md | Firestore `documentTemplates` collection stores template metadata | SATISFIED | `functions/seed-templates.js` lines 233–249: batch-writes 7 templates to `documentTemplates` with full schema (name, transactionTypes, boldSignTemplateId, mergeFields, category, required, sortOrder) |
| COMP-02 | 02-02-PLAN.md | Template library seeded with 7 MO residential forms as stubs | SATISFIED | `js/compliance.js` lines 104–221: 7 entries in `MO_FORM_STUBS`; `functions/seed-templates.js` seeds same 7 forms; 7 empty `boldSignTemplateId` confirmed |
| COMP-03 | 02-02-PLAN.md | Utility function `buildMergeFields` resolves field mappings from client/listing/agent data | SATISFIED | `js/compliance.js` lines 238–268: dot-path resolution at line 253 (`field.source.split(".")`); returns `{ existingFormFields, missing }` |
| COMP-04 | 02-03-PLAN.md | New "Compliance Docs" tab on client detail page | SATISFIED | `app/client-detail.html` line 77 (tab button), line 347 (tab content div) |
| COMP-05 | 02-03-PLAN.md | Tab shows templates filtered by client's transaction type, grouped by category | SATISFIED | `js/client-detail.js` lines 2808–2816 (filtering), lines 2854–2884 (category grouping with collapsible headers) |
| COMP-06 | 02-03-PLAN.md | Each row shows name, category badge, required indicator, and status | SATISFIED | `js/client-detail.js` lines 2874–2882: all four elements rendered per row |
| COMP-07 | 02-03-PLAN.md | "Send for Signature" button calls Cloud Function that autofills BoldSign template with merge fields | SATISFIED | `functions/index.js` lines 218–248: `resolveServerMergeFields` called, result passed as `existingFormFields` in BoldSign API call |
| COMP-08 | 02-03-PLAN.md | Cloud Function sets senderDetail to realtor's name/email from Firestore profile | SATISFIED | `functions/index.js` lines 200–236: reads `agentProfile`, resolves `senderEmail`, conditionally sets `onBehalfOf` |
| COMP-09 | 02-03-PLAN.md | Sent document ID and status saved to clients/{clientId}/complianceDocs/{templateId} | SATISFIED | `functions/index.js` lines 260–268: `db.doc(clients/${clientId}/complianceDocs/${templateId}).set(...)` with `boldSignDocumentId`, `status: "sent"`, `sentAt`, `sentBy`, `listingId` |
| COMP-10 | 02-03-PLAN.md | Real-time status display updates from Firestore without page refresh | SATISFIED | `js/client-detail.js` lines 2899–2908: `onSnapshot` on `complianceDocs` subcollection triggers `renderComplianceList()` |

All 14 requirement IDs confirmed in REQUIREMENTS.md with Phase 2 assignment. No orphaned requirements found for this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `functions/index.js` | 264 | `require("firebase-admin/firestore").FieldValue.serverTimestamp()` inline require | Info | FieldValue is imported once at top via `getFirestore` but `FieldValue` is re-required inline instead of being destructured at the top. Works correctly but is inconsistent. |
| `functions/index.js` | 352 | `const FieldValue = require("firebase-admin/firestore").FieldValue` inline require | Info | Same as above — second location. Module is already loaded so this is just style, not a functional issue. |

No blocker or warning anti-patterns found. Both items are informational style inconsistencies only.

### Human Verification Required

### 1. Compliance Docs Tab Visible in Browser

**Test:** Open any client detail page in the browser
**Expected:** A 6th tab labeled "Compliance Docs" appears after the "Properties" tab in the tab bar
**Why human:** Tab rendering and ordering requires a live browser

### 2. Transaction Type Filtering Works

**Test:** Set a client's transaction type to "SFH - Buyer" on the Overview tab, then click the Compliance Docs tab
**Expected:** Only 4 forms appear: Purchase Agreement, Agency Disclosure, Lead Paint Disclosure, Buyer Representation Agreement. HOA Addendum, Listing Agreement, and Seller's Disclosure do NOT appear. The `documentTemplates` collection must be seeded first (`cd functions && node seed-templates.js`).
**Why human:** Requires live Firestore data from the seeded `documentTemplates` collection and browser rendering

### 3. No Transaction Type Shows Disabled State

**Test:** View a client with no transaction type set, open Compliance Docs tab
**Expected:** All 7 forms appear dimmed (opacity reduced) with a yellow/amber warning banner at the top reading "Set a transaction type on the Overview tab to enable compliance documents." The bulk send toolbar is hidden.
**Why human:** Visual disabled state (CSS opacity, banner visibility) requires browser

### 4. Send Confirm Dialog Populates Correctly

**Test:** On a client with "SFH - Buyer" transaction type and at least one email address, click "Send" on the Purchase Agreement row
**Expected:** A modal opens showing: recipient section with client name + email, document section with "Purchase Agreement", a listing dropdown (empty if no listings matched, or listing addresses if matched), and a merge field preview table. Fields with data show values; fields without data show "(empty)" in red italic. If any fields are empty, a warning banner lists them.
**Why human:** Dialog rendering and live merge field resolution with real Firestore data requires browser

### 5. Realtor Name/Email Appears as Sender in BoldSign Email

**Test:** Deploy Cloud Functions to Firebase, configure BOLDSIGN_API_KEY environment variable, call `createSenderIdentity` (approve the email link), add a real BoldSign template ID to a `documentTemplates` Firestore document, then send it via the UI
**Expected:** The client receives a signature request email with the realtor's name and email address in the "From" field, not BoldSign's default sender
**Why human:** Requires deployed Cloud Functions, approved BoldSign sender identity, and an actual BoldSign API call — cannot be verified programmatically

---

## Gaps Summary

No automated gaps found. All 5 success criteria pass all three verification levels (exists, substantive, wired). All 14 requirement IDs are implemented and traceable to code. The verification status is `human_needed` because the final delivery — sender identity showing the realtor's name in BoldSign emails — requires a live browser and deployed infrastructure to confirm end-to-end.

**Noteworthy implementation details verified:**
- The sendComplianceDoc Cloud Function gracefully degrades when sender identity is not approved: it logs a warning but proceeds without `onBehalfOf`, so sends still work while the realtor completes BoldSign approval
- The `documentTemplates` collection must be seeded before the Compliance Docs tab will show forms (run `cd functions && node seed-templates.js`)
- All seven MO forms have empty `boldSignTemplateId` values — real BoldSign template IDs must be pasted into Firestore after creating templates in the BoldSign dashboard before actual sends will succeed
- The bulk send flow uses `sendBulkComplianceDocs` which attempts BoldSign `mergeAndSend` (single envelope) with automatic fallback to sequential per-template sends

---

_Verified: 2026-03-04_
_Verifier: Claude (gsd-verifier)_
