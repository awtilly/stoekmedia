# Pitfalls Research

**Domain:** Real estate CRM — compliance documents, BoldSign e-signatures, Firebase webhooks, iCal feed sync, Firestore folder hierarchies, AI checklists
**Researched:** 2026-03-04
**Confidence:** HIGH (BoldSign API behavior, Firebase webhook mechanics, iCal spec edge cases) / MEDIUM (AI checklist UX patterns) — based on domain expertise; external tool access unavailable during research session

---

## Critical Pitfalls

### Pitfall 1: BoldSign Webhook Signature Verification Not Implemented

**What goes wrong:**
The webhook Cloud Function receives BoldSign events (document signed, completed, declined) but skips signature verification. Any HTTP POST to the function's URL can forge a "document signed" event, triggering the auto-save of a signed PDF to the wrong client's Closing Documents folder or auto-completing checklist items fraudulently.

**Why it happens:**
Developers stand up the webhook quickly to get the data flowing, skip verification because it "works in testing," and never add it before shipping. BoldSign includes an `X-BoldSign-Signature` HMAC-SHA256 header in every webhook delivery. Without verification, the endpoint accepts all comers.

**How to avoid:**
- Store the BoldSign webhook secret in Firebase Functions environment config (not in client-side code)
- In the Cloud Function, extract the `X-BoldSign-Signature` header, compute `HMAC-SHA256(secret, rawBody)`, and compare using a constant-time comparison
- Reject (return HTTP 401) any request where the signature does not match before touching Firestore
- Use `rawBody` from the Express request — JSON parsing before HMAC computation will cause verification failures because whitespace normalization changes the byte sequence

**Warning signs:**
- Webhook function has no `req.headers['x-boldsign-signature']` reference anywhere
- Function body calls `JSON.parse(req.body)` before any verification step
- No `BOLDSIGN_WEBHOOK_SECRET` in Firebase Functions config

**Phase to address:** BoldSign Webhook Sprint (the phase implementing auto-save of signed PDFs)

---

### Pitfall 2: BoldSign Merge Field Names Don't Match Template Field Names

**What goes wrong:**
The Cloud Function sends prefilled merge field values (buyer name, property address, purchase price) to BoldSign, but the template in BoldSign's dashboard uses field names like `BuyerName` while the code sends `buyer_name`. BoldSign silently ignores unmatched merge fields — the document sends but all merge fields are blank. The agent sends unsigned, empty forms to clients.

**Why it happens:**
Merge field names are set when creating the template in BoldSign's dashboard. The developer writes code based on assumed names without verifying the exact names in the template. BoldSign does not return an error when merge field names don't match; it just doesn't fill them.

**How to avoid:**
- After creating each BoldSign template, use the BoldSign API (`GET /v1/template/{templateId}`) to retrieve the template and log all FormField names before writing any merge field code
- Build a mapping constant in the Cloud Function (e.g., `MERGE_FIELDS.BUYER_NAME = "BuyerName"`) derived from what the API returns, not what the developer assumes
- Add a pre-send validation step: compare the fields the function intends to send against the fields the template declares; log a warning if any intended field has no match
- Test every template with at least one full send that verifies the filled values actually appear in the sent document

**Warning signs:**
- Merge field names are hardcoded as strings directly in the API call payload without a constants file
- No test that sends a document and checks that field values appear in the downloaded PDF
- Template IDs added as stubs but actual field name verification deferred

**Phase to address:** Compliance Document Template + Merge Field Autofill Sprint

---

### Pitfall 3: Firebase Cloud Function Webhook Returns 200 Before Work Completes (Async Fire-and-Forget)

**What goes wrong:**
The BoldSign webhook Cloud Function returns `res.status(200).send("ok")` immediately, then begins the async work (downloading the signed PDF from BoldSign, uploading to Firebase Storage, writing to Firestore). If any step fails after the 200, BoldSign considers the delivery successful. The signed PDF never lands in the Closing Documents folder, and the checklist item is never auto-completed. The agent sees no error and assumes the system worked.

**Why it happens:**
Developers return early to avoid BoldSign's 30-second delivery timeout. The intent is correct but execution is wrong — returning 200 without awaiting the async chain decouples the success response from the actual outcome.

**How to avoid:**
- `await` the entire work chain (PDF download → Storage upload → Firestore write → checklist update) before returning 200
- If the chain takes longer than BoldSign's timeout, handle it by returning 200 immediately and writing the event to a Firestore `webhookQueue` document, then processing from a separate scheduled function — but track processing status explicitly
- Never use `res.json(...)` followed by unresolved promises in Firebase HTTP functions (Cloud Functions kills the process after response is sent)
- Add explicit error handling: if any step throws, return HTTP 500 so BoldSign retries delivery

**Warning signs:**
- `res.status(200)` appears before any `await` in the function body
- No Firestore write or Storage upload result is awaited before the response
- No retry or dead-letter mechanism for failed webhook processing

**Phase to address:** BoldSign Webhook Sprint

---

### Pitfall 4: iCal Feed Timezone Handling — ShowingTime Events Appear on Wrong Day

**What goes wrong:**
ShowingTime's iCal feed emits `DTSTART` values either as floating time (no timezone, e.g., `DTSTART:20260305T100000`) or with a `TZID` parameter (e.g., `DTSTART;TZID=America/Chicago:20260305T100000`). The Cloud Function parses the UTC offset incorrectly or ignores `TZID` entirely, causing showings to appear one hour off in the calendar (or on the wrong day during DST transitions).

**Why it happens:**
Node.js's `Date` constructor treats strings without timezone info as UTC. A showing at 10:00 AM Central becomes 4:00 PM or 3:00 PM depending on DST. iCal libraries that don't load VTIMEZONE components also produce wrong results for named timezone IDs.

**How to avoid:**
- Use a library that fully handles iCal timezone semantics — `node-ical` (npm) processes `VTIMEZONE` components and resolves `TZID` references correctly; `ical.js` is an alternative
- Never parse `DTSTART` date strings with `new Date()` directly — always use the library's timezone-aware output
- When storing ShowingTime events in Firestore, store the ISO 8601 string with explicit UTC offset (e.g., `2026-03-05T10:00:00-06:00`), not a bare date string
- Add a smoke-test: after importing a known feed, verify the displayed time matches what ShowingTime shows in the agent's browser

**Warning signs:**
- iCal dates parsed with `new Date(dtstart)` or string slicing
- No `VTIMEZONE` processing in the parsing code
- DST transition dates (second Sunday March, first Sunday November) not included in test cases

**Phase to address:** ShowingTime iCal Sync Sprint

---

### Pitfall 5: iCal Recurring Events — Cancelled Instances Not Removed

**What goes wrong:**
ShowingTime may reschedule or cancel a showing that was imported from the iCal feed. The cancelled/rescheduled event appears in the iCal feed as either a `STATUS:CANCELLED` VEVENT or as an `EXDATE` exception on the original recurring event. The sync function ignores these and the showing remains visible in GreenDoor's calendar even after it was cancelled.

**Why it happens:**
Most iCal implementations focus on `VEVENT` parsing for creation. Handling `STATUS:CANCELLED` and `EXDATE` (excluded date) requires explicit processing. Developers miss these because initial testing uses only simple, non-cancelled events.

**How to avoid:**
- After parsing the feed, check every VEVENT's `STATUS` property — if `STATUS:CANCELLED`, mark the corresponding Firestore showing document as `source: "showingtime", status: "cancelled"` or delete it
- Process `EXDATE` fields on recurring events — any date listed in `EXDATE` represents a cancelled instance; delete or suppress that occurrence in Firestore
- During every 30-minute sync, diff the current feed against previously imported UIDs and remove Firestore records for UIDs that have disappeared entirely from the feed
- Each ShowingTime VEVENT has a `UID` field — use this as the idempotency key in Firestore (store as `showingTimeUid` on the showing document) to prevent duplicates and enable updates

**Warning signs:**
- Sync function only handles `VEVENT` creation, no update/delete logic
- No `UID` field stored on ShowingTime-imported showings
- No check for `STATUS:CANCELLED` in the parsing loop

**Phase to address:** ShowingTime iCal Sync Sprint

---

### Pitfall 6: Firestore Folder Hierarchy — Querying Files by Folder is Expensive Without a Flat Index

**What goes wrong:**
Folders are implemented as a subcollection (`clients/{id}/folders/{folderId}/files/{fileId}`), causing every file load to require multiple collection group queries or N+1 subcollection reads. The flat `files` collection approach avoids this, but without a `folderId` index the "show all files in Closing Documents" query becomes a full-collection scan filtered client-side.

**Why it happens:**
The temptation is to model folders as nested Firestore subcollections because it mirrors mental folder/file hierarchy. But Firestore doesn't support cross-subcollection queries easily, and the project already has a flat `files` collection.

**How to avoid:**
- Keep files in the top-level `files` collection (already exists) and add a `folderId` field (nullable) to each file document
- Create a Firestore composite index on `(clientId, folderId)` to support efficient per-folder queries
- Store folders as documents in a `folders` collection with fields: `clientId`, `realtorId`, `name`, `createdAt`, `isSystem` (true for auto-created "Closing Documents")
- For the "Closing Documents" auto-creation: create the folder document at client creation time (or lazily on first signed doc), not at query time — avoids race conditions
- Never model folders as Firestore subcollections of clients; the flat model with a `folderId` reference is simpler to query and matches the existing `files` collection shape

**Warning signs:**
- Folder documents are subcollections of client documents
- File queries loop over folder documents and call `getDocs` per folder (N+1)
- No `folderId` composite index defined in `firestore.indexes.json`

**Phase to address:** Client File Folder Management Sprint

---

### Pitfall 7: BoldSign Webhook Duplicate Delivery — Idempotency Not Enforced

**What goes wrong:**
BoldSign retries webhook delivery if it doesn't receive a 200 within 30 seconds, or on transient network failure. The Cloud Function processes the same `document_signed` event twice, resulting in duplicate PDFs saved to Storage and duplicate Firestore writes, or double-completing a checklist item.

**Why it happens:**
Webhook idempotency is often overlooked until duplicates appear in production. BoldSign uses at-least-once delivery semantics.

**How to avoid:**
- Use the BoldSign envelope ID as an idempotency key: before processing any webhook event, check if a Firestore document in `processedWebhooks/{envelopeId}_{eventType}` already exists
- If the document exists, return HTTP 200 immediately and skip all processing
- Write the idempotency record as the first Firestore operation (before the PDF download) — if the function crashes after writing but before completing, subsequent retries will be blocked, which is acceptable; build a reconciliation step if needed
- Use Firestore transactions for the idempotency check + write to make it atomic

**Warning signs:**
- Webhook handler calls `setDoc` on the `files` collection or `envelopes` collection without first checking if the record already exists
- No `processedWebhooks` collection or equivalent idempotency store
- Storage upload does not check for existing file at the target path before uploading

**Phase to address:** BoldSign Webhook Sprint

---

### Pitfall 8: AI Closing Checklist Hallucination — AI Invents Required Documents That Don't Exist

**What goes wrong:**
The AI generates a closing checklist for a Missouri SFH buyer transaction and includes items like "Submit Form MO-2847 to St. Louis County Assessor" — a form that doesn't exist. The agent follows the checklist and wastes time tracking down a fictional requirement. Worse, the checklist omits a real required document (e.g., Missouri Lead Paint Disclosure for pre-1978 homes).

**Why it happens:**
LLMs generate plausible-sounding procedural checklists without grounding in verified regulatory sources. Real estate compliance requirements vary by transaction type, property age, and county. The model's training data may include outdated MO transaction requirements or confuse requirements across states.

**How to avoid:**
- Do not ask the AI to generate the complete checklist from scratch — instead, seed the checklist from a hard-coded, human-verified template per transaction type (SFH Buyer, SFH Seller, Condo Buyer, etc.)
- Use the AI only to annotate or customize checklist items based on the specific client/property data (e.g., "Lead Paint Disclosure required — property built 1971"), not to create new line items
- Add a visible disclaimer: "This checklist is a starting point. Verify requirements with your broker and MO Real Estate Commission."
- Store checklist templates as Firestore documents (not hardcoded) so a non-developer (the agent) can edit them without a code deploy
- Flag any AI-added items with a "AI suggestion — verify" badge in the UI

**Warning signs:**
- The AI prompt says "generate a complete closing checklist for [transaction type]" without providing a base template
- No human-verified checklist template exists in Firestore before the AI is invoked
- The UI presents AI checklist items and human-verified items identically, with no visual distinction

**Phase to address:** AI Closing Checklist Sprint

---

### Pitfall 9: AI Context Window Overflow — Client Data Truncated, Checklist Check-in Misses Critical Facts

**What goes wrong:**
The AI check-in receives the full client record, all checklist items, signed document statuses, and conversation history in a single prompt. For a transaction nearing close (many activities, long checklist), this exceeds the model's context window. The model either silently truncates the oldest data or the API returns an error, causing the check-in to give advice that contradicts known facts (e.g., advising the agent to send a document that was already signed three weeks ago).

**Why it happens:**
The existing `askAssistant` Cloud Function already passes session-only chat history (no persistence). Adding client data + checklist data + activity log to the same prompt multiplies token usage significantly. Developers don't test with a near-close transaction that has 30+ activities.

**How to avoid:**
- Audit the maximum token payload for a realistic near-close client: count activities (30-day history), checklist items (15-25 items), signed doc statuses, and client profile fields
- If payload exceeds 60% of the model's context window, summarize older activities before passing to the AI (e.g., "3 weeks ago: Purchase Agreement sent and signed; 2 weeks ago: Inspection contingency waived")
- Pass only relevant context to the check-in prompt: current checklist status (not full text of every item), recent activities (last 7 days), and unsigned items
- Add token count estimation before calling the AI API; log a warning when approaching the limit
- This is especially critical given the existing decision to use session-only chat history — context must be reconstructed from Firestore each time

**Warning signs:**
- The AI prompt constructs a single large string from all client data without any truncation or summarization logic
- No token counting before the API call
- Testing only done on new clients with 0-2 activities

**Phase to address:** AI Closing Checklist Sprint

---

### Pitfall 10: BoldSign Sender Email — Custom Sender Requires Domain Verification, Not Just API Config

**What goes wrong:**
The realtor wants outgoing BoldSign emails to show their own email address as the sender. The developer sets `senderEmail` in the BoldSign API call, but BoldSign's platform requires the domain to be verified via DNS (SPF/DKIM records) before custom sender email addresses work. Without this, BoldSign silently falls back to its own default sender, and the agent's clients receive signature requests from a generic BoldSign address — creating distrust and confusion.

**Why it happens:**
API documentation shows a `senderDetails` object, and developers assume filling it in is sufficient. The out-of-band domain verification requirement is a separate administrative step that isn't part of the API response flow — the API call succeeds (200 OK) even when the sender is overridden by BoldSign due to unverified domain.

**How to avoid:**
- Document this as a prerequisite step in the Settings UI: "To send documents from your email address, verify your domain in BoldSign. Go to Settings → Branding → Sender Email in the BoldSign dashboard."
- After sending, call the BoldSign API to retrieve the envelope details and log the actual `senderEmail` field — if it doesn't match what was requested, surface a warning to the user
- Store the verified sender email in the user's Firestore profile so it can be compared against what BoldSign reports
- Do not present the custom sender feature as "active" until the user has confirmed domain verification

**Warning signs:**
- Settings UI shows "Send documents from your email" toggle with no instructions about BoldSign domain verification
- No post-send verification that BoldSign honored the `senderDetails.email` value
- Testing done only with BoldSign sandbox which may not enforce domain verification

**Phase to address:** BoldSign Sender Customization Sprint

---

### Pitfall 11: Compliance Document Accuracy — Missouri-Specific Forms Become Outdated

**What goes wrong:**
The compliance document template library ships with Missouri Purchase Agreement, Seller's Disclosure, and Lead Paint forms seeded as BoldSign template IDs. The Missouri Real Estate Commission (MREC) or the St. Louis REALTORS association updates these forms periodically. The CRM continues sending the old form version. The agent unknowingly sends a deprecated form to a client for signature, which may be legally invalid or embarrassing to fix.

**Why it happens:**
Template versioning is assumed to be a one-time setup. No notification mechanism exists to flag when a form is updated. The developer creates templates in BoldSign once and marks the feature done.

**How to avoid:**
- Store a `formVersion`, `lastVerifiedDate`, and `sourceUrl` (link to official MREC or STL REALTORS form page) on each compliance template document in Firestore
- Add a "last verified" date to the Settings or Admin page so the agent can see when forms were last checked
- Schedule a reminder (or admin UI warning) if any form hasn't been verified in 90 days
- Note in the ARCHITECTURE docs and the admin UI that template IDs must be re-created in BoldSign if the underlying form is updated (BoldSign templates are not version-controlled)
- This is lower urgency during MVP (single agent, single market) but must be addressed before onboarding additional agents

**Warning signs:**
- Compliance template records in Firestore have no `lastVerifiedDate` or `formVersion` field
- No admin UI surface showing when each form was last confirmed current
- Template IDs stored without any linkage to the official form source document

**Phase to address:** Compliance Document Template Library Sprint (add metadata fields now; verification reminder can come later)

---

### Pitfall 12: ShowingTime iCal Sync — 30-Minute Scheduled Function Cold Start + Timeout Risk

**What goes wrong:**
The scheduled Cloud Function fetches the ShowingTime webcal feed, parses potentially 50-200 VEVENT records, runs Firestore diffing to detect new/updated/cancelled showings, and writes results. On a slow feed response or large diff, this approaches or exceeds the 540-second Cloud Functions timeout. Additionally, the function runs on a cold start every 30 minutes and the CDN-loaded Firebase SDK pattern doesn't apply in Cloud Functions (Node.js environment), so initialization overhead matters.

**Why it happens:**
iCal feed fetch can be slow (ShowingTime's server latency). Large feeds with 6 months of history take time to parse. Diffing against Firestore requires N reads (one per UID to check existence). Developers test with a fresh feed containing 3 events and don't test with 6 months of ShowingTime history.

**How to avoid:**
- Fetch the feed with a 10-second HTTP timeout; fail fast if ShowingTime doesn't respond
- Process only events with `DTSTART` in the last 30 days + next 90 days; ignore historical events outside this window
- Use a Firestore batch write (max 500 operations per batch) rather than individual `setDoc` calls; this reduces round trips dramatically
- Store the last sync timestamp and ETag/Last-Modified header from ShowingTime; if the ETag hasn't changed, skip processing entirely (no re-parse, no Firestore reads)
- Set function timeout to 120 seconds (more than sufficient with optimization); exceeding that indicates a bug, not a capacity issue

**Warning signs:**
- No HTTP timeout on the fetch call to ShowingTime
- Firestore writes in a loop (`for ... await setDoc(...)`) rather than batched
- No ETag or Last-Modified caching to skip unchanged feeds
- Test feed has fewer than 10 events

**Phase to address:** ShowingTime iCal Sync Sprint

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems in this project.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode compliance form field names as strings in Cloud Function | Faster to ship | Breaks silently when BoldSign template is recreated with new field names; no error surfaced | Never — use a constants object verified against the API |
| Skip idempotency on BoldSign webhook and rely on "it won't retry" | Saves a Firestore read per event | Duplicate PDFs, duplicate checklist completions on retry | Never — BoldSign always retries on timeout |
| Store ShowingTime events without UID reference | Simpler data model | Impossible to deduplicate on re-sync; cancellations can't be reconciled | Never — UID is the only stable identity |
| Let AI generate the full checklist (no base template) | One prompt, done | Hallucinated items, missing real requirements, legal risk for agent | Never — always seed from human-verified template |
| Create "Closing Documents" folder on first access (lazy) | Avoids folder creation at client-create time | Race condition if webhook fires before folder exists; signed PDF has nowhere to land | Only if folder-creation is idempotent (create-if-not-exists) |
| Use Cloud Functions 1st gen for webhook endpoint | Already deployed, familiar | 540s timeout limit; no automatic retries; no min-instance config | Acceptable for MVP with <50 transactions/month |

---

## Integration Gotchas

Common mistakes when connecting to the external services in this project.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| BoldSign Webhooks | Parsing `req.body` as JSON before HMAC verification | Capture raw body bytes first; compute HMAC; then parse JSON |
| BoldSign Webhooks | Not registering webhook in BoldSign dashboard for both sandbox and production environments | Register separate webhook URLs for each environment; use Cloud Function environment variable to determine which environment is active |
| BoldSign Merge Fields | Assuming merge field names match human-readable labels in BoldSign UI | Always retrieve template field names via `GET /v1/template/{id}` API call; never guess |
| BoldSign Sender | Setting `senderDetails.email` and assuming it works | Verify BoldSign domain verification is complete; check returned envelope sender after send |
| ShowingTime iCal | Fetching `webcal://` URLs directly | Rewrite `webcal://` to `https://` before fetching; `webcal://` is not a standard HTTP scheme; Node.js fetch rejects it |
| ShowingTime iCal | Trusting feed DTSTART as local time | Always parse with a timezone-aware iCal library; never use `new Date(dtstart)` on bare time strings |
| Firebase Cloud Functions | Long-running async after `res.send()` | Cloud Functions runtime terminates CPU after response; all async work must complete before `res.send()` |
| Firebase Cloud Functions | Using `functions.config()` for secrets in Gen 2 functions | Gen 2 functions use Secret Manager / `defineSecret()`; `functions.config()` is a Gen 1 pattern |
| Firestore | Querying `files` by folder without composite index | Add composite index `(clientId, folderId)` in `firestore.indexes.json` before deploying folder queries |

---

## Performance Traps

Patterns that work at small scale but fail as the transaction volume grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all ShowingTime events every 30-min sync without ETag caching | High Cloud Function execution time and cost; redundant Firestore writes | Store Last-Modified/ETag from ShowingTime response; skip re-parse when unchanged | From day 1 (unnecessary work on every run) |
| N+1 Firestore reads in sync diff (one `getDoc` per UID to check existence) | 30-min sync approaches 60+ seconds for 100 events | Batch `getDoc` calls or query existing UIDs in one `where("showingTimeUid", "in", [...])` call | At ~30+ showings |
| AI check-in prompt grows unbounded with client activity history | API errors on context overflow; slow response times; increasing API costs | Summarize older activities; pass only last 7 days + key milestones | At ~20 activities or after a long transaction |
| All `files` for a client loaded without folder filter | Slow file tab render when client has 50+ documents | Query with `(clientId == X AND folderId == Y)` instead of filtering client-side | At ~30-50 files per client |
| Checklist items stored as an array on the client document | Firestore document size limit (1 MB) eventually hit; array updates require full document read-modify-write | Store checklist items as a subcollection `clients/{id}/checklistItems/{itemId}` | At ~200+ items (unlikely but possible for a long transaction) |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| BoldSign webhook endpoint publicly accessible without signature verification | Attacker forges "document signed" events; triggers false auto-archiving of non-existent PDFs and auto-completion of checklist items | Implement HMAC-SHA256 signature verification as the first operation in the webhook handler |
| Storing BoldSign webhook secret in client-side `firebase-config.js` | Secret exposed to browser; attacker can forge any webhook event | Store only in Firebase Functions environment config (Secret Manager); never in client code |
| ShowingTime iCal URL stored in plaintext Firestore without access controls | Any authenticated user (including admin) can read another realtor's ShowingTime feed URL, which contains personal showing schedule | Enforce Firestore rules: only the owning realtor's UID can read their `settings` document |
| Compliance PDF auto-saved to Storage without Firestore security rules check | If Storage rules use only path-based access (not Firestore-linked), any authenticated user can access signed compliance docs for another realtor's client | Storage security rules should verify `request.auth.uid == resource.metadata.realtorId` |
| AI check-in prompt includes client PII (address, email, phone) sent to third-party AI API | PII transmitted to AI provider; potential data residency / CCPA concern | Minimize PII in AI prompts; use identifiers rather than full client data where possible; note in privacy policy that AI features process client data |

---

## UX Pitfalls

Common user experience mistakes specific to this real estate CRM domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Auto-completing checklist items silently (no notification) | Agent doesn't realize a milestone was auto-completed; may miss reviewing the signed document | Show a toast notification and an activity log entry when a checklist item is auto-completed by webhook |
| ShowingTime showings displayed identically to manually entered showings | Agent edits a ShowingTime showing in GreenDoor, changes are overwritten on next sync | Mark imported showings with a `source: "showingtime"` badge; make them read-only in edit UI; show "Managed in ShowingTime" tooltip on edit attempt |
| Compliance doc "sent" status not differentiated from "viewed" vs. "signed" | Agent can't tell if client even opened the document | Track BoldSign envelope status granularly: `not_sent`, `sent`, `viewed`, `signed`, `declined`, `expired` — show each state distinctly |
| Merge field errors are invisible to the agent | Agent sends blank forms; client receives and signs an empty document | Before sending, validate that all required merge fields have values; block send and show specific missing fields if any are empty |
| Closing Documents folder auto-created even for clients who will never close (leads) | Clutter in file manager for non-transactions | Create "Closing Documents" folder only when transaction type is set AND first compliance doc is sent, not at client creation |

---

## "Looks Done But Isn't" Checklist

Things that appear complete in demos but are missing critical pieces for production.

- [ ] **BoldSign webhook:** Endpoint responds to test events — verify HMAC signature verification is enforced, not just bypassed in test mode
- [ ] **Merge field autofill:** Document sends successfully — verify by downloading the sent document and confirming all merge fields contain actual values (not blanks)
- [ ] **Signed PDF auto-save:** Closing Documents folder has a file after signing — verify the file is the final signed PDF, not the original unsigned document or a blank file
- [ ] **Checklist auto-complete:** Item shows as checked after signing — verify the correct item is checked (not a different item with a similar name), and that re-signing doesn't un-check it
- [ ] **ShowingTime sync:** Showings appear in calendar — verify times are in Central time (not UTC offset), verify a cancelled showing disappears on next sync, verify a rescheduled showing updates (not duplicates)
- [ ] **AI checklist check-in:** AI responds with relevant guidance — verify response references actual current checklist state (not hallucinated state), and that a near-close client with 20+ activities doesn't hit context overflow
- [ ] **Custom sender email:** BoldSign sends from realtor address — verify the "From" field in the received email (not just the API call payload) shows the realtor's email, not BoldSign's default
- [ ] **Folder management:** Files move between folders — verify move operation updates `folderId` field on the Firestore document AND the UI reflects the change without a page reload

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate signed PDFs from webhook retry | LOW | Query Storage for files with matching envelope ID prefix; delete duplicates; mark idempotency record to prevent future duplication |
| Wrong timezone on ShowingTime events | MEDIUM | Write a one-time migration script: re-fetch the iCal feed, re-parse with timezone-aware library, update all `showingTime`-sourced showings in Firestore |
| Compliance form sent with blank merge fields | HIGH | Cannot recall a sent BoldSign envelope; agent must contact client to void and re-sign; add compensating validation before future sends |
| AI checklist contains hallucinated items | LOW | Agent reviews and deletes AI-added items manually; add "AI suggestion" flag retroactively; update prompt to use seed template |
| BoldSign template field names change after form update | MEDIUM | Retrieve new template field names via API; update constants in Cloud Function; redeploy; existing unsent envelopes unaffected |
| ShowingTime sync creates duplicate showings due to missing UID | MEDIUM | Write a one-time migration: find showings with `source: "showingtime"` but no `showingTimeUid`; delete all; re-run sync with UID-based deduplication in place |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Webhook signature not verified | BoldSign Webhook Sprint | Send a forged POST with wrong signature; verify function returns 401 and makes no Firestore writes |
| Merge field name mismatch | Compliance Template + Merge Field Sprint | Download sent document after send; confirm all fields contain correct values |
| Async work after 200 response | BoldSign Webhook Sprint | Kill Cloud Function mid-execution after 200 is sent (via timeout simulation); verify no partial writes or missing files |
| iCal timezone errors | ShowingTime iCal Sync Sprint | Import a known event on a DST transition date; verify displayed time matches ShowingTime |
| iCal cancelled events not removed | ShowingTime iCal Sync Sprint | Cancel a showing in ShowingTime; wait for next sync; verify event no longer appears in GreenDoor calendar |
| Firestore folder query without index | Client File Folder Sprint | Deploy without composite index; verify query doesn't fall back to client-side filter or throw index error |
| Webhook duplicate delivery | BoldSign Webhook Sprint | Replay the same webhook event twice; verify only one file in Storage and one Firestore write |
| AI hallucinated checklist items | AI Closing Checklist Sprint | Compare AI-generated checklist against human-verified MO transaction requirements; flag any items not in the seed template |
| AI context overflow | AI Closing Checklist Sprint | Test with a near-close client with 25+ activities; verify no API error and response references actual client state |
| Custom sender domain not verified | BoldSign Sender Sprint | Receive the sent signature request email; verify "From" header shows realtor email |
| Compliance form outdated | Compliance Template Sprint (metadata) | Verify each template document has `formVersion`, `lastVerifiedDate`, `sourceUrl` fields populated |
| ShowingTime sync timeout | ShowingTime iCal Sync Sprint | Test with a large synthetic feed (150+ events); verify function completes in under 60 seconds |

---

## Sources

- BoldSign API documentation: webhook delivery behavior and merge field API (domain expertise; direct verification unavailable during research session — MEDIUM confidence on specific header name `X-BoldSign-Signature`)
- Firebase Cloud Functions documentation: HTTP function lifecycle, response-before-work behavior, Gen 1 vs Gen 2 config patterns
- RFC 5545 (iCalendar specification): DTSTART, TZID, EXDATE, STATUS:CANCELLED, UID semantics
- `node-ical` npm package: known handling of VTIMEZONE components in Node.js
- Missouri Real Estate Commission (MREC): form update cadence for residential transaction forms
- Existing codebase analysis: `CONCERNS.md` (polling memory leak, signature modal), `INTEGRATIONS.md` (webhook patterns, envelope collection), `ARCHITECTURE.md` (Cloud Function list, file collection structure)

---

*Pitfalls research for: GreenDoor CRM — compliance docs, BoldSign webhook, iCal sync, AI checklist*
*Researched: 2026-03-04*
