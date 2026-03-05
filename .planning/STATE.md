---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Completed 05-01 ShowingTime Sync Backend and Settings UI
last_updated: "2026-03-05T15:21:00Z"
last_activity: 2026-03-05 — Completed 05-01 ShowingTime Sync Backend and Settings UI
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 13
  completed_plans: 12
  percent: 92
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Realtors can manage their entire client-to-close workflow in one place — from lead intake through document signing to closing — without switching between tools.
**Current focus:** Phase 5 -- ShowingTime Sync (iCal feed sync backend, Settings UI, calendar display)

## Current Position

Phase: 5 of 5 (ShowingTime Sync)
Plan: 1 of 2 in current phase (05-01 done)
Status: In Progress
Last activity: 2026-03-05 — Completed 05-01 ShowingTime Sync Backend and Settings UI

Progress: [█████████░] 92%

## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: 3.2m
- Total execution time: 0.63 hours

**By Phase:**

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 01 | P01 | 2m | 1 | 2 |
| 01 | P02 | 4m | 1 | 3 |
| 01 | P03 | 3m | 2 | 1 |
| 02 | P01 | 2m | 2 | 3 |
| 02 | P02 | 2m | 2 | 2 |
| 02 | P03 | 12m | 4 | 4 |

| 03 | P01 | 2m | 1 | 1 |
| 03 | P02 | 1m | 2 | 2 |
| 04 | P01 | 2m | 2 | 3 |
| 04 | P02 | 3m | 2 | 4 |
| 04 | P03 | 2m | 2 | 3 |
| 05 | P01 | 3m | 2 | 5 |

**Recent Trend:**
- Last 5 plans: 1m, 2m, 3m, 2m, 3m
- Trend: consistently fast execution

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Missouri-first compliance docs: validate MO workflow before expanding to other states
- Flat folder model: single-level folders per client (no nested hierarchy)
- Seed BoldSign templates with stubs: decouple template creation from code; IDs pasted later
- Session-only AI chat: conversation history in memory only, not persisted to Firestore
- ShowingTime via iCal: no public API available; webcal feeds are the only integration path
- [Phase 01]: Transaction type saves immediately on dropdown change, not on Save button click
- [Phase 01]: Folder cards replace old folder filter buttons; root view shows all files
- [Phase 01]: File kebab menu consolidates Download and Delete alongside Move to folder
- [Phase 01]: Deterministic document ID (clientId_closing_documents) prevents race condition duplicates for system folders
- [Phase 02]: Duplicated form data in seed script (CommonJS) vs compliance.js (ES module) -- seed runs once, Firestore becomes source of truth
- [Phase 02]: Deterministic Firestore document IDs for template stubs enable idempotent seed re-runs
- [Phase 02]: Node 18 native fetch for BoldSign API calls -- no node-fetch dependency needed
- [Phase 02]: Graceful degradation: sendComplianceDoc proceeds without onBehalfOf if sender identity not approved
- [Phase 02]: Bulk send bundles into single BoldSign envelope via mergeAndSend; auto-falls back to sequential sends if endpoint rejects
- [Phase 02]: Server-side merge field resolution mirrors client-side buildMergeFields for security
- [Phase 02]: No transaction type shows all forms dimmed with warning banner rather than hiding them
- [Phase 03]: formatDate() reused for signedAt display -- already handles Firestore Timestamps
- [Phase 03]: No SDUI-01 code changes needed -- formatComplianceStatus() already renders signed badge from webhook data
- [Phase 03]: HMAC verification uses hex buffer comparison with crypto.timingSafeEqual to prevent timing attacks
- [Phase 03]: Always return 200 to BoldSign even on internal errors to prevent retry loops on permanently failing requests
- [Phase 03]: Deterministic file doc ID pattern (clientId_signed_templateId) for natural webhook idempotency via setDoc
- [Phase 04]: Combined checklist template with propertyTypes tags instead of separate per-property-type templates
- [Phase 04]: Deterministic doc IDs with merge:true for idempotent re-seeding that preserves completion state
- [Phase 04]: linkedTemplateId uses mo- prefixed IDs matching documentTemplates for rename-safe auto-completion mapping
- [Phase 04]: Closing date field in Overview tab Status & Source section (transaction-level, not checklist-level)
- [Phase 04]: Deadline offsets based on MO residential practice (inspection -28d, financing -10d, walkthrough -1d, MO notice -45d)
- [Phase 04]: Window-level functions for inline event handlers in dynamically rendered checklist HTML
- [Phase 04]: Notes auto-save on blur without toast to avoid notification fatigue
- [Phase 04]: askAssistant created as new Cloud Function (did not exist previously); uses gpt-4o-mini with 800 max tokens
- [Phase 04]: Non-fatal try/catch for checklist auto-completion in webhook so errors never fail the webhook
- [Phase 04]: Admin SDK db.batch() for webhook auto-completion vs client SDK writeBatch in checklist.js
- [Phase 04]: sendWithContext as window-level function for cross-module chatbot context injection
- [Phase 05]: Lazy require node-ical inside syncFeedForUser to avoid cold start cost for other functions
- [Phase 05]: Batch chunking at 450 operations to stay safely under Firestore 500 limit
- [Phase 05]: Client-side disconnect uses Promise.all with individual deleteDoc rather than writeBatch for simplicity

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2 pre-work: Verify BoldSign senderDetail field names and sendwithtemplate merge field parameter structure against current API docs before planning Phase 2
- Phase 3 pre-work: Do a test BoldSign webhook delivery and log the raw payload to confirm header name and event payload structure before coding the webhook handler
- Phase 5 pre-work: Inspect a live ShowingTime iCal feed to confirm STATUS, SEQUENCE, EXDATE, and DESCRIPTION field behavior before coding the sync function
- All phases: Verify functions/package.json has "engines": { "node": "18" } before any Cloud Function work

## Session Continuity

Last session: 2026-03-05T15:21:00Z
Stopped at: Completed 05-01 ShowingTime Sync Backend and Settings UI
Resume file: .planning/phases/05-showingtime-sync/05-01-SUMMARY.md
