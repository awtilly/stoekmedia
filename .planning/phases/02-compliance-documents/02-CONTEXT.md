# Phase 2: Compliance Documents - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Realtors can send Missouri compliance documents for e-signature directly from a client's record, with merge fields auto-filled from client/listing/agent data and the realtor's name shown as sender. This phase adds: BoldSign sender customization, a compliance template library seeded with MO form stubs, a send-for-signature flow with confirmation, and real-time status tracking per client. Template creation happens in BoldSign's dashboard — GreenDoor stores template IDs.

</domain>

<decisions>
## Implementation Decisions

### Compliance tab layout
- New "Compliance Docs" tab on client detail page (6th tab after Properties)
- Compact rows: form name, category badge, red asterisk (*) for required, status badge, and action button on a single line
- Grouping approach (by category headers vs flat list): Claude's discretion based on MO form count
- Inline "Send" button per row AND checkboxes for bulk "Send Selected" at top — both interaction modes available

### Send flow & confirmation
- Confirm dialog before sending — shows: recipient name/email, form name, listing selector dropdown, and actual merge field values
- Manual listing selection in confirm dialog — realtor picks which listing's data to use for property-related fields
- Bulk send bundles selected forms into a single BoldSign envelope (one signing session for the client)
- Success feedback: toast notification ("Document sent for signature") + row status immediately updates to "Sent"
- No transaction type set: show all forms dimmed/disabled with a banner explaining transaction type is needed to send

### Template filtering & status
- When transaction type IS set, filtering behavior (only matching vs all with dimmed non-applicable): Claude's discretion
- Three statuses displayed as colored inline badges: gray "Not Sent", yellow/orange "Sent", green "Signed"
- Signed status includes signed date next to the badge (e.g., "Signed — Mar 4, 2026")
- Real-time status updates via Firestore onSnapshot listener — no manual refresh needed

### Merge field handling
- Data sources: client record (name, email, address) + agent Firestore profile (name, email, brokerage) + selected listing (address, price, MLS number)
- Missing required fields: warn in confirm dialog listing what's missing, but allow send anyway — BoldSign fields left blank for manual fill during signing
- Confirm dialog shows actual resolved values (e.g., "Buyer Name: John Smith", "Property Address: 123 Main St")
- Agent sender detail: realtor's display name and email from Firestore profile (users/{uid}), fallback to Firebase Auth email

### Claude's Discretion
- Form grouping approach (collapsible category headers vs flat list with badges)
- Template filtering when transaction type is set (only matching vs all with dimmed)
- Confirm dialog layout and styling
- Loading states and skeleton patterns for the compliance tab
- Merge field mapping details (which BoldSign field names map to which Firestore paths)
- Bulk send UI pattern (toolbar vs floating action)

</decisions>

<specifics>
## Specific Ideas

- Compact rows should feel consistent with the existing file list in the Files tab — same visual weight and density
- The confirm dialog should feel like a safety net, not a speed bump — quick to scan and confirm
- Red asterisk for required is standard and keeps noise low
- Three-color status badges (gray/yellow/green) give at-a-glance progress on which docs are done

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `client-detail.js` (~2000 lines): Main workspace module — already has BoldSign integration (`sendForSignatureFn`, `checkSignatureStatusFn`, `createEmbeddedSignatureRequestFn`), file management, and tab navigation
- `loadEnvelopes()` function: Existing envelope list rendering with status badges — pattern to follow for compliance doc rows
- `openBoldSignEmbed()`: Existing embedded signing modal — may be extended or reused
- `showToast()` from `auth.js`: Used for all user feedback
- `escapeHtml()` from `auth.js`: Required for rendering form names and merge field values
- `getCurrentUser()` from `auth.js`: Fetches realtor profile with fullName, email
- Existing `envelopes` Firestore collection: Pattern for tracking sent documents

### Established Patterns
- Tab navigation: `data-tab` buttons + `gd-tab-content` divs (5 tabs currently: overview, activity, showings, files, properties)
- Real-time listeners: `onSnapshot()` used throughout client-detail.js for live data
- Cloud Function calls: `httpsCallable(functions, "functionName")` pattern with `result.data.*` responses
- Module-level state: `let allFiles = []` pattern — add `let complianceDocs = []` similarly
- Template literal HTML generation with `escapeHtml()` for all user data
- Kebab-case HTML IDs with context prefix: `tab-files`, `ov-fullName`

### Integration Points
- `client-detail.html`: Add 6th tab button + `tab-compliance` content div
- `client-detail.js`: Add compliance tab logic (load templates, render rows, send flow, status listener)
- New Cloud Function `sendComplianceDoc`: Calls BoldSign sendwithtemplate API with senderDetail and merge fields
- New Firestore collection `documentTemplates`: Template metadata (name, BoldSign ID, merge fields, category, required, transactionTypes)
- New Firestore subcollection `clients/{clientId}/complianceDocs/{templateId}`: Tracks sent status per client per template
- `css/greendoor.css`: New styles for `.gd-compliance-row`, `.gd-status-badge`, `.gd-confirm-dialog`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-compliance-documents*
*Context gathered: 2026-03-04*
