# Architecture Research

**Domain:** Firebase/Firestore real estate CRM — document management, compliance, webhooks, checklists, calendar sync
**Researched:** 2026-03-04
**Confidence:** HIGH (codebase-verified patterns; all recommendations derive from existing code conventions)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser (Vanilla JS)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │client-detail │  │  calendar.js  │  │  dashboard.js│           │
│  │    .js       │  │              │  │              │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                  │                   │
│  ┌──────▼─────────────────▼──────────────────▼────────────────┐  │
│  │              firebase-config.js (auth, db, storage, fn)    │  │
│  └──────┬─────────────────┬──────────────────┬────────────────┘  │
└─────────┼─────────────────┼──────────────────┼───────────────────┘
          │                 │                  │
          ▼                 ▼                  ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│  Firestore   │  │ Cloud Functions  │  │  Firebase Storage    │
│              │  │ (us-central1)    │  │                      │
│  files       │  │                  │  │  files/{uid}/{cid}/  │
│  folders     │  │ [callable]       │  │    {folder}/{name}   │
│  envelopes   │  │  sendForSig      │  │                      │
│  compliance  │  │  mergeCompliance │  │  compliance-templates│
│  Templates   │  │  askAssistant    │  │    /{templateId}/    │
│  checklist   │  │  syncShowingTime │  │                      │
│  Items       │  │                  │  └──────────────────────┘
│  showings    │  │ [http trigger]   │
│  showingTime │  │  boldSignWebhook │
│  Feeds       │  │                  │
│              │  │ [scheduled]      │
│              │  │  syncAllFeeds    │
└──────────────┘  └──────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `client-detail.js` | File/folder UI, compliance doc send, checklist display | Firestore, Storage, callable Cloud Functions |
| `calendar.js` | Render showings including ShowingTime-synced events | Firestore (showings, events, followUps) |
| `folders` collection | Metadata for named folders per client | Read by client-detail.js; written on client create |
| `files` collection | File references with `folderId` linking to folder | Read/written by client-detail.js; written by webhook fn |
| `complianceTemplates` collection | Global library of MO compliance docs with BoldSign IDs | Read by client-detail.js for template picker |
| `envelopes` collection | BoldSign envelope tracking | Written by sendForSignature fn; updated by webhook fn |
| `checklistItems` collection | Per-client closing checklist tasks | Written by AI fn and webhook fn; read/updated by client-detail.js |
| `showingTimeFeeds` collection | Per-user iCal feed URLs | Read by scheduled sync fn |
| `showings` collection | All showings (manual + ShowingTime-synced) | Read by calendar.js; written by sync fn |
| `boldSignWebhook` HTTP fn | Receives BoldSign event POST, saves signed PDF, updates envelope + checklist | Firestore, Storage, BoldSign API |
| `syncAllShowingTime` scheduled fn | Polls iCal feeds every 30 min, upserts showings | Firestore (showingTimeFeeds, showings) |

---

## Data Models

### Pattern: All New Collections Are Flat (Not Subcollections)

The existing codebase uses exclusively top-level collections with `clientId` and `realtorId` fields as foreign keys. Every existing collection (`files`, `activities`, `showings`, `envelopes`, `followUps`) follows this pattern. New collections must match.

**Rationale (verified from codebase):**
- `loadFiles()` uses `query(collection(db, "files"), where("clientId", "==", clientId), where("realtorId", "==", uid))` — requires compound index, works well at this scale
- `deleteClient()` loops over collection names and deletes with `clientId` queries — flat model makes cascade delete trivial
- Subcollections would require knowing parent doc paths; incompatible with delete loop and cross-client queries

### `folders` Collection (NEW)

Folder metadata documents. Files reference folders by `folderId`.

```
folders/{folderId}
  clientId:    string      // foreign key → clients
  realtorId:   string      // foreign key → users (for security rules)
  name:        string      // display name, e.g. "Closing Documents"
  system:      boolean     // true = protected (cannot rename or delete)
  createdAt:   Timestamp
```

**Auto-creation:** When a client is created, a Cloud Function or the create-client handler writes a `Closing Documents` folder with `system: true`. All other folders are user-created.

**Deletion rule:** Client-side: check `system === true` and block delete. Security rule: enforce same server-side.

### `files` Collection (EXISTING — extend with `folderId`)

Add `folderId` field to existing file documents. The existing `folder` string field remains for backward compatibility during transition but `folderId` becomes authoritative.

```
files/{fileId}
  clientId:    string      // existing
  realtorId:   string      // existing
  fileName:    string      // existing
  storagePath: string      // existing
  downloadUrl: string      // existing
  fileSize:    number      // existing
  mimeType:    string      // existing
  uploadedAt:  Timestamp   // existing
  folder:      string      // existing (keep for backward compat)
  folderId:    string      // NEW — foreign key → folders
  source:      string      // NEW — "upload" | "boldsign_signed" | "template_send"
```

**Storage path convention** (existing pattern, keep as-is):
```
files/{uid}/{clientId}/{folderName}/{fileName}
```

### `complianceTemplates` Collection (NEW)

Global library of Missouri compliance document templates. Not per-realtor. Admin-managed.

```
complianceTemplates/{templateId}
  name:              string      // "Purchase Agreement - SFH Buyer"
  description:       string
  boldSignTemplateId: string     // BoldSign dashboard template ID
  transactionTypes:  string[]    // ["sfh-buyer", "sfh-seller", "condo-buyer", ...]
  state:             string      // "MO" (future expansion)
  mergeFields:       object[]    // [{field: "BuyerName", source: "client.fullName"}, ...]
  required:          boolean     // true = always include in compliance pack
  sortOrder:         number      // display ordering
  createdAt:         Timestamp
  updatedAt:         Timestamp
```

**Merge field sources** (resolved by Cloud Function before BoldSign call):

| Source Path | Resolved From |
|-------------|---------------|
| `client.fullName` | `clients/{clientId}.fullName` |
| `client.email` | `clients/{clientId}.email` |
| `client.phone` | `clients/{clientId}.phone` |
| `agent.fullName` | `users/{uid}.fullName` |
| `agent.email` | `users/{uid}.email` |
| `agent.phone` | `users/{uid}.phone` |
| `agent.licenseNumber` | `users/{uid}.licenseNumber` |
| `listing.address` | `listings/{listingId}.address` (if linked) |
| `listing.price` | `listings/{listingId}.listingPrice` |
| `listing.propertyType` | `listings/{listingId}.propertyType` |

**Client schema extension:** Add `transactionType` field to `clients` documents:
```
clients/{clientId}
  transactionType:  string   // "sfh-buyer" | "sfh-seller" | "condo-buyer" | etc.
  linkedListingId:  string   // optional, for merge field resolution
```

### `checklistItems` Collection (NEW)

Per-client closing checklist. Seeded by AI based on transaction type. Auto-completed by webhook.

```
checklistItems/{itemId}
  clientId:      string      // foreign key → clients
  realtorId:     string      // for security rules
  title:         string      // "Purchase Agreement signed by both parties"
  category:      string      // "contract" | "inspection" | "financing" | "closing"
  status:        string      // "pending" | "complete" | "skipped"
  autoComplete:  object      // {trigger: "envelope_signed", envelopeType: "purchase_agreement"}
  completedAt:   Timestamp   // null until completed
  completedBy:   string      // "webhook" | "user" | "ai"
  sortOrder:     number
  createdAt:     Timestamp
```

**Auto-complete trigger:** BoldSign webhook receives `completed` event → finds matching checklist items where `autoComplete.envelopeType` matches the signed envelope's template type → updates `status: "complete"`, `completedAt`, `completedBy: "webhook"`.

### `showingTimeFeeds` Collection (NEW)

Per-user ShowingTime iCal feed configuration.

```
showingTimeFeeds/{feedId}
  realtorId:   string      // foreign key → users
  feedUrl:     string      // https:// iCal URL (webcal:// converted to https://)
  label:       string      // display name, e.g. "My ShowingTime Feed"
  active:      boolean
  lastSyncAt:  Timestamp   // set by scheduled fn
  lastError:   string      // null or error message from last sync
  createdAt:   Timestamp
```

### `showings` Collection (EXISTING — extend with sync fields)

Add fields to distinguish ShowingTime-synced showings from manual ones.

```
showings/{showingId}
  realtorId:    string      // existing
  clientId:     string      // existing (null for ShowingTime showings without match)
  listingId:    string      // existing (null for ShowingTime showings)
  address:      string      // existing
  showingDate:  Timestamp   // existing
  status:       string      // existing
  source:       string      // NEW — "manual" | "showingtime"
  externalId:   string      // NEW — iCal UID for deduplication (null for manual)
  feedId:       string      // NEW — foreign key → showingTimeFeeds (null for manual)
  readOnly:     boolean     // NEW — true = ShowingTime-synced, cannot edit
```

---

## Cloud Function Patterns

### Pattern 1: HTTP Trigger for BoldSign Webhook

BoldSign webhook MUST use an HTTP trigger function. Callable functions require Firebase Auth — external services cannot invoke them. HTTP triggers expose a public HTTPS URL.

```javascript
// functions/index.js
const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");

exports.boldSignWebhook = onRequest(async (req, res) => {
  // 1. Verify HMAC signature from BoldSign
  const signature = req.headers["x-boldsign-signature"];
  const hmac = crypto.createHmac("sha256", process.env.BOLDSIGN_WEBHOOK_SECRET);
  hmac.update(JSON.stringify(req.body));
  const expected = hmac.digest("hex");
  if (signature !== expected) {
    return res.status(401).send("Unauthorized");
  }

  // 2. Handle event types
  const { event, data } = req.body;
  if (event === "document.completed") {
    await handleDocumentCompleted(data);
  }

  res.status(200).send("OK");
});
```

**Why HTTP trigger (not callable):**
- BoldSign sends unauthenticated POST requests — callable functions reject these
- HTTP trigger URL is stable and configurable in BoldSign dashboard
- HMAC verification replaces Firebase Auth for security

**Webhook URL format:** `https://us-central1-{project-id}.cloudfunctions.net/boldSignWebhook`

### Pattern 2: Callable Functions for All Client-Initiated Actions

All existing callable functions (`sendForSignature`, `askAssistant`, etc.) use `httpsCallable`. New client-initiated backend functions follow the same pattern.

```javascript
// New callable: resolve merge fields and send compliance doc
exports.sendComplianceDoc = onCall(async (request) => {
  // request.auth is automatically verified
  const { templateId, clientId } = request.data;
  // ... resolve merge fields, call BoldSign API
});

// New callable: generate AI checklist
exports.generateChecklist = onCall(async (request) => {
  const { clientId } = request.data;
  // ... load client, call OpenAI, write checklistItems
});
```

**Client-side invocation (existing pattern):**
```javascript
const sendComplianceDocFn = httpsCallable(functions, "sendComplianceDoc");
const result = await sendComplianceDocFn({ templateId, clientId });
```

### Pattern 3: Scheduled Function for ShowingTime iCal Sync

Firebase scheduled functions (Cloud Scheduler via pub/sub) run on a cron schedule. No client invocation needed.

```javascript
// functions/index.js
const { onSchedule } = require("firebase-functions/v2/scheduler");

exports.syncAllShowingTimeFeeds = onSchedule("every 30 minutes", async () => {
  // 1. Query all active showingTimeFeeds docs
  // 2. For each feed: fetch iCal URL, parse events
  // 3. For each event: upsert to showings collection using externalId
});
```

**iCal parsing approach:** Use `node-ical` npm package in Cloud Functions. Parse VEVENT components, extract DTSTART, DTEND, SUMMARY, DESCRIPTION, UID. Store UID as `externalId`.

**Deduplication:** Before inserting, query `showings` where `externalId == event.uid && realtorId == uid`. If found, update; if not, create. This prevents duplicate showings on repeated syncs.

**Error isolation:** Wrap each feed sync in try/catch; write `lastError` to the feed doc on failure so other feeds continue syncing.

---

## Data Flow

### Document Folder Flow

```
User creates folder
  → client-detail.js addDoc("folders", {clientId, realtorId, name, system: false})
  → renderFolderTabs() re-renders folder filter buttons

User uploads file
  → user selects folder from dropdown
  → uploadBytesResumable to Storage path files/{uid}/{cid}/{folderName}/{filename}
  → addDoc("files", {..., folderId, source: "upload"})

User filters by folder
  → currentFileFolder = folderId
  → renderFiles() filters allFiles array client-side (no re-query)
```

### Compliance Document Send Flow

```
User selects transaction type on client overview
  → updateDoc("clients", {transactionType})

User opens Compliance Docs tab
  → client-detail.js: getDocs("complianceTemplates", where transactionTypes contains type)
  → renders template list with checkboxes

User selects template, clicks Send
  → sendComplianceDocFn({templateId, clientId}) [callable]
    → Cloud Function:
      1. getDoc("clients/{clientId}") — resolve client merge fields
      2. getDoc("users/{uid}") — resolve agent merge fields
      3. getDoc("listings/{listingId}") — resolve listing merge fields (if linked)
      4. getDoc("complianceTemplates/{templateId}") — get BoldSign template ID + field map
      5. Call BoldSign API: createEnvelope with pre-filled fields
      6. addDoc("envelopes", {boldSignId, clientId, templateType, status: "sent"})
      7. Return boldSignId
  → client-detail.js: open BoldSign embed or show "sent" toast
  → onSnapshot("envelopes/{id}") watches for status change (existing pattern)
```

### BoldSign Webhook Flow

```
BoldSign calls POST https://.../boldSignWebhook (event: document.completed)
  → boldSignWebhook HTTP function:
    1. Verify HMAC signature
    2. Extract boldSignId, signerEmail, downloadUrl
    3. Query "envelopes" where boldSignId == id → get clientId, realtorId, templateType
    4. Download signed PDF from BoldSign API
    5. Upload to Storage: files/{uid}/{clientId}/closing-documents/SIGNED_{name}.pdf
    6. addDoc("files", {clientId, folderId: closingDocsFolderId, source: "boldsign_signed"})
    7. updateDoc("envelopes/{id}", {status: "completed", completedAt})
    8. Query "checklistItems" where autoComplete.envelopeType == templateType
       → updateDoc each matching item: {status: "complete", completedBy: "webhook"}
    9. addDoc("activities", {type: "document_signed", subject: "..."})
```

### AI Checklist Generation Flow

```
User opens client, clicks "Generate Checklist"
  → generateChecklistFn({clientId}) [callable]
    → Cloud Function:
      1. getDoc("clients/{clientId}") — get transactionType, name, etc.
      2. Call OpenAI with system prompt seeded by transactionType
      3. Parse JSON response into checklist item array
      4. Batch write to "checklistItems" collection
      5. Return item count
  → client-detail.js: loadChecklistItems() → renderChecklist()

Envelope completed via webhook
  → matching checklistItems auto-completed (see Webhook Flow above)

User manually completes/skips item
  → updateDoc("checklistItems/{id}", {status, completedBy: "user"})
```

### ShowingTime iCal Sync Flow

```
Scheduled: every 30 minutes
  → syncAllShowingTimeFeeds Cloud Function:
    1. getDocs("showingTimeFeeds", where active == true)
    2. For each feed:
       a. Fetch feedUrl (https:// iCal text)
       b. Parse with node-ical: extract VEVENTs
       c. For each VEVENT:
          - Query showings where externalId == UID && realtorId == uid
          - If exists: updateDoc (update title, time if changed)
          - If not: addDoc("showings", {source: "showingtime", externalId, readOnly: true, ...})
       d. updateDoc("showingTimeFeeds/{id}", {lastSyncAt, lastError: null})
    3. On feed error: updateDoc feed with {lastError: message}

Calendar page loads
  → calendar.js: getDocs("showings", where realtorId == uid)
  → ReadOnly showings rendered with "ShowingTime" badge
  → Edit/delete actions disabled for readOnly === true events
```

---

## Recommended File/Module Changes

### New JS Modules

| Module | Purpose |
|--------|---------|
| `js/compliance.js` | Compliance template picker, merge field UI, send flow |
| `js/checklist.js` | Checklist rendering, manual complete/skip, generate trigger |

### Extend Existing Modules

| Module | Changes |
|--------|---------|
| `js/client-detail.js` | Add folder CRUD, folderId to upload flow, tabs for Compliance + Checklist |
| `js/calendar.js` | Render `source: "showingtime"` showings with badge, disable edit for readOnly |
| `js/settings.js` | ShowingTime feed URL input, save to `showingTimeFeeds` |

### New Cloud Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `boldSignWebhook` | HTTP (public) | Receive BoldSign events, save signed PDFs, update checklist |
| `sendComplianceDoc` | Callable | Resolve merge fields, call BoldSign template API |
| `generateChecklist` | Callable | AI-generate checklist items for client's transaction type |
| `syncAllShowingTimeFeeds` | Scheduled (30 min) | Parse iCal feeds, upsert showings |

---

## Suggested Build Order

Dependencies run top-to-bottom. Each phase can be built and deployed independently.

```
Phase 1: Folder Infrastructure
  → folders collection + CRUD in client-detail.js
  → Auto-create "Closing Documents" folder on client create
  → folderId field added to file upload flow
  UNBLOCKS: Phase 4 (webhook needs Closing Documents folderId to save signed PDFs)

Phase 2: Compliance Templates
  → complianceTemplates collection + seed data (stub BoldSign IDs)
  → transactionType on clients
  → sendComplianceDoc callable Cloud Function (merge field resolution)
  UNBLOCKS: Phase 3 (webhook needs envelope templateType from Phase 2 send flow)

Phase 3: BoldSign Webhook
  → boldSignWebhook HTTP function
  → Signed PDF auto-save to Closing Documents folder (needs Phase 1)
  → Envelope status auto-update
  UNBLOCKS: Phase 5 (checklist auto-complete needs webhook event)

Phase 4: Closing Checklist
  → checklistItems collection
  → generateChecklist callable (AI seeding)
  → Manual complete/skip in client-detail.js
  → Auto-complete hook in boldSignWebhook (needs Phase 3)

Phase 5: ShowingTime iCal Sync
  → showingTimeFeeds collection
  → Feed URL input in settings
  → syncAllShowingTimeFeeds scheduled function
  → Calendar readOnly badge rendering
  (Independent of Phases 1-4)
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Subcollections for Files or Folders

**What people do:** Store files at `clients/{clientId}/files/{fileId}` as a subcollection.

**Why it's wrong:** The existing codebase uses flat collections exclusively. The `deleteClient()` function loops over a hardcoded array of collection names (`["activities", "files", ...]`) and issues top-level collection queries. Subcollections are invisible to this loop and would cause orphaned data on client delete. Cross-client queries (e.g. "all signed files across all clients") also become impossible with subcollections.

**Do this instead:** Keep `files` as a top-level collection with `clientId` and `folderId` fields. Keep `folders` as a top-level collection with `clientId`. Update `deleteClient()` to include `folders` and `checklistItems` in the cleanup loop.

### Anti-Pattern 2: Callable Function for Webhook Receiver

**What people do:** Create a callable function and try to call it from BoldSign webhook configuration.

**Why it's wrong:** Firebase callable functions enforce Firebase Auth token validation. BoldSign sends unauthenticated POST requests — the callable SDK wrapper will reject them with a 401. The function will never process any webhook events.

**Do this instead:** Use `onRequest` (HTTP trigger) for the webhook endpoint. Verify the HMAC signature from the `x-boldsign-signature` header using a shared webhook secret configured in BoldSign dashboard.

### Anti-Pattern 3: Real-Time Listener for Webhook-Triggered Updates

**What people do:** Set up `onSnapshot` on `checklistItems` so the UI auto-updates when the webhook fires.

**Why it's wrong (for this project):** The existing architecture explicitly notes "No real-time listeners configured in current code — all one-time queries." Introducing `onSnapshot` for one feature creates inconsistent behavior and open connections. At solo-agent scale, polling on tab focus or user action is sufficient.

**Do this instead:** After webhook fires, the realtor will see updates the next time they load the client detail page or manually refresh the checklist. If real-time is desired later, add it consistently across all tabs — not just checklist.

### Anti-Pattern 4: Storing Merge Field Values in complianceTemplates

**What people do:** Pre-compute and cache `{BuyerName: "Jane Smith"}` in the template document after first send.

**Why it's wrong:** Client data changes. Cached values go stale. A client whose name was misspelled, corrected later, still gets old name in future sends.

**Do this instead:** Resolve merge fields dynamically at send time in the Cloud Function. The template stores only the field mapping schema (`{field: "BuyerName", source: "client.fullName"}`), never the resolved values.

### Anti-Pattern 5: Polling BoldSign for Webhook-Eligible Events

**What people do:** Keep using `checkSignatureStatusFn` polling to detect document completion and then save the signed PDF.

**Why it's wrong:** Polling is unreliable (misses events between polls), adds API call costs, and duplicates logic once the webhook is in place. The existing embed poll is a temporary fallback — it should not become the primary signed-PDF-save mechanism.

**Do this instead:** The webhook is the authoritative completion handler. The existing poll can remain as a fallback for the embed modal UX (detect status change to close the iframe), but the signed PDF save and checklist auto-complete must only happen in the webhook function to prevent duplicate writes.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| BoldSign (templates) | Callable fn → BoldSign REST API | Template IDs stored in `complianceTemplates`; stub IDs until real templates created in BoldSign |
| BoldSign (webhook) | HTTP trigger ← BoldSign POST | HMAC verification required; configure webhook URL in BoldSign dashboard |
| OpenAI (checklist) | Callable fn → existing `askAssistant` pattern or direct | Reuse OpenAI client already in Cloud Functions; session-only (no history stored) |
| ShowingTime (iCal) | Scheduled fn → HTTPS fetch iCal URL | `webcal://` URLs must be converted to `https://` before fetch; no auth on feed URL |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `client-detail.js` → `compliance.js` | ES6 module import | compliance.js exports render functions; client-detail calls them |
| `client-detail.js` → `checklist.js` | ES6 module import | checklist.js exports render + generate trigger; same pattern as match-engine.js |
| `boldSignWebhook` fn → Firestore | Direct Admin SDK writes | Webhook fn writes files, updates envelopes, updates checklistItems in one transaction-like sequence |
| `syncAllShowingTimeFeeds` fn → Firestore | Admin SDK batch upserts | Use batched writes for showings upsert; max 500 per batch |
| Calendar showings ← ShowingTime synced | Shared `showings` collection field `source` | Calendar filters/renders based on source; no separate collection needed |

---

## Firestore Index Requirements

New queries require composite indexes. These must be added to `firestore.indexes.json` before deployment.

| Collection | Fields | Query Used By |
|------------|--------|---------------|
| `folders` | `clientId` ASC, `realtorId` ASC | loadFolders() |
| `complianceTemplates` | `transactionTypes` (array-contains), `sortOrder` ASC | compliance template picker |
| `checklistItems` | `clientId` ASC, `realtorId` ASC, `sortOrder` ASC | loadChecklistItems() |
| `checklistItems` | `autoComplete.envelopeType` ASC, `realtorId` ASC | webhook auto-complete query |
| `showings` | `realtorId` ASC, `source` ASC, `showingDate` ASC | calendar with source filter |
| `showingTimeFeeds` | `realtorId` ASC, `active` ASC | scheduled fn per-user feed query |

---

## Sources

- Codebase analysis: `/greendoor/js/client-detail.js` — verified flat collection pattern, file upload with `folder` field, envelope `onSnapshot` pattern
- Codebase analysis: `/greendoor/js/calendar.js` — verified multi-collection merge into `allCalEvents` array, existing `showings` schema
- Codebase analysis: `/greendoor/.planning/PROJECT.md` — confirmed flat folder model decision, ShowingTime iCal constraint, BoldSign template stub approach
- Codebase analysis: `/greendoor/.planning/codebase/ARCHITECTURE.md` — confirmed callable function pattern, no real-time listeners policy, `deleteClient` cascade loop
- Firebase documentation (HIGH confidence — stable platform behavior): HTTP triggers vs callable functions, scheduled functions v2 API, Firestore composite index requirements

---

*Architecture research for: GreenDoor CRM — document management, compliance, webhooks, checklists, calendar sync milestone*
*Researched: 2026-03-04*
