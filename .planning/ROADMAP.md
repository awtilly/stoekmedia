# Roadmap: GreenDoor CRM — Document Management, Compliance, Webhook & iCal Milestone

## Overview

This milestone extends the existing GreenDoor CRM with four tightly coupled capabilities: file folder management and transaction type (the foundational data), compliance document automation via BoldSign (the core workflow), a webhook pipeline that auto-saves signed PDFs and auto-completes checklist items (the event-driven backbone), an AI-seeded closing checklist with guided check-in (the intelligence layer), and ShowingTime iCal feed sync (the calendar integration). The build order is dictated by data dependencies: folders and transaction type must exist before compliance sends, which must exist before the webhook can route signed PDFs, which enables checklist auto-completion. ShowingTime is fully independent and runs last.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundations** - Transaction type field on client record + file folder management with auto-created Closing Documents folder
- [ ] **Phase 2: Compliance Documents** - BoldSign sender customization, compliance template library, send-for-signature flow, and real-time status tracking
- [ ] **Phase 3: Webhook Pipeline** - BoldSign webhook receives completion events, verifies HMAC, auto-saves signed PDFs to Closing Documents folder, and marks docs signed
- [ ] **Phase 4: AI Closing Checklist** - AI-seeded per-client closing checklist with manual/auto completion, progress tracking, and contextual AI check-in chat
- [ ] **Phase 5: ShowingTime Sync** - ShowingTime iCal feed import with 30-minute scheduled sync and read-only calendar display

## Phase Details

### Phase 1: Foundations
**Goal**: Realtors can categorize clients by transaction type and organize client files into folders, with a Closing Documents folder auto-created and protected per client
**Depends on**: Nothing (first phase)
**Requirements**: TXTP-01, TXTP-02, FLDR-01, FLDR-02, FLDR-03, FLDR-04, FLDR-05, FLDR-06, FLDR-07
**Success Criteria** (what must be TRUE):
  1. Realtor can select a transaction type (SFH/Condo/Multi-Family/Land x Buyer/Seller) on any client's detail page and it persists on refresh
  2. Realtor can create, rename, and delete named folders for a client's files; deleted folder moves its files to root without data loss
  3. Realtor can click a folder to view only files inside it, with a breadcrumb back to the root file list
  4. Realtor can move a file into a folder or back to root via a context menu on each file
  5. Every client's file section automatically shows a "Closing Documents" system folder that cannot be deleted
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Transaction type selector on Overview tab with immediate Firestore save
- [x] 01-02-PLAN.md — Folder CRUD, navigation, file context menus, drag-and-drop, bulk move, migration
- [x] 01-03-PLAN.md — Auto-created Closing Documents system folder + end-to-end verification checkpoint

### Phase 2: Compliance Documents
**Goal**: Realtors can send Missouri compliance documents for e-signature directly from a client's record, with merge fields auto-filled from client/listing/agent data and the realtor's name shown as sender
**Depends on**: Phase 1
**Requirements**: BSND-01, BSND-02, BSND-03, BSND-04, COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06, COMP-07, COMP-08, COMP-09, COMP-10
**Success Criteria** (what must be TRUE):
  1. Client detail page has a Compliance Docs tab showing only the forms relevant to the client's transaction type
  2. Each form row shows its name, category badge, required indicator, and current status (not sent / sent / signed)
  3. Realtor can click "Send for Signature" and the document is sent via BoldSign with client/listing/agent fields pre-filled
  4. Signature request emails show the realtor's display name and email address, not BoldSign defaults
  5. Status updates from the Firestore record appear in real time without a page refresh
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — BoldSign sender identity Cloud Function + sendComplianceDoc callable shell (BSND-01 through BSND-04)
- [ ] 02-02-PLAN.md — Compliance template library: documentTemplates schema, MO form seed data, buildMergeFields utility (COMP-01 through COMP-03)
- [ ] 02-03-PLAN.md — Compliance Docs tab UI, send-for-signature flow with confirm dialog, Cloud Function implementation, real-time status (COMP-04 through COMP-10)

### Phase 3: Webhook Pipeline
**Goal**: When a client signs a compliance document, the signed PDF automatically appears in their Closing Documents folder and the document status updates to "signed" — without any manual action from the realtor
**Depends on**: Phase 2
**Requirements**: WHBK-01, WHBK-02, WHBK-03, WHBK-04, WHBK-05, WHBK-06, WHBK-07, WHBK-08, WHBK-09, WHBK-10, SDUI-01, SDUI-02
**Success Criteria** (what must be TRUE):
  1. After a client completes signing, a signed PDF appears in the client's Closing Documents folder within seconds (no realtor action required)
  2. The Compliance Docs tab shows "Signed" with a date once the webhook processes the event
  3. Files in Closing Documents with a signed source display a green "Signed" badge in the file list
  4. A duplicate BoldSign event (re-delivery) does not create a second copy of the PDF or double-update status
  5. Forged or invalid webhook requests are rejected with a 401 before any data is written
**Plans**: TBD

Plans:
- [ ] 03-01: Webhook Cloud Function — WHBK-01 through WHBK-05, HTTP onRequest, HMAC verification, idempotency
- [ ] 03-02: Auto-save + status update — WHBK-06 through WHBK-10, Storage upload, Firestore writes, 200 response
- [ ] 03-03: Signed document UI — SDUI-01, SDUI-02, status display on Compliance Docs tab and file badges

### Phase 4: AI Closing Checklist
**Goal**: Realtors have a per-client closing checklist seeded to their transaction type, with items auto-completing when compliance docs are signed and an AI assistant available to summarize progress and suggest next actions
**Depends on**: Phase 3
**Requirements**: CHKL-01, CHKL-02, CHKL-03, CHKL-04, CHKL-05, CHKL-06, CHKL-07, AICX-01, AICX-02, AICX-03, AICX-04, AICX-05, AICX-06
**Success Criteria** (what must be TRUE):
  1. Setting a transaction type on a client seeds a closing checklist with items grouped by category (Pre-Contract / Under Contract / Closing) and an overall progress bar
  2. Realtor can manually check and uncheck checklist items
  3. When a compliance doc is signed via webhook, matching checklist items automatically complete and display a distinct "auto-completed" badge
  4. Realtor can open an AI check-in panel from the checklist tab, and the AI responds with what is done, what is outstanding, and 2-3 suggested next actions
  5. The AI answers follow-up questions within the same session using conversation history (not persisted after close)
**Plans**: TBD

Plans:
- [ ] 04-01: Checklist data model + seeding — CHKL-01, CHKL-02, checklistItems collection, base templates per transaction type
- [ ] 04-02: Checklist UI + manual completion — CHKL-03, CHKL-04, CHKL-05, checklist.js, progress bars per category
- [ ] 04-03: Auto-complete + AI check-in — CHKL-06, CHKL-07, AICX-01 through AICX-06, webhook extension, AI chat panel

### Phase 5: ShowingTime Sync
**Goal**: Realtors can connect their ShowingTime iCal feed and see imported showings in the GreenDoor calendar with a read-only "ST" badge, kept current via a 30-minute scheduled sync
**Depends on**: Phase 1
**Requirements**: SHWT-01, SHWT-02, SHWT-03, SHWT-04, SHWT-05, SHWT-06, SHWT-07, SHWT-08, SHWT-09, SHWT-10, SHWT-11
**Success Criteria** (what must be TRUE):
  1. Realtor can paste a ShowingTime iCal feed URL in Settings and save it
  2. Clicking "Sync Now" imports showings from the feed and they appear in the GreenDoor calendar within seconds
  3. ShowingTime showings display with a distinct "ST" badge and cannot be edited or deleted
  4. Showings cancelled in ShowingTime are removed or marked cancelled in the GreenDoor calendar on the next sync
  5. An invalid or expired feed URL shows a clear error message in Settings with troubleshooting guidance, and the last successful sync time is displayed
**Plans**: TBD

Plans:
- [ ] 05-01: Feed config + sync Cloud Function — SHWT-01 through SHWT-08, showingTimeFeeds collection, node-ical parsing, scheduled sync
- [ ] 05-02: Calendar display — SHWT-09 through SHWT-11, ST badge, read-only behavior, error/timestamp display in Settings

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 (Phase 5 depends only on Phase 1 data model and can begin after Phase 1 completes)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations | 3/3 | Complete | 2026-03-04 |
| 2. Compliance Documents | 0/3 | Not started | - |
| 3. Webhook Pipeline | 0/3 | Not started | - |
| 4. AI Closing Checklist | 0/3 | Not started | - |
| 5. ShowingTime Sync | 0/2 | Not started | - |
