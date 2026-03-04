# Phase 2: Compliance Documents - Research

**Researched:** 2026-03-04
**Domain:** BoldSign e-signature API (sender customization, template send with merge fields), Firestore compliance template library, real-time status tracking
**Confidence:** HIGH

## Summary

Phase 2 adds compliance document sending to the client detail page. The core workflow: the realtor opens a client's Compliance Docs tab, sees Missouri forms filtered by transaction type, clicks "Send for Signature", and the system sends the document via BoldSign with merge fields auto-filled from client/listing/agent data. The realtor's name and email appear as the sender.

The critical technical finding from this research: BoldSign's sender customization uses **Sender Identities** with an `onBehalfOf` parameter, not a simple `senderDetail` object. This requires a one-time sender identity creation and email approval per realtor before documents can show their name/email as sender. The prior stack research flagged `senderDetail` as MEDIUM confidence -- this research confirms the correct mechanism is `onBehalfOf` with pre-approved sender identities. For a single-agent deployment, this is a one-time setup step.

BoldSign's template send endpoint (`POST /v1/template/send`) supports both `existingFormFields` for pre-filling merge field values and `onBehalfOf` for sender customization in the same request. The compliance tab UI follows existing patterns in `client-detail.js` (tab navigation, envelope rows, badge styles, `onSnapshot` real-time listeners). No new frontend libraries are needed -- this is vanilla JS + Firestore + a new callable Cloud Function.

**Primary recommendation:** Implement sender identity creation as a one-time admin/setup step in Plan 02-01, then build the template library in Plan 02-02, and the UI + Cloud Function in Plan 02-03. The `sendComplianceDoc` callable Cloud Function resolves merge fields at send time (never cached) and passes `onBehalfOf` + `existingFormFields` to BoldSign's `/v1/template/send` endpoint.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- New "Compliance Docs" tab on client detail page (6th tab after Properties)
- Compact rows: form name, category badge, red asterisk (*) for required, status badge, and action button on a single line
- Inline "Send" button per row AND checkboxes for bulk "Send Selected" at top -- both interaction modes available
- Confirm dialog before sending -- shows: recipient name/email, form name, listing selector dropdown, and actual merge field values
- Manual listing selection in confirm dialog -- realtor picks which listing's data to use for property-related fields
- Bulk send bundles selected forms into a single BoldSign envelope (one signing session for the client)
- Success feedback: toast notification ("Document sent for signature") + row status immediately updates to "Sent"
- No transaction type set: show all forms dimmed/disabled with a banner explaining transaction type is needed to send
- Three statuses displayed as colored inline badges: gray "Not Sent", yellow/orange "Sent", green "Signed"
- Signed status includes signed date next to the badge (e.g., "Signed -- Mar 4, 2026")
- Real-time status updates via Firestore onSnapshot listener -- no manual refresh needed
- Data sources: client record (name, email, address) + agent Firestore profile (name, email, brokerage) + selected listing (address, price, MLS number)
- Missing required fields: warn in confirm dialog listing what's missing, but allow send anyway -- BoldSign fields left blank for manual fill during signing
- Confirm dialog shows actual resolved values (e.g., "Buyer Name: John Smith", "Property Address: 123 Main St")
- Agent sender detail: realtor's display name and email from Firestore profile (users/{uid}), fallback to Firebase Auth email
- Compact rows should feel consistent with the existing file list in the Files tab -- same visual weight and density
- The confirm dialog should feel like a safety net, not a speed bump -- quick to scan and confirm
- Red asterisk for required is standard and keeps noise low
- Three-color status badges (gray/yellow/green) give at-a-glance progress on which docs are done

### Claude's Discretion
- Form grouping approach (collapsible category headers vs flat list with badges)
- Template filtering when transaction type is set (only matching vs all with dimmed)
- Confirm dialog layout and styling
- Loading states and skeleton patterns for the compliance tab
- Merge field mapping details (which BoldSign field names map to which Firestore paths)
- Bulk send UI pattern (toolbar vs floating action)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BSND-01 | Document signature emails show the realtor's display name as the sender name | BoldSign Sender Identity API with `onBehalfOf` parameter on template send; sender identity must be created and approved first |
| BSND-02 | Document signature emails show the realtor's email address as the sender/reply-to | Same `onBehalfOf` mechanism -- approved sender identity email appears as sender |
| BSND-03 | Sender name and email are fetched from the realtor's Firestore profile (users/{uid}) | `getCurrentUser()` returns `cachedProfile` with `fullName` and `email`; Cloud Function reads `users/{uid}` doc |
| BSND-04 | If Firestore profile email is missing, fall back to Firebase Auth email | Cloud Function checks `userDoc.email || auth.token.email` fallback chain |
| COMP-01 | Firestore `documentTemplates` collection stores template metadata | New `documentTemplates` collection with BoldSign template ID, merge field mapping, category, required flag, transactionTypes array |
| COMP-02 | Template library seeded with MO residential forms as stubs | Seed script or manual Firestore writes with 7 MO form stubs; BoldSign template IDs added later when templates are created in BoldSign dashboard |
| COMP-03 | Utility function `buildMergeFields(template, client, listing)` resolves field mappings | Cloud Function resolves `existingFormFields` array from template's `mergeFields` mapping + client/listing/agent Firestore docs |
| COMP-04 | New "Compliance Docs" tab on client detail page | 6th tab button in client-detail.html + `tab-compliance` content div; follows existing `data-tab` pattern |
| COMP-05 | Compliance docs tab shows templates filtered by client's transaction type, grouped by category | Query `documentTemplates` where `transactionTypes` array-contains client's type; group by `category` field |
| COMP-06 | Each template row shows name, category badge, required indicator, and status | Template literal HTML following `gd-envelope-row` pattern; status from `clients/{clientId}/complianceDocs/{templateId}` subcollection |
| COMP-07 | "Send for Signature" button calls Cloud Function that autofills BoldSign template with merge fields and sends to client | `sendComplianceDoc` callable Cloud Function calls `POST /v1/template/send` with `existingFormFields` and `onBehalfOf` |
| COMP-08 | Cloud Function sets senderDetail to realtor's name and email from Firestore profile | Uses `onBehalfOf` parameter with the realtor's pre-approved sender identity email |
| COMP-09 | Sent document ID and status saved to clients/{clientId}/complianceDocs/{templateId} | Subcollection write after successful BoldSign API call; stores `boldSignDocumentId`, `status`, `sentAt` |
| COMP-10 | Real-time status display updates from Firestore (not sent / awaiting signature / signed) | `onSnapshot` on `clients/{clientId}/complianceDocs` collection; already imported in client-detail.js |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Firebase Firestore SDK | 10.8.0 (CDN) | Client-side reads/writes for templates, compliance docs, real-time listeners | Already loaded; all existing data access uses this |
| Firebase Functions SDK | 10.8.0 (CDN) | `httpsCallable` for invoking `sendComplianceDoc` | Already loaded; existing `sendForSignatureFn` follows this pattern |
| BoldSign REST API v1 | Current | Template send with merge fields and sender identity | Already integrated; `sendForSignature` Cloud Function exists |
| Firebase Admin SDK | ^12.x | Server-side Firestore reads in Cloud Function | Already in Cloud Functions package |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-fetch` or native `fetch` | Node 18 built-in | HTTP calls from Cloud Function to BoldSign API | Only if Cloud Functions runtime is Node 16; Node 18+ has native fetch |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `onBehalfOf` sender identity | BoldSign `senderDetail` object | `senderDetail` is not a documented request parameter on the template send endpoint; `onBehalfOf` is the verified mechanism |
| Subcollection `clients/{cid}/complianceDocs` | Flat `complianceDocs` top-level collection | Subcollection was explicitly specified in COMP-09; keeps compliance doc status tightly coupled to the client document; simple `onSnapshot` on the subcollection |
| Callable Cloud Function | Direct BoldSign API call from frontend | BoldSign API key must stay server-side; callable function provides auth verification and merge field resolution |

**Installation:**
```bash
# No new npm packages needed for Phase 2
# BoldSign REST API is called via native fetch in Cloud Functions (Node 18)
# All frontend code uses existing Firebase SDK CDN imports
```

## Architecture Patterns

### Recommended Project Structure
```
app/
  client-detail.html        # Add 6th tab button + tab-compliance div
js/
  client-detail.js          # Add compliance tab logic, onSnapshot listener
  compliance.js             # NEW: compliance template rendering, send flow, confirm dialog
  auth.js                   # Existing: getCurrentUser(), showToast(), escapeHtml()
  firebase-config.js        # Existing: auth, db, functions, httpsCallable
functions/
  index.js                  # Add sendComplianceDoc callable function
css/
  greendoor.css             # Add .gd-compliance-row, .gd-status-badge-* styles
```

### Pattern 1: Compliance Tab Rendering (follows existing tab pattern)
**What:** Add a 6th tab to client-detail.html and render compliance template rows
**When to use:** When the user clicks the "Compliance Docs" tab button
**Example:**
```html
<!-- client-detail.html: Add tab button -->
<button class="gd-tab" data-tab="compliance">Compliance Docs</button>

<!-- client-detail.html: Add tab content -->
<div id="tab-compliance" class="gd-tab-content">
  <div id="compliance-banner" class="gd-hidden">
    <!-- Banner shown when no transaction type set -->
  </div>
  <div id="compliance-toolbar" class="gd-hidden">
    <!-- Bulk select toolbar -->
  </div>
  <div id="compliance-list"></div>
</div>
```

```javascript
// Source: Existing tab switch pattern from client-detail.js line 246-253
document.querySelectorAll(".gd-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".gd-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".gd-tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});
```

### Pattern 2: Compliance Row Rendering (follows existing envelope row pattern)
**What:** Render each compliance template as a compact row with status badge
**When to use:** For each template in the filtered template list
**Example:**
```javascript
// Source: Follows loadEnvelopes() pattern from client-detail.js line 1504-1522
function renderComplianceRow(template, complianceDoc) {
  const status = complianceDoc?.status || "not_sent";
  const statusBadge = {
    not_sent: '<span class="gd-badge gd-badge-compliance-notsent">Not Sent</span>',
    sent: '<span class="gd-badge gd-badge-compliance-sent">Sent</span>',
    signed: `<span class="gd-badge gd-badge-compliance-signed">Signed &mdash; ${formatDate(complianceDoc?.signedAt)}</span>`
  };

  return `
    <div class="gd-compliance-row">
      <input type="checkbox" class="gd-compliance-check" data-template-id="${template.id}" ${status !== "not_sent" ? "disabled" : ""}>
      <span class="gd-compliance-name">${escapeHtml(template.name)}</span>
      <span class="gd-badge gd-badge-${template.category}">${escapeHtml(template.category)}</span>
      ${template.required ? '<span class="gd-required-asterisk">*</span>' : ""}
      ${statusBadge[status]}
      ${status === "not_sent" ? `<button class="gd-btn gd-btn-sm gd-btn-primary" onclick="openSendDialog('${template.id}')">Send</button>` : ""}
    </div>`;
}
```

### Pattern 3: Real-Time Status Listener (follows existing onSnapshot pattern)
**What:** Listen for compliance doc status changes in real time
**When to use:** After loading the compliance tab
**Example:**
```javascript
// Source: Follows onSnapshot pattern from client-detail.js line 1436
let complianceUnsubscribe = null;

function startComplianceListener(clientId) {
  if (complianceUnsubscribe) complianceUnsubscribe();
  complianceUnsubscribe = onSnapshot(
    collection(db, "clients", clientId, "complianceDocs"),
    (snap) => {
      const docs = {};
      snap.forEach(d => { docs[d.id] = { id: d.id, ...d.data() }; });
      renderComplianceList(docs);
    }
  );
}
```

### Pattern 4: Callable Cloud Function (follows existing sendForSignature pattern)
**What:** Client calls Cloud Function to send compliance doc via BoldSign
**When to use:** When realtor confirms send in the confirm dialog
**Example:**
```javascript
// Source: Follows existing callable pattern from client-detail.js line 52-54
const sendComplianceDocFn = httpsCallable(functions, "sendComplianceDoc");

async function sendComplianceDoc(templateId, clientId, listingId) {
  const result = await sendComplianceDocFn({ templateId, clientId, listingId });
  return result.data; // { documentId, status }
}
```

### Pattern 5: BoldSign Template Send with Merge Fields and onBehalfOf
**What:** Cloud Function calls BoldSign API to send a template with pre-filled fields
**When to use:** Inside the `sendComplianceDoc` Cloud Function
**Example:**
```javascript
// Source: BoldSign API docs - POST /v1/template/send
// https://developers.boldsign.com/documents/send-document-from-template/
// https://developers.boldsign.com/how-to-guides/send-document-from-template-by-filling-existing-fields/

const response = await fetch(
  `https://api.boldsign.com/v1/template/send?templateId=${boldSignTemplateId}`,
  {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.BOLDSIGN_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      roles: [{
        roleIndex: 1,
        signerName: clientData.fullName,
        signerEmail: clientData.email,
        existingFormFields: [
          { id: "BuyerName", value: clientData.fullName },
          { id: "BuyerEmail", value: clientData.email },
          { id: "PropertyAddress", value: listingData?.address?.full || "" },
          { id: "PurchasePrice", value: String(listingData?.listingPrice || "") },
          { id: "AgentName", value: agentProfile.fullName },
          { id: "AgentEmail", value: agentProfile.email }
        ]
      }],
      onBehalfOf: agentProfile.email, // Approved sender identity email
      title: templateData.name,
      message: `Please review and sign: ${templateData.name}`
    })
  }
);
```

### Anti-Patterns to Avoid
- **Caching merge field values in the template document:** Client data changes. Always resolve merge fields at send time from live Firestore data.
- **Using `onCall` for webhook receiver:** BoldSign webhook is Phase 3, but note: `onCall` rejects unauthenticated requests. Use `onRequest` when Phase 3 arrives.
- **Hardcoding BoldSign field IDs in the Cloud Function:** Field IDs come from the BoldSign template. Store the mapping in the `documentTemplates` Firestore collection so it can be updated without code changes.
- **Storing compliance doc status on the template document:** Status is per-client-per-template. Use the `clients/{clientId}/complianceDocs/{templateId}` subcollection as specified in COMP-09.
- **Using `getDocs` for real-time status:** COMP-10 requires real-time updates. Use `onSnapshot` on the complianceDocs subcollection.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sender email customization | Custom email relay / SMTP override | BoldSign Sender Identity API with `onBehalfOf` | BoldSign handles email deliverability, SPF/DKIM, and audit trail |
| Merge field resolution engine | Generic templating library | Simple object mapping in Cloud Function | Only 6-10 fields per template; a `for` loop over the template's `mergeFields` array is sufficient |
| Real-time status sync | WebSocket server or polling interval | Firestore `onSnapshot` listener | Already imported and used in client-detail.js; subcollection listener is the Firestore-native approach |
| Form category badge colors | Dynamic color picker / CSS-in-JS | Static CSS classes matching existing badge pattern | Existing `gd-badge-contracts`, `gd-badge-disclosures` etc. already defined in greendoor.css |
| Confirm dialog modal | Third-party modal library | Native HTML modal pattern matching existing project modals | 15+ modals in client-detail.js already follow the `classList.add("active")` pattern |

**Key insight:** This phase is a UI + Cloud Function addition on top of a well-established pattern. Every major pattern (tabs, rows, badges, modals, callable functions, onSnapshot) already exists in the codebase. The only new external integration is the BoldSign Sender Identity API.

## Common Pitfalls

### Pitfall 1: BoldSign Sender Identity Requires Pre-Approval
**What goes wrong:** The Cloud Function sends `onBehalfOf: "realtor@email.com"` but BoldSign rejects the request or falls back to the default account sender because no sender identity was created and approved for that email.
**Why it happens:** Sender identities require a two-step process: create identity via API, then the realtor approves via email link. Developers assume the `onBehalfOf` field just works without the setup step.
**How to avoid:** Plan 02-01 must include: (1) Create a sender identity for the realtor via `POST /v1/senderIdentities/create`, (2) The realtor approves via the email link, (3) Only then can `onBehalfOf` be used. For a single-agent deployment, this is a one-time manual step. Store the approval status in the user's Firestore profile (e.g., `boldSignSenderApproved: true`).
**Warning signs:** BoldSign API returns 200 but the email shows "BoldSign" as sender instead of the realtor's name.

### Pitfall 2: Merge Field Names Must Match BoldSign Template Exactly
**What goes wrong:** The Cloud Function sends `{ id: "buyer_name", value: "John Smith" }` but the BoldSign template has the field named `BuyerName`. BoldSign silently ignores unmatched fields -- the document sends but all merge fields are blank.
**Why it happens:** Merge field IDs are set when creating the template in BoldSign's dashboard. There is no error returned for mismatched field names.
**How to avoid:** After creating each BoldSign template, use `GET /v1/template/{templateId}` to retrieve the actual field IDs. Store these IDs in the `documentTemplates` Firestore collection's `mergeFields` array so the Cloud Function uses the exact names. Test every template with a full send and verify fields are populated.
**Warning signs:** Documents send successfully (200 OK) but arrive with empty form fields.

### Pitfall 3: Subcollection onSnapshot Requires Separate Listener Setup
**What goes wrong:** Developer tries to listen on `clients/{clientId}/complianceDocs` but uses a top-level collection reference instead of a subcollection reference. The listener returns no results.
**Why it happens:** Most existing listeners in client-detail.js use top-level collections. The `complianceDocs` subcollection path requires `collection(db, "clients", clientId, "complianceDocs")` -- not `collection(db, "complianceDocs")`.
**How to avoid:** Use the correct Firestore subcollection path: `collection(db, "clients", clientId, "complianceDocs")`. This is one of the few subcollections in the project; document it clearly.
**Warning signs:** `onSnapshot` fires once with an empty snapshot; compliance doc statuses never update.

### Pitfall 4: Bulk Send Timing -- Multiple Templates in One Envelope
**What goes wrong:** Bulk send calls the BoldSign API once per template, creating N separate signature sessions. The client receives N emails instead of one combined signing session.
**Why it happens:** The single-template send endpoint (`/v1/template/send`) sends one template at a time. For bulk sending, BoldSign has a separate multi-template endpoint.
**How to avoid:** Use BoldSign's multi-template endpoint `POST /v1/template/mergeAndSend` (or equivalent) when multiple templates are selected. This bundles them into a single envelope. Verify this endpoint exists and supports `existingFormFields` and `onBehalfOf`. If it does not support merge fields, fall back to sequential single-template sends with clear UX messaging ("Sending 3 documents...").
**Warning signs:** Bulk send creates multiple envelopes in the `complianceDocs` subcollection instead of one.

### Pitfall 5: Listing Selector Shows No Listings When Client Has None
**What goes wrong:** The confirm dialog has a listing selector dropdown but the client has no linked listings. The dropdown is empty, property-related merge fields are blank, and the realtor doesn't understand why.
**Why it happens:** Not all clients have linked listings at the time of sending compliance docs (e.g., early in the buyer process).
**How to avoid:** When no listings exist, show a clear message in the confirm dialog: "No listings linked to this client. Property fields will be left blank for manual entry." Still allow sending. When listings exist, default to the first one but let the realtor switch.
**Warning signs:** Confirm dialog shows an empty dropdown with no explanation.

## Code Examples

Verified patterns from the existing codebase and BoldSign API documentation.

### documentTemplates Collection Schema
```javascript
// Firestore collection: documentTemplates
// Source: COMP-01, Architecture Research
{
  name: "Purchase Agreement",           // Display name
  description: "Standard MO residential purchase contract",
  boldSignTemplateId: "STUB_PLACEHOLDER", // Set after template created in BoldSign dashboard
  category: "contracts",                 // contracts | disclosures | financial | inspections
  transactionTypes: ["SFH - Buyer", "Condo - Buyer", "Multi-Family - Buyer", "Land - Buyer"],
  state: "MO",
  required: true,
  sortOrder: 1,
  mergeFields: [
    // Each maps a BoldSign field ID to a data source path
    { boldSignFieldId: "BuyerName", source: "client.fullName" },
    { boldSignFieldId: "BuyerEmail", source: "client.email" },
    { boldSignFieldId: "PropertyAddress", source: "listing.address.full" },
    { boldSignFieldId: "PurchasePrice", source: "listing.listingPrice" },
    { boldSignFieldId: "MLSNumber", source: "listing.mlsNumber" },
    { boldSignFieldId: "AgentName", source: "agent.fullName" },
    { boldSignFieldId: "AgentEmail", source: "agent.email" },
    { boldSignFieldId: "Brokerage", source: "agent.brokerage" }
  ],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}
```

### complianceDocs Subcollection Schema
```javascript
// Firestore subcollection: clients/{clientId}/complianceDocs/{templateId}
// Source: COMP-09
{
  templateId: "abc123",                  // documentTemplates doc ID
  boldSignDocumentId: "bs-doc-id-456",   // BoldSign document ID from API response
  status: "sent",                        // "not_sent" | "sent" | "signed"
  sentAt: serverTimestamp(),
  signedAt: null,                        // Set by Phase 3 webhook
  sentBy: "realtor-uid",                 // The realtor who sent it
  listingId: "listing-id-789"            // Which listing's data was used for merge fields
}
```

### Missouri Form Stubs (Seed Data)
```javascript
// Source: COMP-02 - MO residential forms
const moForms = [
  { name: "Purchase Agreement", category: "contracts", required: true, transactionTypes: ["SFH - Buyer", "Condo - Buyer", "Multi-Family - Buyer", "Land - Buyer"], sortOrder: 1 },
  { name: "Listing Agreement", category: "contracts", required: true, transactionTypes: ["SFH - Seller", "Condo - Seller", "Multi-Family - Seller", "Land - Seller"], sortOrder: 2 },
  { name: "Agency Disclosure", category: "disclosures", required: true, transactionTypes: ["SFH - Buyer", "SFH - Seller", "Condo - Buyer", "Condo - Seller", "Multi-Family - Buyer", "Multi-Family - Seller", "Land - Buyer", "Land - Seller"], sortOrder: 3 },
  { name: "Lead Paint Disclosure", category: "disclosures", required: true, transactionTypes: ["SFH - Buyer", "SFH - Seller", "Condo - Buyer", "Condo - Seller"], sortOrder: 4 },
  { name: "HOA Addendum", category: "contracts", required: false, transactionTypes: ["Condo - Buyer", "Condo - Seller"], sortOrder: 5 },
  { name: "Seller's Disclosure", category: "disclosures", required: true, transactionTypes: ["SFH - Seller", "Condo - Seller", "Multi-Family - Seller"], sortOrder: 6 },
  { name: "Buyer Representation Agreement", category: "contracts", required: true, transactionTypes: ["SFH - Buyer", "Condo - Buyer", "Multi-Family - Buyer", "Land - Buyer"], sortOrder: 7 }
];
```

### buildMergeFields Utility Function
```javascript
// Source: COMP-03 - resolves merge fields from template mapping + data sources
function buildMergeFields(template, clientData, listingData, agentProfile) {
  const sources = {
    client: clientData || {},
    listing: listingData || {},
    agent: agentProfile || {}
  };

  const missing = [];
  const existingFormFields = template.mergeFields.map(field => {
    const [sourceKey, ...pathParts] = field.source.split(".");
    let value = sources[sourceKey];
    for (const part of pathParts) {
      value = value?.[part];
    }
    const resolved = value != null ? String(value) : "";
    if (!resolved) missing.push(field.boldSignFieldId);
    return { id: field.boldSignFieldId, value: resolved };
  });

  return { existingFormFields, missing };
}
```

### Sender Identity Creation (One-Time Setup)
```javascript
// Source: BoldSign Sender Identity API
// https://developers.boldsign.com/sender-identities/create-identity/
// Called once per realtor during onboarding or first compliance doc send

async function createSenderIdentity(realtorName, realtorEmail) {
  const response = await fetch("https://api.boldsign.com/v1/senderIdentities/create", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.BOLDSIGN_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: realtorName,
      email: realtorEmail
    })
  });
  // Returns identity object; realtor receives approval email
  // Store approval status: users/{uid}.boldSignSenderIdentityStatus = "pending"
  return response.json();
}
```

### Available Data Fields for Merge Resolution

**Client record (`clients/{clientId}`):**
| Field | Type | Example |
|-------|------|---------|
| `fullName` | string | "John Smith" |
| `email` | string | "john@example.com" |
| `phone` | string | "(314) 555-1234" |
| `transactionType` | string | "SFH - Buyer" |

**Agent profile (`users/{uid}`):**
| Field | Type | Example |
|-------|------|---------|
| `fullName` | string | "Jane Agent" |
| `email` | string | "jane@realty.com" |
| `phone` | string | "(314) 555-5678" |
| `emailSignature` | string | "Best regards, Jane Agent" |

**Listing record (`listings/{listingId}`):**
| Field | Type | Example |
|-------|------|---------|
| `address.full` | string | "123 Main St, St. Louis, MO 63101" |
| `address.city` | string | "St. Louis" |
| `address.state` | string | "MO" |
| `address.zip` | string | "63101" |
| `listingPrice` | number | 285000 |
| `mlsNumber` | string | "MLS12345678" |
| `propertyType` | string | "Single Family" |
| `bedrooms` | number | 3 |
| `bathrooms` | number | 2 |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `senderDetail` object on send request | Sender Identity API with `onBehalfOf` parameter | BoldSign current API (verified March 2026) | Sender customization requires a pre-approval step; `senderDetail` as a request body field is not documented on the template send endpoint |
| `formFields` with `value` property | `existingFormFields` array with `id` + `value` | BoldSign current API (verified March 2026) | Pre-filling template fields uses `existingFormFields` (not `formFields`) on the template send endpoint |
| Top-level `complianceDocs` collection | Subcollection `clients/{cid}/complianceDocs/{tid}` | COMP-09 specification | Deviates from project's flat-collection pattern but was explicitly specified in requirements |

**Deprecated/outdated from prior research:**
- Prior stack research referenced `senderDetail.name` / `senderDetail.email` as the sender customization mechanism (MEDIUM confidence). This is INCORRECT for the template send endpoint. The correct mechanism is `onBehalfOf` with a pre-approved sender identity.
- Prior stack research referenced `formFields` with `value` property for merge field prefill. The correct property name for the template send endpoint is `existingFormFields` (array of `{id, value}` objects).

## Open Questions

1. **BoldSign Multi-Template Merge Endpoint**
   - What we know: Single template send works via `POST /v1/template/send`. BoldSign has a `send-document-using-multiple-templates` endpoint.
   - What's unclear: Whether the multi-template endpoint supports `existingFormFields` and `onBehalfOf` in the same way as the single template endpoint.
   - Recommendation: For Plan 02-03, implement single-template send first. If bulk send requires the multi-template endpoint, verify its parameter support before implementation. Fallback: sequential single sends with progress indicator.

2. **Sender Identity Approval Timing**
   - What we know: After `POST /v1/senderIdentities/create`, the realtor receives an approval email and must click a link. Only after approval can `onBehalfOf` be used.
   - What's unclear: How long the approval link is valid. Whether we can check approval status via API. What happens if the realtor's email changes.
   - Recommendation: Create the sender identity during Plan 02-01. Store status in `users/{uid}.boldSignSenderIdentityStatus`. Check status before allowing compliance doc send. If not approved, show a warning and fall back to sending without `onBehalfOf` (default BoldSign account as sender).

3. **BoldSign Template Field IDs (Stubs)**
   - What we know: Templates are created in BoldSign's dashboard. Field IDs are assigned during template creation. The `documentTemplates` collection stores field mappings.
   - What's unclear: Exact field IDs for each MO form template (these don't exist yet in BoldSign).
   - Recommendation: Seed the `documentTemplates` collection with placeholder `boldSignTemplateId` values. When real templates are created in BoldSign's dashboard, update the template IDs and field mappings. The `mergeFields` array should be updated after running `GET /v1/template/{templateId}` to discover actual field IDs.

4. **Transaction Type Values (RESOLVED)**
   - Verified from `app/client-detail.html` lines 131-139: The `ov-transactionType` select uses these exact string values: `"SFH - Buyer"`, `"SFH - Seller"`, `"Condo - Buyer"`, `"Condo - Seller"`, `"Multi-Family - Buyer"`, `"Multi-Family - Seller"`, `"Land - Buyer"`, `"Land - Seller"`
   - The `documentTemplates.transactionTypes` array must use these exact strings for `array-contains` queries to work
   - All seed data in this research has been updated to use these values

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual testing (no automated test framework detected in project) |
| Config file | none -- see Wave 0 |
| Quick run command | Manual browser testing |
| Full suite command | Manual browser testing |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BSND-01 | Sender name shows realtor's display name | manual-only | Verify "From" field in received signature email | N/A |
| BSND-02 | Sender email shows realtor's email | manual-only | Verify "From" field in received signature email | N/A |
| BSND-03 | Sender data fetched from Firestore profile | manual-only | Check Cloud Function logs for profile read | N/A |
| BSND-04 | Fallback to Firebase Auth email | manual-only | Test with user profile missing email field | N/A |
| COMP-01 | documentTemplates collection stores metadata | manual-only | Verify Firestore document structure in Firebase console | N/A |
| COMP-02 | MO form stubs seeded | manual-only | Query documentTemplates in Firebase console; verify 7 docs | N/A |
| COMP-03 | buildMergeFields resolves field mappings | manual-only | Send a doc and verify field values in the received document | N/A |
| COMP-04 | Compliance Docs tab exists | manual-only | Navigate to client detail, verify 6th tab appears | N/A |
| COMP-05 | Templates filtered by transaction type | manual-only | Set transaction type on client; verify tab shows matching forms | N/A |
| COMP-06 | Row shows name, badge, required, status | manual-only | Visual inspection of compliance tab rows | N/A |
| COMP-07 | Send button triggers BoldSign send | manual-only | Click Send, verify BoldSign document created | N/A |
| COMP-08 | Cloud Function sets sender to realtor | manual-only | Check sent email sender field | N/A |
| COMP-09 | Status saved to complianceDocs subcollection | manual-only | Verify Firestore subcollection after send | N/A |
| COMP-10 | Real-time status updates | manual-only | Change status in Firestore console; verify UI updates without refresh | N/A |

### Sampling Rate
- **Per task commit:** Manual browser test of affected feature
- **Per wave merge:** Full walkthrough of compliance tab send flow
- **Phase gate:** Complete send-to-status flow with BoldSign (or stub) verified

### Wave 0 Gaps
- No automated test infrastructure exists in this project
- All validation is manual browser testing
- Consider adding a simple smoke test script that verifies Firestore document structures after seeding

*(Manual-only testing is appropriate for this project -- it is a static HTML + vanilla JS + Firebase app with no build step or test runner)*

## Sources

### Primary (HIGH confidence)
- BoldSign API documentation: [Send document from template](https://developers.boldsign.com/documents/send-document-from-template/) -- verified endpoint, request parameters, `existingFormFields` structure
- BoldSign API documentation: [Send from template filling existing fields](https://developers.boldsign.com/how-to-guides/send-document-from-template-by-filling-existing-fields/) -- verified `existingFormFields` array with `id` + `value` structure
- BoldSign API documentation: [Create sender identity](https://developers.boldsign.com/sender-identities/create-identity/) -- verified sender identity creation API, approval workflow
- BoldSign API documentation: [Send on behalf of others](https://developers.boldsign.com/how-to-guides/send-document-onbehalf-of-others/) -- verified `onBehalfOf` parameter works on `/v1/template/send`
- [Sender Identity API blog](https://boldsign.com/blogs/manage-sender-identity-api/) -- verified delegation model, approval requirement, no BoldSign account needed for identity owner
- Existing codebase: `js/client-detail.js` -- verified tab pattern, envelope row pattern, onSnapshot usage, callable function invocation
- Existing codebase: `js/auth.js` -- verified getCurrentUser(), showToast(), escapeHtml() exports
- Existing codebase: `js/firebase-config.js` -- verified Firebase SDK 10.8.0, us-central1 region
- Existing codebase: `css/greendoor.css` -- verified badge styles, envelope row styles, modal patterns
- Existing codebase: `js/listings.js` -- verified listing data structure (address object, listingPrice, mlsNumber)
- Existing codebase: `js/settings.js` -- verified user profile fields (fullName, phone, email)

### Secondary (MEDIUM confidence)
- BoldSign multi-template endpoint: [Send using multiple templates](https://developers.boldsign.com/documents/send-document-using-multiple-templates/) -- endpoint exists but `existingFormFields` + `onBehalfOf` support not confirmed for this endpoint
- BoldSign sender identity approval status API -- existence of a check-status endpoint not confirmed; may need to query `/v1/senderIdentities/list`

### Tertiary (LOW confidence)
- BoldSign bulk send behavior: Whether bundling multiple templates into one envelope preserves individual `existingFormFields` per template -- needs empirical testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use; no new dependencies
- Architecture: HIGH - all patterns (tabs, rows, badges, modals, callable functions, onSnapshot) verified in existing codebase
- BoldSign sender customization: HIGH - `onBehalfOf` mechanism verified via multiple official docs; corrects prior MEDIUM-confidence `senderDetail` assumption
- BoldSign merge fields: HIGH - `existingFormFields` with `{id, value}` verified in official docs with code examples
- Pitfalls: HIGH - merge field mismatch and sender identity approval are well-documented BoldSign behaviors
- Bulk send: MEDIUM - multi-template endpoint exists but parameter compatibility with this use case needs testing

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain -- BoldSign API v1 is current; Firebase SDK patterns unchanged)
