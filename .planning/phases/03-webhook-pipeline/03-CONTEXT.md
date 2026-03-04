# Phase 3: Webhook Pipeline - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

When a client signs a compliance document via BoldSign, the signed PDF automatically appears in their Closing Documents folder and the document status updates to "signed" — without any manual action from the realtor. This phase adds: a BoldSign webhook Cloud Function with HMAC verification, signed PDF download and Storage upload, Firestore status updates, idempotent event handling, and signed document badges in the UI.

</domain>

<decisions>
## Implementation Decisions

### Webhook security & validation
- Cloud Function uses `onRequest` (HTTP endpoint), not `onCall` — BoldSign POSTs directly to it
- Only processes events where `type === "document.completed"` — all other event types get a 200 OK and are ignored
- Invalid/forged requests: Claude's discretion on response handling and logging approach
- BOLDSIGN_WEBHOOK_SECRET storage: Claude's discretion, but should follow existing `process.env.BOLDSIGN_API_KEY` pattern
- Trust BoldSign API docs for payload structure — no debug endpoint first; fix during testing if payload differs

### Signed PDF handling
- Filename convention: `{TemplateName}_signed_{YYYY-MM-DD}.pdf` (e.g., `Agency_Disclosure_signed_2026-03-04.pdf`)
- Firebase Storage path: `clients/{clientId}/closing-documents/{filename}` — dedicated closing subfolder, NOT the generic files path
- File record created in Firestore `files` collection with `folderId` pointing to the Closing Documents folder (deterministic ID: `${clientId}_closing_documents`)
- File record flag for signed source: Claude's discretion on field name/approach that best supports SDUI-02 badge
- Cross-references between file record and complianceDocs record: Claude's discretion on whether one-way or two-way links are needed

### Idempotency strategy
- Dedup approach: Claude's discretion based on solo-agent volume (low throughput)
- Duplicate events always return 200 OK to BoldSign — standard webhook practice to stop retries
- Deterministic file record ID approach: Claude's discretion, but the Phase 1 pattern of deterministic IDs (setDoc) is preferred if it fits

### Signed document badges
- SDUI-01 (Compliance Docs tab): Current `formatComplianceStatus()` behavior is sufficient — shows green "Signed — Mar 4, 2026" badge. Webhook just updates the underlying Firestore data.
- SDUI-02 (Files tab): Green "Signed" badge placed **next to the filename** in the file row — small pill badge, visible at a glance
- Badge content: "Signed — {date}" (includes the signed date, not just "Signed")
- Badge color: Claude's discretion, but should match or be consistent with the existing green from `formatComplianceStatus()`

### Claude's Discretion
- HMAC verification implementation details (header name, hash algorithm)
- Secret storage mechanism (process.env pattern vs Firebase defineSecret)
- Invalid request response handling and logging strategy
- File record field naming for signed source identification
- Cross-reference strategy between files and complianceDocs records
- Idempotency implementation (check-before-write vs deterministic IDs vs transactions)
- Error handling for BoldSign API failures during PDF download
- Retry/timeout behavior for the webhook function

</decisions>

<specifics>
## Specific Ideas

- The signed badge next to the filename should feel like a lightweight tag — consistent with the status badges on the compliance tab
- "Signed — Mar 4" format keeps both contexts (compliance tab and files tab) visually aligned
- Closing Documents subfolder in Storage provides clean physical separation from manually uploaded files

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `functions/index.js`: Existing Cloud Functions with `process.env.BOLDSIGN_API_KEY`, native fetch, and `require("firebase-admin/firestore").FieldValue` pattern
- `formatComplianceStatus()` in `js/compliance.js`: Already handles "signed" status with date display — renders green badge
- `ensureClosingDocumentsFolder()` in `js/client-detail.js`: Creates Closing Documents folder with deterministic ID `${clientId}_closing_documents`
- `showToast()` from `js/auth.js`: Available for any UI notifications
- `escapeHtml()` from `js/auth.js`: Required for rendering badge text safely

### Established Patterns
- Cloud Functions: `onCall` with `{ region: "us-central1" }` — webhook will use `onRequest` instead
- Firestore writes: `db.doc()` with `setDoc()` for deterministic IDs, `FieldValue.serverTimestamp()` for timestamps
- File metadata in `files` collection: includes `clientId`, `realtorId`, `folderId`, `name`, `url`, `createdAt`
- Compliance doc status at `clients/{clientId}/complianceDocs/{templateId}`: includes `boldSignDocumentId`, `status`, `sentAt`, `signedAt`
- Real-time listeners: `onSnapshot()` on complianceDocs subcollection drives live status updates on compliance tab

### Integration Points
- `functions/index.js`: Add `boldSignWebhook` as new `onRequest` export
- `js/client-detail.js`: Modify file row rendering to show signed badge when file has signed source flag (SDUI-02)
- `css/greendoor.css`: Add `.gd-signed-badge` styles for the green pill badge
- Firestore `files` collection: Add signed-source field(s) to file records created by webhook
- Firestore `clients/{clientId}/complianceDocs/{templateId}`: Webhook updates `status` to "signed" and sets `signedAt`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-webhook-pipeline*
*Context gathered: 2026-03-04*
