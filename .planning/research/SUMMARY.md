# Project Research Summary

**Project:** GreenDoor CRM — Document Management, Compliance, Webhook & iCal Milestone
**Domain:** Real estate CRM — Missouri compliance forms, BoldSign e-signature automation, ShowingTime calendar sync, AI-assisted closing checklists
**Researched:** 2026-03-04
**Confidence:** MEDIUM-HIGH (architecture HIGH from codebase analysis; stack HIGH for Firebase patterns; features/pitfalls MEDIUM where BoldSign field names and MO form versions require live verification)

---

## Executive Summary

This is an additive milestone on a working Firebase CRM. The foundation — Firebase 10.8.0, vanilla JS frontend, Cloud Functions in Node.js, and a base BoldSign integration — already exists. The work is not "choose a stack" but "extend the existing stack with four tightly coupled capabilities": compliance document automation (BoldSign template send with merge field prefill), a BoldSign webhook pipeline (auto-save signed PDFs, auto-complete checklist items), an AI-seeded closing checklist, and read-only ShowingTime iCal feed import. All four share a single foundational dependency: a transaction type field on the client record. Nothing else should be built until that field exists.

The recommended approach is a strict build order driven by data dependencies: folders first (unblocks webhook auto-save), then compliance template library and send flow, then the BoldSign webhook, then the AI checklist (which auto-completes via the webhook), and finally the independent ShowingTime sync. This order is dictated by the codebase's existing flat-collection architecture — new collections must match the existing `clientId`/`realtorId` foreign-key pattern and the `deleteClient` cascade loop, ruling out subcollections. The only new backend library required is `node-ical` in Cloud Functions; everything else (native `fetch`, `crypto`, Firebase Admin, `firebase-functions` v2) is already present or built into Node 18.

The biggest risks are not technical complexity but silent failure modes: BoldSign merge fields that don't match template field IDs (API returns 200 but fields are blank), webhook events processed without HMAC verification (forged events auto-complete real checklist items), and AI-generated checklist items that hallucinate Missouri-specific forms. All three can be addressed with specific validation steps during each sprint — none require architectural changes if caught before shipping.

---

## Key Findings

### Recommended Stack

The existing Firebase stack requires only one new npm dependency: `node-ical` (~0.19.x) in the Cloud Functions package, for parsing ShowingTime's webcal feeds. Node 18's native `fetch` handles all BoldSign REST API calls; Node's built-in `crypto` module handles HMAC-SHA256 webhook signature verification; `firebase-functions` v2 (`onSchedule`, `onRequest`, `onCall`) covers all three Cloud Function trigger types needed. Firebase Admin SDK 12.x is already present for Firestore and Storage writes. No frontend library additions are needed.

**Core technologies:**
- `firebase-functions` v2 (`onSchedule`/`onRequest`/`onCall`) — handles scheduled iCal sync, HTTP webhook endpoint, and user-triggered compliance actions — already in use; extend to v2 scheduler
- `node-ical` ^0.19.x — parses ShowingTime webcal feeds server-side; handles VTIMEZONE correctly; only new dependency required
- Native `fetch` (Node 18) — HTTP calls to BoldSign REST API and iCal URL fetching — no new dependency if runtime is Node 18+
- `crypto` (Node built-in) — HMAC-SHA256 verification of BoldSign webhook signatures — no new dependency
- Firebase Admin SDK ^12.x — Firestore and Storage writes from Cloud Functions — already present

**Critical version check:** Verify `functions/package.json` has `"engines": { "node": "18" }`. If it says `"16"`, upgrade before this milestone — Node 16 is end-of-life and lacks native `fetch`.

**Medium-confidence items requiring live verification before coding:**
- BoldSign sender override field names (`senderDetail.name`/`senderDetail.email` vs. flat fields) — verify at developers.boldsign.com
- BoldSign webhook header name (`X-BoldSign-Signature` or variant) — check BoldSign dashboard > Webhooks before implementing verification
- BoldSign webhook event payload structure (`payload.event.type` vs. `payload.eventType`) — do a test delivery and log the raw payload first

### Expected Features

The feature set is well-defined by existing codebase context. All P1 features are interdependent in a single dependency chain; none should be deferred within this milestone.

**Must have (table stakes) — P1:**
- Transaction type field on client record (SFH/Condo/Multi-Family/Land × Buyer/Seller) — foundational; every other feature branches on this
- File folder management (create, rename, delete, move files, single-level nesting) — required before webhook can auto-save signed PDFs
- Auto-created "Closing Documents" folder per client — required before webhook has a save target
- Compliance document template library by transaction type (Missouri SFH first) — BoldSign template IDs stored in `complianceTemplates` Firestore collection
- Send compliance docs for signature with merge field autofill — maps `clients`, `users`, and `listings` Firestore fields to BoldSign template merge fields
- Compliance doc status tracking per client (not sent / sent / viewed / signed / declined / expired)
- BoldSign webhook pipeline — HMAC verification, signed PDF auto-save to Closing Documents folder, envelope status update, checklist item auto-complete
- AI closing checklist seeded by transaction type (AI annotates/customizes a hard-coded base template, does NOT generate from scratch)
- ShowingTime iCal feed sync with read-only calendar display

**Should have (differentiators) — P1 in this milestone:**
- AI check-in for transaction guidance (extends existing `askAssistant` with checklist + client context)
- Transaction-type-aware compliance workflow (auto-filters relevant forms; no manual selection)
- ShowingTime + GreenDoor unified calendar with source badge

**Defer (v1.x after validation):**
- Expand compliance packs to Condo, Multi-Family, Land types — after SFH workflow is proven
- Checklist customization by agent (add/remove items)
- AI check-in session continuity

**Defer to v2+:**
- Multi-state compliance form packs (Illinois, Kansas)
- Automated reminder emails for unsigned documents (liability risk)
- MLS data auto-population (no MLS API in scope)
- BoldSign template editor inside GreenDoor (massive scope, BoldSign already has one)

**Key dependency chain:**
Transaction Type → Compliance Template Library → Send Compliance Docs → Track Status → Auto-Complete Checklist on Signature
Folder Management → Auto-Created Closing Docs Folder → BoldSign Webhook Auto-Save → feeds into Auto-Complete Checklist

ShowingTime iCal Sync is fully independent of the compliance chain and can be built in parallel.

### Architecture Approach

All new Firestore collections follow the existing flat-collection pattern with `clientId` and `realtorId` as foreign keys. No subcollections. The `deleteClient` cascade loop must be extended to include `folders`, `checklistItems`, and any other new collections. Four new Cloud Functions are needed: `boldSignWebhook` (HTTP trigger, not callable), `sendComplianceDoc` (callable), `generateChecklist` (callable), and `syncAllShowingTimeFeeds` (scheduled). Two new frontend JS modules (`compliance.js`, `checklist.js`) extend the existing `client-detail.js` tab pattern. Calendar rendering in `calendar.js` gets a read-only badge and disabled-edit behavior for `source: "showingtime"` showings.

**New Firestore collections:**
1. `folders` — folder metadata per client; `system: true` for auto-created "Closing Documents"; top-level flat collection
2. `complianceTemplates` — global Missouri form library with BoldSign template IDs, merge field mappings, `transactionTypes` array, `formVersion`/`lastVerifiedDate` metadata
3. `checklistItems` — per-client closing checklist items with `autoComplete` trigger field for webhook auto-complete; `status: "pending" | "complete" | "skipped"`
4. `showingTimeFeeds` — per-user iCal feed URL config with `lastSyncAt` and `lastError` for observability

**Extended existing collections:**
- `files` — add `folderId` (foreign key to `folders`) and `source` (`"upload" | "boldsign_signed"`) fields
- `clients` — add `transactionType` and `linkedListingId` fields
- `showings` — add `source`, `externalId` (iCal UID), `feedId`, `readOnly` fields

**Required Firestore composite indexes (add to `firestore.indexes.json` before deploy):**
- `folders`: `clientId` ASC + `realtorId` ASC
- `complianceTemplates`: `transactionTypes` (array-contains) + `sortOrder` ASC
- `checklistItems`: `clientId` ASC + `realtorId` ASC + `sortOrder` ASC
- `checklistItems`: `autoComplete.envelopeType` ASC + `realtorId` ASC (for webhook auto-complete query)
- `showings`: `realtorId` ASC + `source` ASC + `showingDate` ASC
- `showingTimeFeeds`: `realtorId` ASC + `active` ASC

### Critical Pitfalls

1. **BoldSign webhook HMAC not verified** — Any public URL can forge a "document signed" event and trigger false auto-saves and checklist completions. Use `req.rawBody` (before JSON parsing) for HMAC computation; reject with 401 if signature fails; store secret in Firebase Functions environment config only — never client-side. This is the first thing to implement in the webhook function, before any Firestore writes.

2. **BoldSign merge field names don't match template field IDs** — BoldSign silently ignores unmatched merge fields; the API returns 200 and the document sends with all fields blank. After creating each BoldSign template, call `GET /v1/template/{id}` to retrieve actual field names; build a constants object from the API response; never hardcode assumed names. Add a pre-send validation step that compares intended fields against declared template fields and blocks send if any required fields are missing.

3. **Webhook async work after `res.send()`** — Returning 200 before `await`-ing the PDF download + Storage upload + Firestore writes causes Cloud Functions to terminate CPU mid-chain, resulting in missing files and incomplete checklist updates with no visible error. Await the complete work chain before responding, or implement an explicit webhook queue with a reconciliation step for long-running chains.

4. **Webhook duplicate delivery / no idempotency** — BoldSign uses at-least-once delivery. Without idempotency enforcement, duplicate webhook deliveries produce duplicate PDFs in Storage and double-completed checklist items. Use the BoldSign envelope ID as an idempotency key: check `processedWebhooks/{envelopeId}_{eventType}` before processing; write this record atomically (Firestore transaction) before downloading the PDF.

5. **AI checklist hallucination** — Asking the AI to generate a complete Missouri closing checklist from scratch produces plausible-sounding fictional requirements (e.g., non-existent forms). Always seed the checklist from a hard-coded, human-verified template per transaction type stored in Firestore; use AI only to annotate or add client-specific context (e.g., "Lead Paint Disclosure required — property built 1971"). Flag AI-added items with a "verify" badge in the UI.

6. **iCal timezone errors** — ShowingTime DTSTART values may be floating time or carry TZID parameters; using `new Date(dtstart)` treats them as UTC, shifting showings 5-6 hours. Always use `node-ical`'s timezone-aware output; never parse raw date strings. Test with DST transition dates (2nd Sunday March, 1st Sunday November).

---

## Implications for Roadmap

Based on combined research, the dependency graph strongly dictates a 5-phase build order. Phases 1-4 are a linear chain; Phase 5 is independent and can run in parallel with any phase after Phase 1 data model work is done.

### Phase 1: Foundations — Transaction Type + File Folder Infrastructure

**Rationale:** Transaction type is the foundational data field that every compliance, checklist, and document feature branches on. Folder management (with auto-created Closing Documents folder) must exist before the webhook can save signed PDFs anywhere. Both are low-complexity and unblock every subsequent phase. This phase also establishes the new Firestore collections (`folders`) and extends existing ones (`clients`, `files`) — getting schema right here prevents migration pain later.

**Delivers:**
- `transactionType` field on client record (dropdown: SFH/Condo/Multi-Family/Land × Buyer/Seller)
- `folders` collection with CRUD UI in `client-detail.js`
- Auto-created "Closing Documents" folder (system-protected) per client on transaction type assignment
- `folderId` field on file upload flow
- Extended `deleteClient` cascade loop to include `folders` collection
- All Firestore composite indexes for new collections deployed

**Addresses:** Transaction type field, file folder management, auto-created Closing Documents folder (FEATURES.md P1)
**Avoids:** Firestore folder subcollection anti-pattern; missing composite index at deploy time (PITFALLS.md #6)

### Phase 2: Compliance Document Library + Send Flow

**Rationale:** With transaction type established, the compliance template library can be seeded (even with stub BoldSign template IDs initially) and the send flow built. Merge field autofill is included here — it is the highest-complexity single feature in this milestone and belongs in the same sprint as the send UI rather than deferred (sending without prefill is confusing to agents and creates bad habits). This phase requires the BoldSign `sendwithtemplate` API and must verify actual template field names before coding.

**Delivers:**
- `complianceTemplates` Firestore collection with Missouri SFH forms seeded (with `formVersion`, `lastVerifiedDate`, `sourceUrl` metadata)
- Compliance tab in `client-detail.js` showing forms filtered by transaction type
- `sendComplianceDoc` callable Cloud Function resolving merge fields dynamically at send time from `clients`, `users`, and `listings` docs
- Compliance doc status tracking per client (not sent / sent / viewed / signed / declined / expired)
- BoldSign sender customization (`senderDetail` fields) with UI guidance about domain verification prerequisite
- New `compliance.js` frontend module

**Uses:** BoldSign `POST /v1/document/sendwithtemplate` endpoint, Firebase `onCall` (v2), `complianceTemplates` collection
**Avoids:** Merge field name mismatch (verify template field IDs via API before coding), caching merge values in the template (resolve dynamically at send time), sender domain verification confusion (PITFALLS.md #2, #10)

**Research flag: Needs phase-level research.** BoldSign `senderDetail` field names and `sendwithtemplate` merge field parameter structure have MEDIUM confidence — verify against current BoldSign API docs before implementation sprint begins.

### Phase 3: BoldSign Webhook Pipeline

**Rationale:** The webhook is the event-driven backbone of the compliance workflow — it auto-saves signed PDFs (requires Phase 1 folder infrastructure) and will trigger checklist auto-complete (Phase 4). It must be built as its own phase because it is an HTTP trigger (not callable), requires HMAC secret configuration in BoldSign dashboard, and has idempotency requirements that are separate from the send flow. Attempting to build this alongside Phase 2 creates scope that is too large.

**Delivers:**
- `boldSignWebhook` HTTP Cloud Function (`onRequest` v2, not callable)
- HMAC-SHA256 signature verification using `req.rawBody` (first operation in handler)
- Idempotency enforcement via `processedWebhooks/{envelopeId}_{eventType}` Firestore records
- Signed PDF download from BoldSign API and upload to Firebase Storage in Closing Documents folder
- Envelope status auto-update in Firestore (`envelopes` collection)
- Activity log entry on document completion
- Webhook URL registered in BoldSign dashboard for both sandbox and production environments

**Avoids:** Webhook signature bypass, async work after 200, duplicate delivery (PITFALLS.md #1, #3, #7)

### Phase 4: AI Closing Checklist

**Rationale:** The checklist needs the webhook (Phase 3) for auto-complete to function. It also benefits from having real compliance sends visible in the client record (Phase 2) so the AI has accurate context about what has been sent. The AI generation prompt must seed from a hard-coded human-verified template — not generate from scratch — so the base template must be created before the AI feature ships.

**Delivers:**
- `checklistItems` Firestore collection with `autoComplete` trigger field
- Human-verified base checklist templates per transaction type (stored in Firestore, editable without code deploy)
- `generateChecklist` callable Cloud Function: loads base template, calls OpenAI to annotate with client-specific context, writes items flagged `"AI suggestion"` vs `"required"`
- Checklist UI in `client-detail.js` with manual complete/skip, AI suggestion badges, disclaimer text
- Auto-complete hook in `boldSignWebhook` function (Phase 3 extended): queries `checklistItems` by `autoComplete.envelopeType`, marks matching items complete
- Toast notification on webhook-triggered auto-complete
- New `checklist.js` frontend module
- Token count estimation before OpenAI calls; context summarization for near-close clients with 20+ activities

**Avoids:** AI hallucination (seed from base template), context window overflow (summarize activities, pass only recent/relevant context), silent auto-complete (toast + activity log) (PITFALLS.md #8, #9)

### Phase 5: ShowingTime iCal Sync (Independent)

**Rationale:** Fully independent of Phases 1-4. Can be built in parallel with Phase 2 or later. Requires only `node-ical` added to Cloud Functions package.json, a `showingTimeFeeds` collection, and extensions to the existing `showings` collection and `calendar.js`. The iCal sync has its own set of edge cases (timezone, cancelled events, ETag caching) that are best addressed in a focused sprint.

**Delivers:**
- `showingTimeFeeds` Firestore collection with feed URL, `lastSyncAt`, `lastError`
- Feed URL input in settings page
- `syncAllShowingTimeFeeds` scheduled Cloud Function (every 30 minutes, `onSchedule` v2)
- `webcal://` to `https://` URL conversion before fetch
- `node-ical` parsing with VTIMEZONE-aware datetime handling
- Deduplication by `externalId` (iCal UID); upsert on re-sync
- `STATUS:CANCELLED` handling — marks Firestore showing as cancelled
- ETag/Last-Modified caching to skip re-parse when feed unchanged
- 10-second HTTP timeout on feed fetch; batch Firestore writes (max 500 per batch)
- Calendar read-only badge for `source: "showingtime"` showings; edit actions disabled

**Avoids:** Timezone errors (use node-ical timezone-aware output), cancelled events not removed, sync timeout on large feeds, duplicate showings from re-sync (PITFALLS.md #4, #5, #12)

**Research flag: Needs phase-level research.** ShowingTime feed field names (`STATUS`, `SEQUENCE`, `EXDATE` behavior) have MEDIUM confidence based on training data — subscribe to a live ShowingTime feed and inspect the actual output before finalizing the parsing logic.

---

### Phase Ordering Rationale

- **Transaction type first** because it is required by every compliance, checklist, and document feature — building anything else without it means schema retrofitting
- **Folders before webhook** because the "Closing Documents" folder must exist as a Firestore document (with a known `folderId`) before the webhook can write a file record pointing to it; lazy creation introduces a race condition
- **Send flow before webhook** because the webhook queries `envelopes` docs (written by the send flow) to look up `clientId`, `realtorId`, and `templateType`; the webhook cannot route signed PDFs without these records
- **Webhook before checklist auto-complete** because the auto-complete trigger is an extension of the webhook handler; building checklist without it means shipping an incomplete feature
- **ShowingTime at any point after Phase 1 data model work** because it shares only the `showings` collection extension with the compliance chain, and that field addition (`source`, `externalId`, `readOnly`) is safe to deploy independently

---

### Research Flags

**Needs phase research before sprint planning:**
- **Phase 2 (Compliance Send + Merge Fields):** BoldSign `senderDetail` field names and `sendwithtemplate` merge field parameter structure are MEDIUM confidence. Before sprint planning, verify current BoldSign API docs at developers.boldsign.com for exact field names and create at least one test BoldSign template to confirm field ID format.
- **Phase 5 (ShowingTime Sync):** ShowingTime iCal feed field behavior is MEDIUM confidence. Before sprint planning, subscribe to a live feed (or request a test export) and inspect actual VEVENT fields, STATUS values, and timezone format.

**Standard patterns — skip research-phase:**
- **Phase 1 (Foundations):** Firestore flat collection pattern and folder-via-metadata approach are HIGH confidence from codebase verification. Firebase Functions composite index requirements are standard and well-documented.
- **Phase 3 (Webhook):** HMAC-SHA256 webhook verification and Firebase `onRequest` v2 with `req.rawBody` are HIGH confidence. Idempotency pattern with Firestore check-before-write is standard.
- **Phase 4 (AI Checklist):** AI prompt seeding from base template is a well-established pattern; the `askAssistant` Cloud Function already exists; no novel AI integration work required.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Cloud Functions v2 patterns, `node-ical` API, Firestore flat collection approach — all verified against existing codebase and stable platform documentation; only medium-confidence item is BoldSign-specific field names |
| Features | MEDIUM | Feature prioritization is HIGH confidence from codebase analysis and dependency graph; Missouri form names/versions are MEDIUM — standard forms as of training data but require live verification before creating BoldSign templates |
| Architecture | HIGH | Derived directly from codebase analysis; flat collection pattern, callable/HTTP/scheduled function distinctions, and required Firestore index sets are all confirmed from existing code conventions |
| Pitfalls | HIGH (technical) / MEDIUM (MO compliance) | BoldSign webhook mechanics, Firebase async pitfalls, iCal timezone edge cases — HIGH from domain expertise; Missouri form versioning and BoldSign API field names — MEDIUM, require verification against live systems |

**Overall confidence:** MEDIUM-HIGH. The build approach is sound and the dependency ordering is unambiguous. The two areas requiring live verification (BoldSign field names, Missouri form currency) are well-scoped and can be addressed with targeted research tasks before the relevant sprints begin without blocking overall roadmap structure.

---

### Gaps to Address

- **BoldSign sender override field names:** Field is `senderDetail.name`/`senderDetail.email` per training data but MEDIUM confidence. Verify at `https://developers.boldsign.com/docs/api/send-document-using-template` before coding Phase 2.

- **BoldSign webhook header name and event payload structure:** Header is `X-BoldSign-Signature` per training data; event field may be `payload.event.type` or `payload.eventType`. Do a test delivery from BoldSign dashboard and log the raw payload before writing the webhook handler in Phase 3.

- **BoldSign template field IDs:** Set when creating templates in the BoldSign dashboard; must be retrieved via `GET /v1/template/{id}` after template creation. The `complianceTemplates` Firestore collection needs a `mergeFields` array mapping BoldSign field IDs to Firestore source paths — these IDs cannot be known until templates are created in the BoldSign UI.

- **Missouri form version currency:** Forms listed in FEATURES.md reflect training data through August 2025. Before seeding the `complianceTemplates` collection, verify current form names and versions against STL Realtors form library (stlrealtors.com) or Missouri REALTORS (morealtor.com). The NAR buyer agency agreement requirement (effective August 2024) is HIGH confidence; pre-1978 lead paint disclosure is federal law and HIGH confidence; other form specifics are MEDIUM.

- **ShowingTime iCal field names in live feed:** Inspect an actual ShowingTime webcal export to confirm `STATUS`, `SEQUENCE`, `EXDATE`, and `DESCRIPTION` field behavior before coding the sync function in Phase 5.

- **Node runtime version in `functions/package.json`:** Verify `"engines": { "node": "18" }` before any Cloud Function work. If Node 16, upgrade first — native `fetch` is required; Node 16 is end-of-life.

- **Existing files collection migration:** Current `files` docs have no `folderId` field. No migration script needed — handle `folderId === null` or `folderId === undefined` as "root" (unfiled) in frontend rendering. Document this in code comments to prevent future confusion.

---

## Sources

### Primary (HIGH confidence)

- GreenDoor codebase (`.planning/codebase/ARCHITECTURE.md`, `INTEGRATIONS.md`, `STACK.md`, `CONCERNS.md`) — existing patterns, collection schemas, function list, performance issues
- GreenDoor `.planning/PROJECT.md` — milestone scope, constraints, flat folder model decision
- Firebase Functions v2 documentation (`onSchedule`, `onRequest`, `onCall`, `req.rawBody`) — stable platform behavior
- RFC 5545 (iCalendar specification) — DTSTART, TZID, EXDATE, STATUS:CANCELLED, UID semantics
- Federal Residential Lead-Based Paint Hazard Reduction Act (42 U.S.C. § 4852d) — lead paint disclosure trigger
- NAR settlement — buyer agency agreement requirement effective August 17, 2024

### Secondary (MEDIUM confidence)

- BoldSign REST API documentation (training data through August 2025; not fetched live) — `sendwithtemplate`, `senderDetail`, webhook HMAC signature, document download endpoint
- Missouri Association of REALTORS (MAR) form library (training data) — standard MO residential transaction forms
- STL Realtors / St. Louis Association of REALTORS form library (training data) — local form variants
- Missouri Revised Statutes § 339.710 (agency disclosure) and § 339.730 (seller disclosure) — MEDIUM (stable law; section numbers should be confirmed)
- Missouri Condominium Property Act § 448 — resale certificate requirements
- `node-ical` npm package v0.19.x (training data) — `async.fromURL` API, VTIMEZONE handling, VEVENT parsing

### Tertiary (LOW confidence / requires validation)

- ShowingTime iCal feed field structure — needs live feed inspection before Phase 5 coding
- BoldSign webhook exact header name and event payload structure — needs test delivery before Phase 3 coding
- BoldSign `senderDetail` exact field names — needs current API doc verification before Phase 2 coding

---

*Research completed: 2026-03-04*
*Ready for roadmap: yes*
