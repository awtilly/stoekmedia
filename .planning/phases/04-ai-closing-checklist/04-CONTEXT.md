# Phase 4: AI Closing Checklist - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Realtors have a per-client closing checklist seeded to their transaction type, with items auto-completing when compliance docs are signed and an AI assistant available to summarize progress and suggest next actions. This phase adds: checklist data model with seeding, checklist UI with manual/auto completion and progress tracking, webhook extension for auto-completion, and a contextual AI check-in chat.

</domain>

<decisions>
## Implementation Decisions

### Checklist template content
- One combined template with items tagged as buyer-only, seller-only, or both — filtered at render time based on client's transaction type
- Claude researches standard Missouri residential closing workflow steps to build the seed template; user reviews before it ships
- Claude's discretion on whether to include both compliance-doc items and non-doc milestone items (inspection, appraisal, financing, etc.) and how property type variations (SFH/Condo/Multi-Family/Land) affect the checklist

### AI check-in panel UX
- Auto-summary on open: AI immediately provides a progress summary (what's done, what's outstanding, overdue flags) and 2-3 suggested next actions the moment the panel opens; realtor can then ask follow-ups
- Deadline awareness with auto-calculated dates: realtor enters an expected closing date, and checklist items get auto-calculated deadlines based on standard offsets (e.g., inspection by closing minus 21 days)
- Session-only chat history (carries forward from PROJECT.md decision — not persisted to Firestore)
- Claude's discretion on panel type: inline panel on the checklist tab vs reusing the existing floating chatbot with context injection

### Checklist item behavior
- Realtors can add custom checklist items to any category — custom items are manual-only, never auto-complete
- Seeded items cannot be deleted but can be marked "Not Applicable" (N/A) — preserves the standard template
- Auto-completed items (marked done by webhook) can be manually unchecked by the realtor if needed (e.g., wrong doc version) — auto-completed badge clears on uncheck
- Items grouped by category: Pre-Contract / Under Contract / Closing (from CHKL-03)
- Progress bar per category and overall (from CHKL-04)
- Auto-completed items display a distinct badge (from CHKL-07)
- Claude's discretion on notes UX (inline expandable vs icon popover)

### Doc-to-item auto-mapping
- Subtle toast notification when an item auto-completes (e.g., "Agency Disclosure signed — checklist updated")
- When transaction type changes after checklist is seeded: re-seed with new template items, preserve existing progress and completed items; new items added, realtor can mark no-longer-applicable items as N/A
- Claude's discretion on mapping strategy (explicit `linkedTemplateId` on checklist items vs name-based matching)
- Claude's discretion on trigger architecture (extend boldSignWebhook directly vs separate Firestore onUpdate trigger)

### Claude's Discretion
- Checklist item scope (doc items + non-doc milestone items, or doc items only)
- Property type variations (conditional items vs separate templates)
- AI panel type (inline on checklist tab vs reuse floating chatbot)
- Notes UX pattern (inline expandable vs popover)
- Doc-to-item mapping strategy (templateId link vs name matching)
- Auto-completion trigger architecture (webhook extension vs Firestore trigger)
- Closing date input UX (where it lives, how offsets are configured)
- Auto-calculated deadline offset values for each item category

</decisions>

<specifics>
## Specific Ideas

- Auto-summary on open should feel like a quick status briefing — not a wall of text. Lead with what's done (percentage), then what's outstanding, then next actions.
- Deadline awareness adds real value for realtors juggling multiple closings — "inspection contingency expires in 3 days" is actionable guidance
- N/A marking for seeded items keeps the standard template intact while acknowledging that not every item applies to every deal
- Toast notification for auto-completion keeps the realtor informed without interrupting their current workflow

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `js/chatbot.js`: Existing AI chatbot with floating panel, `askAssistant` Cloud Function, session `chatHistory` array, voice input, quick actions, typing indicator — pattern to follow or extend for check-in
- `askAssistant` Cloud Function in `functions/index.js`: Handles AI queries with context-awareness. Will need extension to accept checklist data as context.
- `js/client-detail.js`: Main workspace module with tab navigation (5 tabs currently + compliance tab), file management, BoldSign integration, `onSnapshot()` listeners
- `js/compliance.js`: `formatComplianceStatus()` for signed badges, compliance tab rendering — pattern for checklist status rendering
- `showToast()` from `js/auth.js`: For auto-completion notifications
- `escapeHtml()` from `js/auth.js`: Required for rendering checklist item text safely
- `getCurrentUser()` from `js/auth.js`: For realtor profile access

### Established Patterns
- Tab navigation: `data-tab` buttons + `gd-tab-content` divs — add new "Closing Checklist" tab
- Real-time listeners: `onSnapshot()` for live checklist updates when webhook auto-completes items
- Module-level state: `let complianceDocs = []` pattern — add `let checklistItems = []`
- Cloud Function calls: `httpsCallable(functions, "functionName")` with `result.data.*` responses
- Deterministic document IDs: `setDoc()` pattern used in Phase 1 (folders) and Phase 3 (webhook) for idempotency
- Session chat history: `chatHistory` array in `chatbot.js` — same pattern for check-in conversation

### Integration Points
- `client-detail.html`: Add "Closing Checklist" tab button + `tab-checklist` content div
- `client-detail.js` or new `js/checklist.js`: Checklist tab logic (load items, render grouped list, toggle completion, progress bars)
- `functions/index.js`: Extend `boldSignWebhook` or add Firestore trigger for auto-completion; extend or create new Cloud Function for AI check-in with checklist context
- Firestore `clients/{clientId}/closingChecklist/{itemId}`: Checklist items subcollection
- Firestore: Closing date field on client record for deadline calculations
- `css/greendoor.css`: New styles for `.gd-checklist-item`, `.gd-progress-bar`, `.gd-auto-badge`, `.gd-na-badge`, `.gd-checkin-panel`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-ai-closing-checklist*
*Context gathered: 2026-03-04*
