# Phase 3: Webhook Pipeline - Research

**Researched:** 2026-03-04
**Domain:** BoldSign webhooks, Firebase Cloud Functions v2 HTTP triggers, HMAC verification, Firebase Storage Admin SDK
**Confidence:** HIGH

## Summary

Phase 3 implements a BoldSign webhook Cloud Function that receives `Completed` events, verifies HMAC signatures, downloads the signed PDF from BoldSign, uploads it to Firebase Storage under the client's closing documents path, creates a Firestore file record, updates the complianceDocs status to "signed", and renders green "Signed" badges in the UI. The entire pipeline runs server-side with no realtor interaction.

The existing codebase provides strong foundations: Cloud Functions already use `firebase-functions/v2/https` with `process.env.BOLDSIGN_API_KEY`, deterministic document IDs are an established pattern (Phase 1), the `formatComplianceStatus()` function already renders green "Signed" badges for the compliance tab (SDUI-01), and the `gd-badge-signed` CSS class already exists for file badges. The webhook function will be a new `onRequest` export alongside the existing `onCall` functions.

**Primary recommendation:** Add a single `boldSignWebhook` onRequest Cloud Function to `functions/index.js` that handles the entire pipeline (verify, download, upload, write), using deterministic Firestore document IDs for idempotency. On the UI side, replace the filename-prefix signed badge detection (`f.fileName.startsWith("SIGNED_")`) with a field-based check (`f.signedSource === true`) so the badge is driven by webhook data rather than naming conventions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Cloud Function uses `onRequest` (HTTP endpoint), not `onCall` -- BoldSign POSTs directly to it
- Only processes events where `type === "Completed"` -- all other event types get a 200 OK and are ignored
- Trust BoldSign API docs for payload structure -- no debug endpoint first; fix during testing if payload differs
- Filename convention: `{TemplateName}_signed_{YYYY-MM-DD}.pdf` (e.g., `Agency_Disclosure_signed_2026-03-04.pdf`)
- Firebase Storage path: `clients/{clientId}/closing-documents/{filename}` -- dedicated closing subfolder
- File record created in Firestore `files` collection with `folderId` pointing to the Closing Documents folder (deterministic ID: `${clientId}_closing_documents`)
- Duplicate events always return 200 OK to BoldSign -- standard webhook practice to stop retries
- SDUI-01 (Compliance Docs tab): Current `formatComplianceStatus()` behavior is sufficient -- webhook just updates the underlying Firestore data
- SDUI-02 (Files tab): Green "Signed" badge placed next to the filename in the file row -- small pill badge
- Badge content: "Signed -- {date}" (includes the signed date)
- Badge color: should match or be consistent with the existing green from `formatComplianceStatus()`

### Claude's Discretion
- HMAC verification implementation details (header name, hash algorithm)
- Secret storage mechanism (process.env pattern vs Firebase defineSecret)
- Invalid request response handling and logging strategy
- File record field naming for signed source identification
- Cross-reference strategy between files and complianceDocs records
- Idempotency implementation (check-before-write vs deterministic IDs vs transactions)
- Error handling for BoldSign API failures during PDF download
- Retry/timeout behavior for the webhook function

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WHBK-01 | HTTP Cloud Function at /boldSignWebhook receives BoldSign completion events | onRequest from firebase-functions/v2/https; BoldSign POSTs JSON to configured URL |
| WHBK-02 | Webhook verifies HMAC signature using req.rawBody and BOLDSIGN_WEBHOOK_SECRET | X-BoldSign-Signature header with t=timestamp,s0=hash; HMAC-SHA256 with `${timestamp}.${rawBody}`; rawBody is Buffer on Firebase req |
| WHBK-03 | Only processes events where eventType === "Completed" | BoldSign event at `event.eventType` field; value is "Completed" (capital C); return 200 for all other types |
| WHBK-04 | Looks up matching GreenDoor record by BoldSign document ID | Query complianceDocs subcollections via collectionGroup("complianceDocs") where boldSignDocumentId matches `data.documentId` |
| WHBK-05 | Downloads signed PDF from BoldSign API | GET `https://api.boldsign.com/v1/document/download?documentId={id}` with X-API-KEY header; returns binary PDF |
| WHBK-06 | Uploads signed PDF to Firebase Storage under client's closing path | Admin SDK: `getStorage().bucket().file(path).save(buffer, {contentType: "application/pdf"})` |
| WHBK-07 | Saves file metadata to Firestore with folderId pointing to Closing Documents folder | setDoc to `files/{deterministicId}` with folderId = `${clientId}_closing_documents`; needs realtorId from client doc or complianceDocs.sentBy |
| WHBK-08 | Updates complianceDocs status to "signed" with signedAt timestamp | Update `clients/{clientId}/complianceDocs/{templateId}` with status: "signed", signedAt: FieldValue.serverTimestamp() |
| WHBK-09 | Webhook is idempotent (duplicate events don't create duplicate files) | Deterministic file doc ID (e.g., `${clientId}_signed_${templateId}`) + setDoc = natural idempotency |
| WHBK-10 | Returns 200 OK to BoldSign after processing | Always res.status(200).send("OK") after successful processing or for ignored/duplicate events |
| SDUI-01 | Compliance Docs tab shows "Signed" with date when status === "signed" | Already implemented by formatComplianceStatus() + startComplianceListener onSnapshot -- webhook just writes the data |
| SDUI-02 | Files in Closing Documents folder with signed: true display green "Signed" badge | Modify renderFiles() to check `f.signedSource === true` instead of `f.fileName.startsWith("SIGNED_")`; use existing gd-badge-signed class with date |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| firebase-functions | ^4.0.0 | Cloud Functions v2 runtime | Already in functions/package.json; provides onRequest for HTTP endpoints |
| firebase-admin | ^12.0.0 | Server-side Firestore + Storage | Already in functions/package.json; Admin SDK for server writes |
| Node.js crypto | built-in | HMAC-SHA256 verification | Built-in module; no external dependency needed |
| Node.js native fetch | built-in (Node 18) | BoldSign API calls | Already used in existing Cloud Functions; no node-fetch needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| firebase-admin/firestore | ^12.0.0 | FieldValue.serverTimestamp(), collectionGroup queries | Timestamp writes and cross-collection lookups |
| firebase-admin/storage | ^12.0.0 | Bucket file save | Uploading signed PDF buffer to Storage |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| process.env for secrets | defineSecret from firebase-functions/params | defineSecret is more secure (Secret Manager) but adds complexity; process.env already established in this codebase |
| collectionGroup query | Denormalized index collection | collectionGroup is simpler for low-volume lookups; index collection adds write complexity |

**No new dependencies needed.** Everything required is already in `functions/package.json`.

## Architecture Patterns

### Recommended Project Structure
```
functions/
  index.js          # Add boldSignWebhook export alongside existing onCall functions

js/
  client-detail.js  # Modify renderFiles() for signed badge (SDUI-02)

css/
  greendoor.css     # Minor CSS updates to gd-badge-signed for date display
```

### Pattern 1: Webhook Pipeline (Single Function, Sequential Steps)
**What:** One `onRequest` function that executes a linear pipeline: verify -> filter -> lookup -> download -> upload -> write -> respond
**When to use:** Low-volume webhook processing where simplicity trumps parallelism
**Why:** BoldSign webhook volume for a solo realtor is extremely low (a few per day at most). A single-function pipeline is simpler to debug and maintain.

```javascript
// Source: BoldSign docs + Firebase Functions v2 docs
const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");

exports.boldSignWebhook = onRequest({ region: "us-central1" }, async (req, res) => {
  // Step 1: Only accept POST
  if (req.method !== "POST") { return res.status(405).send("Method not allowed"); }

  // Step 2: Verify HMAC signature
  const sigHeader = req.headers["x-boldsign-signature"];
  if (!sigHeader || !verifySignature(sigHeader, req.rawBody, process.env.BOLDSIGN_WEBHOOK_SECRET)) {
    return res.status(401).send("Invalid signature");
  }

  // Step 3: Parse and filter event type
  const body = req.body;
  const eventType = body?.event?.eventType;
  if (eventType !== "Completed") { return res.status(200).send("OK"); }

  // Step 4: Extract documentId and process
  const documentId = body?.data?.documentId;
  // ... lookup, download, upload, write ...

  return res.status(200).send("OK");
});
```

### Pattern 2: HMAC Verification with BoldSign Header Format
**What:** Parse `X-BoldSign-Signature` header which contains `t=timestamp,s0=signature[,s1=oldsignature]`
**When to use:** Every incoming webhook request

```javascript
// Source: BoldSign developer docs - verify-webhook-events
function verifyBoldSignSignature(signatureHeader, rawBody, secret) {
  if (!signatureHeader || !secret) return false;

  // Parse "t=1668693823, s0=abc123, s1=def456"
  const parts = {};
  signatureHeader.split(",").forEach(part => {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") parts.timestamp = value;
    else if (key === "s0") parts.currentSig = value;
    else if (key === "s1") parts.previousSig = value;
  });

  if (!parts.timestamp || !parts.currentSig) return false;

  // Construct signed payload: timestamp + "." + rawBody
  const payload = parts.timestamp + "." + rawBody.toString("utf8");
  const computed = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(parts.currentSig));
  } catch {
    return false;
  }
}
```

### Pattern 3: Deterministic Document IDs for Idempotency
**What:** Use `setDoc` with a deterministic ID so duplicate events overwrite rather than duplicate
**When to use:** File records and status updates that must be idempotent (WHBK-09)
**Established pattern:** Already used for Closing Documents folder (`${clientId}_closing_documents`) in Phase 1

```javascript
// Deterministic file record ID: one signed file per template per client
const fileDocId = `${clientId}_signed_${templateId}`;
await db.doc(`files/${fileDocId}`).set({
  clientId,
  realtorId, // from complianceDocs.sentBy or client.realtorId
  fileName: `${templateName}_signed_${dateStr}.pdf`,
  storagePath,
  downloadUrl,
  folderId: `${clientId}_closing_documents`,
  fileSize: pdfBuffer.length,
  mimeType: "application/pdf",
  signedSource: true,
  signedAt: FieldValue.serverTimestamp(),
  complianceTemplateId: templateId,
  uploadedAt: FieldValue.serverTimestamp()
});
```

### Pattern 4: CollectionGroup Query for Document Lookup
**What:** Find complianceDocs record by boldSignDocumentId across all clients
**When to use:** Webhook provides BoldSign document ID but not client ID (WHBK-04)

```javascript
// Source: Firebase Admin SDK docs
const snapshot = await db.collectionGroup("complianceDocs")
  .where("boldSignDocumentId", "==", documentId)
  .limit(1)
  .get();

if (snapshot.empty) {
  console.warn("No matching complianceDocs record for documentId:", documentId);
  return res.status(200).send("OK"); // Don't retry for unknown docs
}

const docSnap = snapshot.docs[0];
const templateId = docSnap.id;
const clientId = docSnap.ref.parent.parent.id; // clients/{clientId}/complianceDocs/{templateId}
```

### Anti-Patterns to Avoid
- **Returning non-2xx for unknown documents:** BoldSign will retry. Always return 200 for events you choose not to process.
- **Using `addDoc` for webhook-created files:** Creates duplicates on retry. Always use `setDoc` with deterministic IDs.
- **Parsing body twice:** Use `req.body` (already parsed by Firebase) for data access and `req.rawBody` (Buffer) only for HMAC verification.
- **Blocking on Storage upload before Firestore write:** These can run in parallel with `Promise.all` since they are independent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC signature verification | Custom hash comparison | `crypto.timingSafeEqual()` | Prevents timing attacks; built-in Node.js |
| PDF download | Custom HTTP client | Native `fetch()` with `.arrayBuffer()` | Already established in codebase; returns binary |
| Storage upload from buffer | Custom streaming | `bucket.file(path).save(buffer)` | Admin SDK one-liner; handles metadata |
| Idempotency | Transaction locks or dedup tables | Deterministic doc IDs + `setDoc` | Natural idempotency; zero additional infrastructure |
| Signed badge on compliance tab | New rendering logic | Existing `formatComplianceStatus()` | Already handles "signed" status with date badge |

**Key insight:** The existing codebase patterns (deterministic IDs, native fetch, FieldValue.serverTimestamp) directly apply to the webhook function. The only truly new code is the HMAC verification and the PDF download-upload pipeline.

## Common Pitfalls

### Pitfall 1: rawBody Not Being a String
**What goes wrong:** HMAC computation fails because `req.rawBody` is a Buffer, not a string
**Why it happens:** Firebase Functions provides rawBody as a Buffer. The BoldSign signed payload requires `timestamp + "." + rawBody_as_utf8_string`.
**How to avoid:** Always call `req.rawBody.toString("utf8")` before constructing the HMAC payload.
**Warning signs:** HMAC verification fails for every request; 401 responses to all webhooks.

### Pitfall 2: BoldSign Event Type Casing
**What goes wrong:** Event filter misses completed events
**Why it happens:** BoldSign uses `"Completed"` (capital C), not `"completed"` or `"document.completed"`. The event type is at `event.eventType`, not at a top-level `type` field.
**How to avoid:** Use `body.event.eventType === "Completed"` -- exact match, case-sensitive.
**Warning signs:** Webhook receives events but never processes any.

### Pitfall 3: Missing realtorId on Webhook-Created File Records
**What goes wrong:** Files created by webhook are invisible in the UI because Firestore queries filter by `realtorId`
**Why it happens:** The webhook has no authenticated user. The `files` collection queries in client-detail.js filter `where("realtorId", "==", uid)`.
**How to avoid:** Read `realtorId` from either `complianceDocs.sentBy` (set during Phase 2 send) or from the client document's `realtorId` field.
**Warning signs:** File uploads succeed in Storage but never appear in the Files tab.

### Pitfall 4: Firestore CollectionGroup Index Missing
**What goes wrong:** `collectionGroup("complianceDocs").where("boldSignDocumentId", "==", ...)` throws an error
**Why it happens:** Collection group queries require a composite index. Firestore will return an error URL with the exact index to create.
**How to avoid:** Run the function once in testing; Firestore will provide the exact index creation URL in the error message. Create the index before production use.
**Warning signs:** Function logs show "FAILED_PRECONDITION: The query requires an index" error.

### Pitfall 5: Storage Download URL Not Accessible
**What goes wrong:** File record has a Storage path but no accessible download URL for the browser
**Why it happens:** Admin SDK `file.save()` uploads the file but doesn't generate a Firebase download URL token automatically.
**How to avoid:** After uploading, generate a signed URL with `file.getSignedUrl({ action: 'read', expires: '03-01-2030' })` or use `file.makePublic()` and construct the public URL. Alternatively, set the download token metadata during upload.
**Warning signs:** File appears in the UI but clicking it gives a 403 error.

### Pitfall 6: PDF Download Returns Non-PDF Response
**What goes wrong:** BoldSign API returns HTML error page or JSON error instead of binary PDF
**Why it happens:** Invalid documentId, expired document, or API key issue. The fetch response is not checked for content-type.
**How to avoid:** Check `response.ok` and `response.headers.get("content-type")` before treating the body as PDF binary.
**Warning signs:** Storage contains HTML files named as PDFs; file preview shows garbled text.

## Code Examples

### Complete HMAC Verification

```javascript
// Source: BoldSign docs - developers.boldsign.com/webhooks/verify-webhook-events/
const crypto = require("crypto");

function verifyBoldSignSignature(signatureHeader, rawBody, secret) {
  if (!signatureHeader || !secret) return false;

  // Parse header: "t=1668693823, s0=abc123def"
  const parts = {};
  signatureHeader.split(",").forEach(segment => {
    const trimmed = segment.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      parts[trimmed.substring(0, eqIdx)] = trimmed.substring(eqIdx + 1);
    }
  });

  const timestamp = parts["t"];
  const signature = parts["s0"];
  if (!timestamp || !signature) return false;

  // Signed payload: timestamp + "." + rawBody (as UTF-8 string)
  const signedPayload = timestamp + "." + (Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
  const computed = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
```

### Download Signed PDF from BoldSign

```javascript
// Source: BoldSign docs - developers.boldsign.com/documents/download-document/
async function downloadSignedPdf(documentId, apiKey) {
  const response = await fetch(
    `https://api.boldsign.com/v1/document/download?documentId=${encodeURIComponent(documentId)}`,
    {
      method: "GET",
      headers: { "X-API-KEY": apiKey }
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`BoldSign download failed (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

### Upload Buffer to Firebase Storage (Admin SDK)

```javascript
// Source: Firebase Admin SDK docs
const { getStorage } = require("firebase-admin/storage");

async function uploadToStorage(storagePath, buffer, metadata) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    contentType: "application/pdf",
    metadata: { metadata: metadata || {} }
  });

  // Generate a signed URL valid for a long period
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: "2030-01-01"
  });

  return signedUrl;
}
```

### Webhook File Record Schema

```javascript
// File record created by webhook in files collection
{
  clientId: "abc123",
  realtorId: "uid456",                    // from complianceDocs.sentBy
  fileName: "Agency_Disclosure_signed_2026-03-04.pdf",
  storagePath: "clients/abc123/closing-documents/Agency_Disclosure_signed_2026-03-04.pdf",
  downloadUrl: "https://storage.googleapis.com/...",
  folderId: "abc123_closing_documents",   // deterministic Closing Documents folder ID
  fileSize: 245760,
  mimeType: "application/pdf",
  signedSource: true,                     // flag for SDUI-02 badge
  signedAt: FieldValue.serverTimestamp(),  // when signing was completed
  complianceTemplateId: "purchase_agreement", // cross-reference to template
  boldSignDocumentId: "bs-doc-789",       // cross-reference to BoldSign
  uploadedAt: FieldValue.serverTimestamp()
}
```

### Signed Badge in renderFiles() (SDUI-02)

```javascript
// Modified badge detection in renderFiles()
// OLD: const signedBadge = f.fileName.startsWith("SIGNED_") ? '...' : '';
// NEW: Field-based detection driven by webhook data
const signedBadge = f.signedSource
  ? ` <span class="gd-badge-signed">Signed${f.signedAt ? " &mdash; " + formatDate(f.signedAt) : ""}</span>`
  : "";
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Filename prefix detection (`SIGNED_`) | Field-based `signedSource: true` | This phase | Reliable badge rendering not dependent on naming |
| firebase-functions v1 functions.https.onRequest | firebase-functions/v2/https onRequest | Already in codebase | Region config, better options object |
| functions.config() for secrets | process.env or defineSecret | v2 migration | process.env already used for BOLDSIGN_API_KEY |

**Deprecated/outdated:**
- `functions.config()`: Deprecated in v2; use `process.env` or `defineSecret` instead (project already uses process.env)
- BoldSign SDK npm package: Not needed; native fetch with X-API-KEY header is simpler and already established

## Open Questions

1. **CollectionGroup Index for complianceDocs**
   - What we know: `collectionGroup("complianceDocs").where("boldSignDocumentId", "==", ...)` requires a Firestore index
   - What's unclear: Whether the index needs to be created manually via Firebase console or if the error message during first test run provides a direct creation link
   - Recommendation: Deploy and test once; Firestore will generate the exact index URL. Click it to create. This is standard Firebase workflow.

2. **Storage Download URL Generation on Server**
   - What we know: Client-side uses `getDownloadURL()` from Firebase Storage SDK. Server-side Admin SDK uses `getSignedUrl()` or `makePublic()`.
   - What's unclear: Whether `getSignedUrl()` requires a service account key file or works automatically in Cloud Functions environment
   - Recommendation: Use `getSignedUrl({ action: "read", expires: "2030-01-01" })` -- it works automatically in Cloud Functions because the default service account has signing permissions. If it fails, fall back to constructing the public URL pattern.

3. **BoldSign Webhook Payload Field: `event.eventType` vs `data.event`**
   - What we know: Official docs show `event.eventType` for the type, `data.documentId` for the document. Multiple code examples access `payloadObject.data.documentId`.
   - What's unclear: The exact nesting may vary; STATE.md notes a blocker to "log the raw payload to confirm header name and event payload structure"
   - Recommendation: Trust the documented structure (`body.event.eventType` and `body.data.documentId`), add defensive logging of the full payload on first few invocations, and fix if needed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None -- no test framework detected in project |
| Config file | none -- see Wave 0 |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WHBK-01 | HTTP endpoint receives POST | manual | Deploy + BoldSign test webhook | N/A |
| WHBK-02 | HMAC signature verification | manual | Send forged request, verify 401 | N/A |
| WHBK-03 | Only processes "Completed" events | manual | Send non-Completed event, verify 200 no-op | N/A |
| WHBK-04 | Lookup by BoldSign document ID | manual | Verify Firestore record found after send | N/A |
| WHBK-05 | Download signed PDF | manual | Verify PDF buffer received from BoldSign API | N/A |
| WHBK-06 | Upload to Storage closing path | manual | Check Firebase Storage after webhook fires | N/A |
| WHBK-07 | File metadata in Firestore | manual | Check files collection after webhook | N/A |
| WHBK-08 | Status updated to "signed" | manual | Check complianceDocs status in Firestore | N/A |
| WHBK-09 | Idempotent on duplicate events | manual | Fire same webhook twice, verify single file | N/A |
| WHBK-10 | Returns 200 OK | manual | Check BoldSign webhook delivery log | N/A |
| SDUI-01 | Compliance tab shows "Signed" | manual | View client detail page after signing | N/A |
| SDUI-02 | Files tab shows green signed badge | manual | View Closing Documents folder after signing | N/A |

### Sampling Rate
- **Per task commit:** Manual verification via Firebase emulator or deployed test
- **Per wave merge:** Full end-to-end: send doc via BoldSign, complete signing, verify webhook pipeline
- **Phase gate:** All 12 requirements manually verified before `/gsd:verify-work`

### Wave 0 Gaps
- No test framework exists -- all validation is manual for this project
- Cloud Functions emulator testing recommended but not required (manual deploy + test is the established pattern)
- CollectionGroup index must be created before WHBK-04 can work

*(No automated test infrastructure to set up -- project relies on manual verification)*

## Sources

### Primary (HIGH confidence)
- [BoldSign Webhook Verification Docs](https://developers.boldsign.com/webhooks/verify-webhook-events/) -- HMAC-SHA256 verification, X-BoldSign-Signature header format, Node.js code example
- [BoldSign Document Download API](https://developers.boldsign.com/documents/download-document/) -- GET /v1/document/download endpoint, X-API-KEY auth, binary PDF response
- [BoldSign Available Events](https://developers.boldsign.com/webhooks/available-events/) -- 16 document event types; "Completed" is the all-signers-done event
- [BoldSign Event Metadata](https://developers.boldsign.com/webhooks/event-metadata/) -- event.id, event.created, event.eventType, event.environment structure
- [BoldSign Sample Event Data](https://developers.boldsign.com/webhooks/sample-event-data/) -- Completed event payload includes data.documentId, senderDetail, signerDetails

### Secondary (MEDIUM confidence)
- [Firebase Functions rawBody GitHub Issue](https://github.com/firebase/firebase-functions/issues/1338) -- req.rawBody is a Buffer; available in v2 onRequest at runtime
- [DEV.to BoldSign Webhook Tutorial](https://dev.to/boldsign/automatically-download-esignature-documents-using-webhook-callbacks-247f) -- payload.data.documentId access pattern confirmed across Node.js/Python/PHP examples
- [Firebase Configure Environment](https://firebase.google.com/docs/functions/config-env) -- defineSecret from firebase-functions/params; process.env alternative

### Tertiary (LOW confidence)
- BoldSign payload exact nesting: `body.event.eventType` vs other structures -- STATE.md notes pre-work to log raw payload. Research converges on this structure but recommend defensive logging.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies; everything already in functions/package.json
- Architecture: HIGH -- patterns directly extend existing codebase (deterministic IDs, native fetch, FieldValue)
- HMAC verification: HIGH -- BoldSign official docs provide Node.js example with exact header format
- BoldSign payload structure: MEDIUM -- multiple sources agree on event.eventType + data.documentId but STATE.md flagged as needing live verification
- Storage upload from Admin SDK: HIGH -- well-documented Firebase Admin pattern
- Pitfalls: HIGH -- identified from real-world Firebase + webhook integration patterns

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable APIs, no breaking changes expected)
