# Requirements: GreenDoor CRM

**Defined:** 2026-03-04
**Core Value:** Realtors can manage their entire client-to-close workflow in one place — from lead intake through document signing to closing — without switching between tools.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### BoldSign Sender

- [x] **BSND-01**: Document signature emails show the realtor's display name as the sender name
- [x] **BSND-02**: Document signature emails show the realtor's email address as the sender/reply-to
- [x] **BSND-03**: Sender name and email are fetched from the realtor's Firestore profile (users/{uid})
- [x] **BSND-04**: If Firestore profile email is missing, fall back to Firebase Auth email

### File Folders

- [x] **FLDR-01**: User can create a named folder for a client's files
- [x] **FLDR-02**: User can rename an existing folder
- [x] **FLDR-03**: User can delete a folder (files move to root, not deleted)
- [x] **FLDR-04**: Folder cards display above the file list with name and file count
- [x] **FLDR-05**: User can click a folder to filter files; breadcrumb navigates back to root
- [x] **FLDR-06**: User can move a file to a folder or back to root via context menu
- [x] **FLDR-07**: A "Closing Documents" system folder auto-creates per client on page load

### Transaction Type

- [x] **TXTP-01**: Client detail page has a transaction type selector (SFH/Condo/Multi-Family/Land x Buyer/Seller)
- [x] **TXTP-02**: Selected transaction type saves to client's Firestore document (client.transactionType)

### Compliance Documents

- [x] **COMP-01**: Firestore `documentTemplates` collection stores template metadata (name, transaction types, BoldSign template ID, merge fields, category, required flag, order)
- [x] **COMP-02**: Template library seeded with MO residential forms as stubs (Purchase Agreement, Listing Agreement, Agency Disclosure, Lead Paint Disclosure, HOA Addendum, Seller's Disclosure, Buyer Representation Agreement)
- [x] **COMP-03**: Utility function `buildMergeFields(template, client, listing)` resolves field mappings from client, listing, and agent data
- [x] **COMP-04**: New "Compliance Docs" tab on client detail page
- [x] **COMP-05**: Compliance docs tab shows templates filtered by client's transaction type, grouped by category
- [x] **COMP-06**: Each template row shows name, category badge, required indicator, and status (not sent / sent / signed)
- [x] **COMP-07**: "Send for Signature" button calls Cloud Function that autofills BoldSign template with merge fields and sends to client
- [x] **COMP-08**: Cloud Function sets senderDetail to realtor's name and email from Firestore profile
- [x] **COMP-09**: Sent document ID and status saved to clients/{clientId}/complianceDocs/{templateId}
- [x] **COMP-10**: Real-time status display updates from Firestore (not sent / awaiting signature / signed)

### BoldSign Webhook

- [x] **WHBK-01**: HTTP Cloud Function at /boldSignWebhook receives BoldSign completion events
- [x] **WHBK-02**: Webhook verifies HMAC signature using req.rawBody and BOLDSIGN_WEBHOOK_SECRET
- [x] **WHBK-03**: Only processes events where type === "document.completed"
- [x] **WHBK-04**: Looks up matching GreenDoor record by BoldSign document ID
- [x] **WHBK-05**: Downloads signed PDF from BoldSign API
- [x] **WHBK-06**: Uploads signed PDF to Firebase Storage under client's closing path
- [x] **WHBK-07**: Saves file metadata to Firestore with folderId pointing to client's Closing Documents folder
- [x] **WHBK-08**: Updates complianceDocs status to "signed" with signedAt timestamp
- [x] **WHBK-09**: Webhook is idempotent (duplicate events don't create duplicate files)
- [x] **WHBK-10**: Returns 200 OK to BoldSign after processing

### Closing Checklist

- [ ] **CHKL-01**: `closingChecklist` subcollection under each client with category, task, completed, autoCompleted, notes, transactionTypes
- [ ] **CHKL-02**: Default checklist seeded from human-verified MO transaction template when transactionType is set
- [ ] **CHKL-03**: Checklist items grouped by category (Pre-Contract / Under Contract / Closing) on new "Closing Checklist" tab
- [ ] **CHKL-04**: Progress bar per category and overall
- [ ] **CHKL-05**: User can manually toggle checklist items complete/incomplete
- [ ] **CHKL-06**: When a compliance doc is signed (via webhook), matching checklist items auto-complete with autoCompleted: true
- [ ] **CHKL-07**: Auto-completed items display a distinct badge

### AI Check-in

- [ ] **AICX-01**: "Check in with AI" button on Closing Checklist tab opens chat panel (reuse existing AI assistant UI pattern)
- [ ] **AICX-02**: AI receives full transaction context: client name, transaction type, listing address, checklist with completion status, today's date
- [ ] **AICX-03**: AI summarizes what's done, what's outstanding, and flags overdue items
- [ ] **AICX-04**: AI suggests next 2-3 priority actions
- [ ] **AICX-05**: AI answers follow-up questions from the realtor
- [ ] **AICX-06**: Chat is stateful within session (conversation history in memory, not persisted to Firestore)

### ShowingTime Sync

- [ ] **SHWT-01**: Settings page has "Integrations" section with ShowingTime iCal feed URL input
- [ ] **SHWT-02**: Feed URL saves to users/{uid}.showingTimeFeedUrl
- [ ] **SHWT-03**: "Sync Now" button triggers callable Cloud Function to fetch and parse the iCal feed
- [ ] **SHWT-04**: Cloud Function converts webcal:// to https://, fetches feed, parses with node-ical
- [ ] **SHWT-05**: Each VEVENT upserted to users/{uid}/showings/{icalUid} with title, times, location, source: "showingtime"
- [ ] **SHWT-06**: Cancelled events in feed are removed from Firestore (or marked cancelled)
- [ ] **SHWT-07**: Scheduled Cloud Function syncs all users with feed URLs every 30 minutes
- [ ] **SHWT-08**: Rate limited to max once per 15 minutes per user
- [ ] **SHWT-09**: ShowingTime showings display in calendar with distinct "ST" badge, read-only
- [ ] **SHWT-10**: Invalid or expired feed URLs show clear error in Settings with instructions
- [ ] **SHWT-11**: Last synced timestamp displayed in Settings

### Signed Document UI

- [x] **SDUI-01**: Compliance Docs tab shows "Signed" with date when status === "signed"
- [x] **SDUI-02**: Files in Closing Documents folder with signed: true display a green "Signed" badge

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-State Compliance

- **MSCM-01**: Support for additional state compliance form packs beyond Missouri
- **MSCM-02**: State selector on agent profile to load appropriate form library

### Advanced Folder Management

- **ADVF-01**: Nested folder hierarchy (folders within folders)
- **ADVF-02**: Drag-and-drop file/folder reordering

### ShowingTime Enhanced

- **SHWE-01**: Auto-link ShowingTime showings to clients by fuzzy address matching
- **SHWE-02**: Two-way sync (create showings in GreenDoor that appear in ShowingTime)

### Admin Template Management

- **ADTM-01**: Admin UI to create/edit/delete compliance template mappings
- **ADTM-02**: BoldSign template field discovery from API

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| BoldSign template creation in CRM | Templates created manually in BoldSign dashboard; IDs pasted as stubs |
| Multi-state compliance packs | Missouri first; validate workflow before expanding |
| Persistent AI chat history | Session-only to minimize API costs |
| Nested folder hierarchy | Single-level folders sufficient for document organization |
| Two-way ShowingTime sync | No public API; read-only iCal feed is the only option |
| Mobile native app | Web-first; mobile-responsive is sufficient |
| OAuth/social login | Email/password sufficient for current user base |
| Real-time MLS data feed | Manual listing entry + URL parsing is working |
| BoldSign template editor in CRM | Unnecessary complexity; BoldSign UI is purpose-built for this |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TXTP-01 | Phase 1 | Complete |
| TXTP-02 | Phase 1 | Complete |
| FLDR-01 | Phase 1 | Complete |
| FLDR-02 | Phase 1 | Complete |
| FLDR-03 | Phase 1 | Complete |
| FLDR-04 | Phase 1 | Complete |
| FLDR-05 | Phase 1 | Complete |
| FLDR-06 | Phase 1 | Complete |
| FLDR-07 | Phase 1 | Complete |
| BSND-01 | Phase 2 | Complete |
| BSND-02 | Phase 2 | Complete |
| BSND-03 | Phase 2 | Complete |
| BSND-04 | Phase 2 | Complete |
| COMP-01 | Phase 2 | Complete |
| COMP-02 | Phase 2 | Complete |
| COMP-03 | Phase 2 | Complete |
| COMP-04 | Phase 2 | Complete |
| COMP-05 | Phase 2 | Complete |
| COMP-06 | Phase 2 | Complete |
| COMP-07 | Phase 2 | Complete |
| COMP-08 | Phase 2 | Complete |
| COMP-09 | Phase 2 | Complete |
| COMP-10 | Phase 2 | Complete |
| WHBK-01 | Phase 3 | Complete |
| WHBK-02 | Phase 3 | Complete |
| WHBK-03 | Phase 3 | Complete |
| WHBK-04 | Phase 3 | Complete |
| WHBK-05 | Phase 3 | Complete |
| WHBK-06 | Phase 3 | Complete |
| WHBK-07 | Phase 3 | Complete |
| WHBK-08 | Phase 3 | Complete |
| WHBK-09 | Phase 3 | Complete |
| WHBK-10 | Phase 3 | Complete |
| SDUI-01 | Phase 3 | Complete |
| SDUI-02 | Phase 3 | Complete |
| CHKL-01 | Phase 4 | Pending |
| CHKL-02 | Phase 4 | Pending |
| CHKL-03 | Phase 4 | Pending |
| CHKL-04 | Phase 4 | Pending |
| CHKL-05 | Phase 4 | Pending |
| CHKL-06 | Phase 4 | Pending |
| CHKL-07 | Phase 4 | Pending |
| AICX-01 | Phase 4 | Pending |
| AICX-02 | Phase 4 | Pending |
| AICX-03 | Phase 4 | Pending |
| AICX-04 | Phase 4 | Pending |
| AICX-05 | Phase 4 | Pending |
| AICX-06 | Phase 4 | Pending |
| SHWT-01 | Phase 5 | Pending |
| SHWT-02 | Phase 5 | Pending |
| SHWT-03 | Phase 5 | Pending |
| SHWT-04 | Phase 5 | Pending |
| SHWT-05 | Phase 5 | Pending |
| SHWT-06 | Phase 5 | Pending |
| SHWT-07 | Phase 5 | Pending |
| SHWT-08 | Phase 5 | Pending |
| SHWT-09 | Phase 5 | Pending |
| SHWT-10 | Phase 5 | Pending |
| SHWT-11 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 59 total
- Mapped to phases: 59
- Unmapped: 0

**Note:** Original requirement count in this file said 48; actual count from requirement IDs is 59 (BSND: 4, FLDR: 7, TXTP: 2, COMP: 10, WHBK: 10, CHKL: 7, AICX: 6, SHWT: 11, SDUI: 2).

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation — traceability populated*
