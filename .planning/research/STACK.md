# Stack Research

**Domain:** Real estate CRM — document management, compliance templates, webhook automation, iCal sync
**Researched:** 2026-03-04
**Confidence:** MEDIUM (WebSearch/WebFetch unavailable in this session; based on verified training knowledge with confidence flags per item)

---

## Context

This is an **additive milestone** on an existing Firebase stack (Firebase 10.8.0 CDN, vanilla JS, Cloud Functions in Node.js/us-central1). The question is not "what should we build on?" — it is "what libraries and patterns do we add to the Cloud Functions package.json and frontend to support these four capability areas?"

Existing BoldSign integration already works for basic send/status/embedded-sign. This research focuses on the **new capabilities** required: merge-field pre-fill, sender customization (on-behalf-of), webhook signature verification, document download after signing, iCal feed parsing, Firestore folder patterns, and Cloud Functions scheduled-task + HTTP-webhook patterns.

---

## Recommended Stack

### Core Technologies (Cloud Functions backend)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| BoldSign REST API | v1 (current) | Merge field prefill, sender customization, webhook delivery, document download | Already integrated; REST API supports all new capabilities without SDK; direct HTTP calls via `node-fetch` or `axios` keep the dependency footprint minimal |
| `node-ical` | ^0.19.x (latest stable) | Parse iCal/webcal feeds from ShowingTime | Most widely used iCal parser for Node.js; handles VEVENT, VTIMEZONE, recurring events, and remote URL fetching natively; maintained and actively used in production |
| `node-fetch` | ^3.x (ESM) or `^2.x` (CommonJS) | HTTP requests from Cloud Functions to BoldSign REST API and iCal URL fetching | Node 18+ (Firebase Functions runtime) has native `fetch` built in; prefer native `fetch` over adding a dependency unless Cloud Functions runtime is locked to Node 16 |
| Firebase Admin SDK | ^12.x | Firestore writes from Cloud Functions (save signed PDFs, update checklist, write showings) | Already present in Cloud Functions; use `getFirestore()` and `getStorage()` from `firebase-admin` |
| Firebase Functions v2 | ^4.x (`firebase-functions`) | Scheduled functions (30-min iCal sync), HTTP webhook endpoint (BoldSign events) | v2 scheduler uses Cloud Scheduler syntax; HTTP functions verify raw body for HMAC; must be used for webhook raw body access |

### Supporting Libraries (Cloud Functions backend)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-ical` | ^0.19.x | Parse `.ics` content or fetch webcal:// URLs and return structured event objects | Only needed in the `syncShowingTimeFeed` Cloud Function. Do NOT use on the frontend — parsing happens server-side only |
| `crypto` (Node built-in) | built-in | HMAC-SHA256 verification of BoldSign webhook signatures | Use `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')` — no third-party library needed for HMAC |
| `axios` | ^1.6.x | HTTP client for BoldSign REST calls if native fetch is unavailable | Only add if Cloud Functions Node runtime is 16 (no native fetch). If runtime is Node 18+, use native `fetch` instead and skip this dependency |

### Cloud Functions Patterns (no additional libraries)

| Pattern | Firebase Feature | Purpose | Notes |
|---------|-----------------|---------|-------|
| Scheduled function | `onSchedule` (v2) | Run iCal sync every 30 minutes | Uses Cloud Scheduler cron syntax; requires `firebase-functions` v4+ and Functions v2 |
| HTTP trigger (public) | `onRequest` (v2) | Receive BoldSign webhook POST calls | Must use `onRequest` not `onCall` — BoldSign POSTs to a URL, it does not use Firebase callable protocol |
| Callable function | `onCall` (v1 or v2) | Client-initiated actions (send compliance doc, generate checklist) | Existing pattern already used; continue for user-triggered flows |
| Firestore trigger | `onDocumentWritten` (v2) | React to envelope status changes if needed | Optional; webhook-driven approach is more reliable than polling |

---

## BoldSign API Capabilities (NEW — what's needed for this milestone)

### Sender Customization (On-Behalf-Of / From Name+Email)

**Capability:** BoldSign allows overriding the sender display name and email in the API payload. This does NOT require a separate BoldSign account per realtor. The API accepts `senderDetail` fields on the `POST /v1/document/send` request body.

**Fields to set on send request:**
```json
{
  "senderDetail": {
    "name": "Jane Smith",
    "email": "jane@realty.com"
  }
}
```

**Constraint:** The sender email must be verified in BoldSign (or the account must have the domain whitelisted). For a solo-agent scenario, the realtor's email from their GreenDoor profile (`users/{uid}.email`) is set here. The GreenDoor Cloud Function reads the realtor's profile and injects these fields before calling BoldSign.

**Confidence:** MEDIUM — sender override is a documented BoldSign feature; exact field name (`senderDetail` vs `senderIdentityName`) should be confirmed against current BoldSign API docs at `https://developers.boldsign.com` before implementation.

### Merge Fields / Prefill Fields

**Capability:** BoldSign supports pre-populating form fields on a template before sending. When using a Template ID, the `POST /v1/document/sendwithtemplate` endpoint accepts a `roles` array where each role can carry `formFields` with a `value` property to prefill.

**Pattern for compliance doc send:**
```json
{
  "templateId": "template-id-from-boldsign-dashboard",
  "roles": [
    {
      "roleIndex": 1,
      "signerName": "Client Full Name",
      "signerEmail": "client@email.com",
      "formFields": [
        { "id": "field_id_from_template", "value": "123 Main St, St. Louis, MO 63101" },
        { "id": "client_name_field", "value": "Jane Buyer" },
        { "id": "agent_name_field", "value": "Agent Smith" }
      ]
    }
  ]
}
```

**GreenDoor data sources for merge fields:**
- `clients/{clientId}` — buyer/seller name, email, phone, address
- `listings/{listingId}` — property address, price
- `users/{uid}` — agent name, email, license number (add to user profile if not present)

**Confidence:** MEDIUM — merge field prefill via `sendwithtemplate` is a documented BoldSign feature; field IDs must come from the BoldSign template definition. Template field IDs are set when creating/editing templates in the BoldSign dashboard.

### Webhook Signature Verification

**Capability:** BoldSign signs webhook POST payloads with HMAC-SHA256 using a secret configured in the BoldSign dashboard (Webhooks section). The signature is sent in an HTTP header.

**Header name:** `X-BoldSign-Signature` (confirm exact header name in BoldSign webhook docs)

**Verification pattern in Cloud Function:**
```javascript
const crypto = require('crypto');

function verifyBoldSignWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)  // rawBody must be the raw Buffer, NOT parsed JSON
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  );
}
```

**Critical:** The Cloud Function must access the raw request body BEFORE any JSON parsing. With Firebase Functions v2 `onRequest`, the `req.rawBody` Buffer is available. Do NOT use `req.body` (already parsed) for HMAC computation — this will always fail.

**Confidence:** HIGH for the HMAC pattern (standard practice); MEDIUM for the exact header name — verify in BoldSign dashboard or docs.

### Webhook Events to Handle

BoldSign fires events for document lifecycle. Relevant events for this milestone:

| Event | Trigger | GreenDoor Action |
|-------|---------|-----------------|
| `documentCompleted` | All signers have signed | Download signed PDF → save to Firebase Storage → update `envelopes` doc → auto-complete checklist items |
| `documentDeclined` | Signer declined | Update `envelopes` status → notify agent |
| `documentExpired` | Document expired | Update `envelopes` status |
| `documentViewed` | Signer opened document | Optional: log activity |

**Confidence:** MEDIUM — event names vary by BoldSign API version; confirm against current webhook documentation.

### Document Download After Signing

**Capability:** After `documentCompleted`, download the signed PDF via:

```
GET /v1/document/download?documentId={id}&downloadType=Combined
```

Response: binary PDF stream. The Cloud Function pipes this to Firebase Storage using `admin.storage().bucket().file(path).save(buffer)`.

**Storage path pattern:**
```
clients/{clientId}/closing-documents/{documentId}-signed.pdf
```

**Confidence:** MEDIUM — download endpoint exists in BoldSign v1 API; exact query params should be verified.

---

## iCal Feed Parsing (ShowingTime)

### Library: `node-ical`

**Why `node-ical` over alternatives:**
- `ical.js` — browser-focused, requires manual HTTP fetching; `node-ical` handles URL fetching natively
- `ical-generator` — for generating/writing iCal files, not parsing; wrong tool
- `cal-parser` — less maintained, fewer stars
- Raw regex parsing — fragile against timezone edge cases in ShowingTime feeds

**Usage pattern in Cloud Function:**

```javascript
const ical = require('node-ical');

// Fetch and parse a webcal feed (pass https:// URL, not webcal://)
async function fetchShowingTimeFeed(webcalUrl) {
  // Convert webcal:// to https://
  const httpsUrl = webcalUrl.replace(/^webcal:\/\//i, 'https://');

  const events = await ical.async.fromURL(httpsUrl);

  const showings = [];
  for (const key of Object.keys(events)) {
    const event = events[key];
    if (event.type !== 'VEVENT') continue;

    showings.push({
      uid: event.uid,
      summary: event.summary,
      start: event.start,        // Date object
      end: event.end,            // Date object
      location: event.location,
      description: event.description,
      source: 'showingtime',
    });
  }
  return showings;
}
```

**Key behaviors of `node-ical`:**
- `ical.async.fromURL(url)` fetches the URL and parses in one call
- Returns a flat object keyed by UID; iterate with `Object.keys()`
- `event.start` and `event.end` are JavaScript `Date` objects (handles timezone conversion)
- Filter `event.type !== 'VEVENT'` to skip `VCALENDAR`, `VTIMEZONE` entries
- Recurring events are expanded — each occurrence appears as a separate key

**Deduplication strategy:** Store `uid` from the iCal event in the Firestore `showings` document. On each sync, query existing `source: 'showingtime'` showings by `uid` and upsert rather than insert to prevent duplicates.

**Confidence:** HIGH for node-ical API shape and webcal URL conversion — this is well-established Node.js iCal tooling.

---

## Firestore Folder/File Organization

### Pattern: Virtual Folders via Metadata Fields

Firestore has no native directory structure. The correct pattern is to add `folderId` and `folderName` metadata fields to each document in the `files` collection. Folders are stored as a separate lightweight collection.

**Recommended schema:**

```
folders/{folderId}
  - clientId: string
  - realtorId: string
  - name: string          // "Closing Documents", "Offers", "Disclosures"
  - createdAt: Timestamp
  - isSystem: boolean     // true for auto-created "Closing Documents" folder

files/{fileId}
  - clientId: string
  - realtorId: string
  - folderId: string | null   // null = root (unfiled)
  - name: string
  - size: number
  - mimeType: string
  - storageUrl: string
  - storagePath: string       // add this — needed for deletion and download
  - createdAt: Timestamp
  - source: string            // 'upload' | 'boldsign_signed' | 'template'
```

**Why this over alternatives:**
- Subcollections (`clients/{id}/folders/{folderId}/files/{fileId}`) — harder to query across all files for a client; migration from existing flat `files` collection is more complex
- Storage folder paths only (no Firestore metadata) — no way to rename folders or list them without Storage listing API (which is expensive and doesn't support Firestore queries)
- This flat-collection-with-folderId approach matches the existing `files` collection structure and requires only adding two fields

**Auto-creating "Closing Documents" folder:**

When a new client is created (or when the compliance sprint ships, for existing clients via a migration), run:

```javascript
const closingFolderRef = await addDoc(collection(db, 'folders'), {
  clientId,
  realtorId,
  name: 'Closing Documents',
  createdAt: serverTimestamp(),
  isSystem: true,
});
// Optionally save closingFolderId back to the client document
await updateDoc(doc(db, 'clients', clientId), {
  closingFolderId: closingFolderRef.id
});
```

Saving `closingFolderId` on the client document avoids a query to find the closing folder when the webhook needs to route a signed PDF.

**Moving files between folders:**

```javascript
await updateDoc(doc(db, 'files', fileId), { folderId: newFolderId });
```

No Storage move required — only the Firestore metadata changes.

**Confidence:** HIGH — this virtual-folder-via-metadata pattern is the standard approach for Firestore file organization.

---

## Firebase Cloud Functions Patterns

### Scheduled Function (30-minute iCal Sync)

Use Cloud Functions v2 `onSchedule`. Requires `firebase-functions` v4+.

```javascript
const { onSchedule } = require('firebase-functions/v2/scheduler');

exports.syncShowingTimeFeeds = onSchedule({
  schedule: 'every 30 minutes',
  timeZone: 'America/Chicago',  // Central time for St. Louis
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async (event) => {
  // 1. Query users where showingTimeFeedUrl is set
  // 2. For each user, fetch and parse their iCal feed
  // 3. Upsert showings to Firestore (dedup by uid)
});
```

**v1 alternative** (`pubsub.schedule`): Still works but v2 is the current recommendation and has better timeout/memory configuration.

**Confidence:** HIGH — `onSchedule` v2 syntax is current Firebase Functions v2 API.

### HTTP Webhook Endpoint (BoldSign Events)

Use `onRequest` (v2). Do NOT use `onCall` — BoldSign POSTs a plain HTTP request, not the Firebase callable protocol.

```javascript
const { onRequest } = require('firebase-functions/v2/https');

exports.boldSignWebhook = onRequest({
  region: 'us-central1',
  cors: false,  // No CORS needed for server-to-server webhooks
}, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // Verify HMAC signature using req.rawBody
  const signature = req.headers['x-boldsign-signature'];
  const secret = process.env.BOLDSIGN_WEBHOOK_SECRET;

  if (!verifyBoldSignWebhook(req.rawBody, signature, secret)) {
    return res.status(401).send('Invalid signature');
  }

  const payload = req.body;  // JSON-parsed body (Firebase parses automatically)
  const eventType = payload.event?.type;  // confirm field name in BoldSign docs

  if (eventType === 'documentCompleted') {
    await handleDocumentCompleted(payload);
  }

  res.status(200).send('OK');
});
```

**Critical configuration:** Register the webhook URL in the BoldSign dashboard under Settings > Webhooks. The URL will be:
`https://us-central1-greendoor-2da47.cloudfunctions.net/boldSignWebhook`

**Secret storage:** Use Firebase Functions config or Google Secret Manager — NOT hardcoded. For solo-agent simplicity, `process.env.BOLDSIGN_WEBHOOK_SECRET` set via Firebase environment config:

```bash
firebase functions:config:set boldsign.webhook_secret="your-secret-here"
```

Or use Firebase Functions v2 with Google Secret Manager for production security.

**Confidence:** HIGH — `onRequest` v2 pattern is current; `req.rawBody` availability on Firebase Functions v2 HTTP triggers is confirmed behavior.

### Callable Functions (User-Initiated Compliance Actions)

Continue using the existing `onCall` pattern. Add new callable functions:

- `sendComplianceDoc` — fetch template, prefill merge fields, call BoldSign `sendwithtemplate`
- `generateClosingChecklist` — call OpenAI with client/transaction context to produce checklist items
- `checkComplianceDocStatus` — poll BoldSign for envelope status (same as existing `checkSignatureStatus`, may just extend it)

---

## Installation

These are additions to the Cloud Functions `package.json` (which lives in the `functions/` directory of the Firebase project, separate from the frontend):

```bash
# In functions/ directory
npm install node-ical

# node-fetch only needed if Cloud Functions runtime is Node 16
# Firebase Functions v2 defaults to Node 18 which has native fetch
# npm install node-fetch@2  # CommonJS-compatible

# No additional npm installs needed for:
# - HMAC verification (crypto is Node built-in)
# - Firestore/Storage (firebase-admin already present)
# - Firebase Functions scheduling (firebase-functions already present)
```

**Verify current Node runtime in `functions/package.json`:**
```json
{
  "engines": { "node": "18" }
}
```

If it says `"16"`, upgrade to `"18"` to get native `fetch` and latest Functions v2 APIs.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `node-ical` | `ical.js` | If running in a browser context where HTTP fetching must be manual; not applicable here since parsing is server-side |
| `node-ical` | Raw iCal regex parsing | Never — timezone handling alone makes this a maintenance nightmare |
| Native `fetch` (Node 18) | `axios` | If stuck on Node 16 runtime — axios handles CommonJS and has better error messages; otherwise unnecessary dependency |
| `crypto` (built-in) | `jsonwebtoken` or `crypto-js` | Never for HMAC-only use case — built-in is simpler and has `timingSafeEqual` |
| Virtual folder metadata in `files` collection | Firestore subcollections | If you need folder-level security rules or very deep nesting (neither applies here) |
| `onSchedule` v2 | Cloud Scheduler + Pub/Sub manually | Only if you need exact-second precision or complex pub/sub fan-out; not needed for a 30-minute sync |
| BoldSign `sendwithtemplate` | Upload document + configure fields via API | Only if you need fully dynamic fields not defined in a template; template approach is simpler for compliance docs with known field sets |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ical-generator` | Generates iCal files — it writes, it doesn't read | `node-ical` for parsing |
| `crypto-js` (npm) | Adds ~50KB and an npm dependency for something Node's built-in `crypto` does natively | `require('crypto')` — already in Node |
| `onCall` for BoldSign webhook | Firebase callable protocol wraps payloads in `{data: ...}`; BoldSign sends raw JSON POST — these are incompatible | `onRequest` (v2) for webhook endpoint |
| `req.body` for HMAC verification | Body is already parsed (Buffer → object) by Firebase; HMAC over a JS object string will never match | `req.rawBody` (Buffer) before parsing |
| Firestore subcollections for folders | Requires migrating existing flat `files` collection; complicates cross-folder queries | Flat `files` collection with `folderId` field |
| Storing BoldSign webhook secret in `firebase-config.js` (frontend) | Exposes secret to browser; webhook secret is server-only | Firebase Functions environment config or Google Secret Manager |
| `webcal://` URL passed directly to `node-ical.fromURL` | `webcal://` is not a valid HTTP scheme; most HTTP clients reject it | Replace with `https://` before passing to `fromURL` |

---

## Stack Patterns by Variant

**If Cloud Functions runtime is Node 16:**
- Add `node-fetch@2` (CommonJS-compatible) to `functions/package.json`
- Use `const fetch = require('node-fetch')` instead of native fetch
- Upgrade to Node 18 ASAP — Node 16 is end-of-life

**If Node 18+ (recommended):**
- Use native `fetch()` — no additional HTTP library needed
- `onSchedule` v2 and all Firebase Functions v2 features are available

**If BoldSign webhook secret management becomes a concern:**
- Migrate from `functions:config` to Google Secret Manager
- Use `defineSecret` from `firebase-functions/params` in v2 functions
- Secret is never stored in source code or Firebase Console plaintext

**If multiple realtors need their own ShowingTime feeds:**
- Store `showingTimeFeedUrl` on `users/{uid}` document
- Scheduled function queries all users with a feed URL and processes each
- Firestore showings tagged with `realtorId` to prevent cross-agent data leakage

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `node-ical@0.19.x` | Node 18, Node 20 | Async API (`ical.async.fromURL`) requires Node 12+; no known issues with Firebase Functions Node 18 |
| `firebase-functions@4.x` (v2) | `firebase-admin@12.x` | v2 functions require `firebase-functions` v4+; do not mix v1 and v2 in the same function if using `onSchedule` |
| `firebase-admin@12.x` | Firebase Functions v2 | Admin SDK 12.x includes `getFirestore()` and `getStorage()` from `firebase-admin/firestore` and `firebase-admin/storage` |
| Native `fetch` | Node 18 runtime | Node 18 includes `fetch` globally; no import needed; Node 16 does NOT have it |

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| BoldSign sender customization fields | MEDIUM | Feature is documented; exact JSON field names need verification against current API docs before coding |
| BoldSign merge field prefill via `sendwithtemplate` | MEDIUM | Core feature is stable; field ID format comes from template definition and must be confirmed empirically |
| BoldSign webhook HMAC pattern | HIGH | Standard HMAC-SHA256 webhook verification — industry-standard pattern; exact header name needs doc verification |
| `node-ical` library and API | HIGH | Stable, widely used library; `async.fromURL` API is well-established |
| `webcal://` → `https://` conversion | HIGH | `webcal://` is just an alias scheme; HTTP clients require `https://` — this is documented behavior |
| Firestore virtual folder pattern | HIGH | Standard Firestore pattern for simulating directory structure; well-documented community practice |
| Firebase `onSchedule` v2 syntax | HIGH | Current Firebase Functions v2 API; matches official Firebase documentation |
| Firebase `onRequest` v2 + `req.rawBody` | HIGH | `rawBody` availability on Firebase HTTP triggers is documented behavior |
| Node 18 native fetch availability | HIGH | Node 18 LTS includes native `fetch`; Firebase Functions defaults to Node 18 for new deployments |

---

## Open Questions / Flags for Implementation

1. **BoldSign field name for sender override** — Is it `senderDetail.name` / `senderDetail.email`, or a flat `senderIdentityName` / `senderIdentityEmail`? Verify at `https://developers.boldsign.com/docs/api/send-document-using-template` before coding the compliance send function.

2. **BoldSign webhook header name** — Is it `X-BoldSign-Signature` or `x-boldsign-hmac-signature`? Check BoldSign dashboard > Webhooks section or API docs. Implementation is identical regardless — just the header key changes.

3. **BoldSign webhook event field structure** — Confirm `payload.event.type` vs `payload.eventType` in the webhook POST body. Do a test delivery from the BoldSign dashboard and log the raw payload first.

4. **BoldSign template field IDs** — These are set when the template is created in the BoldSign UI. The GreenDoor codebase will need a mapping (e.g., a Firestore `complianceTemplates` collection) that stores `{ templateId, fields: [{ id, mergeKey }] }` so the Cloud Function knows which field IDs to populate with which client data.

5. **ShowingTime feed authentication** — Does the ShowingTime webcal URL include an auth token in the URL itself, or does it require HTTP Basic Auth? Most ShowingTime feeds are token-authenticated via the URL (e.g., `https://showingtime.com/calendar/{personal-token}.ics`). If HTTP Basic Auth is needed, `node-ical.async.fromURL` supports passing headers.

6. **Existing files collection migration** — Current `files` docs do not have a `folderId` field. When the folder UI ships, existing files should be treated as `folderId: null` (unfiled). No migration script is needed — simply handle `null` folderId as "root" in the frontend rendering logic.

---

## Sources

- `.planning/PROJECT.md` — Project requirements, active milestone scope, constraints (LOCAL, HIGH confidence)
- `.planning/codebase/STACK.md` — Existing Firebase 10.8.0 stack and CDN-loaded SDK pattern (LOCAL, HIGH confidence)
- `.planning/codebase/INTEGRATIONS.md` — Current BoldSign Cloud Function patterns, envelope collection schema (LOCAL, HIGH confidence)
- `.planning/codebase/ARCHITECTURE.md` — Firestore collection schemas, Cloud Function list, data flow (LOCAL, HIGH confidence)
- BoldSign REST API documentation — `https://developers.boldsign.com` (NOT fetched this session — MEDIUM confidence for field names; HIGH confidence for feature existence based on training data)
- `node-ical` npm package — `https://www.npmjs.com/package/node-ical` (NOT fetched this session — HIGH confidence based on training data; package is stable and widely used)
- Firebase Functions v2 documentation — `https://firebase.google.com/docs/functions` (NOT fetched this session — HIGH confidence for `onSchedule`/`onRequest` v2 API based on training data)

---

*Stack research for: GreenDoor CRM — document management, compliance, webhook, iCal milestone*
*Researched: 2026-03-04*
