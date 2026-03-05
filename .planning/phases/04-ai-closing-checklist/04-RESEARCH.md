# Phase 4: AI Closing Checklist - Research

**Researched:** 2026-03-04
**Domain:** Firestore data modeling, checklist UI, webhook integration, AI chat (OpenAI via Cloud Functions), Missouri residential real estate workflows
**Confidence:** HIGH (data model, UI patterns, webhook extension) / MEDIUM (MO transaction timeline offsets, AI prompt engineering)

## Summary

Phase 4 adds three capabilities to the client-detail page: (1) a closing checklist data model with seeding from a MO residential transaction template, (2) a checklist UI with manual/auto completion and progress tracking, and (3) an AI check-in panel that summarizes transaction progress and suggests next actions. The phase builds on completed Phase 3 infrastructure (BoldSign webhook, compliance docs, signed document UI) and follows established codebase patterns for tabs, real-time listeners, badges, and Cloud Function calls.

The checklist data lives in a `clients/{clientId}/closingChecklist/{itemId}` subcollection with deterministic IDs for seeded items (enabling idempotent re-seeding). The template is a single combined array in a JS constant, filtered at render time by transaction type (buyer/seller) and property type tags. Auto-completion extends the existing `boldSignWebhook` Cloud Function to also update matching checklist items when a compliance doc is signed. The AI check-in reuses the existing `askAssistant` Cloud Function pattern, extended with a new context type that passes checklist state, client data, and closing date as a structured system prompt.

**Primary recommendation:** Store the checklist template as a JS constant in a new `js/checklist.js` module (mirrors `compliance.js` pattern), seed to Firestore subcollection on transaction type set/change, and extend the deployed `askAssistant` Cloud Function to accept a `checklist_checkin` context type with structured transaction data. Use the existing floating chatbot panel for the AI check-in by adding context injection, not a separate inline panel.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- One combined template with items tagged as buyer-only, seller-only, or both -- filtered at render time based on client's transaction type
- Claude researches standard Missouri residential closing workflow steps to build the seed template; user reviews before it ships
- Auto-summary on open: AI immediately provides a progress summary (what's done, what's outstanding, overdue flags) and 2-3 suggested next actions the moment the panel opens; realtor can then ask follow-ups
- Deadline awareness with auto-calculated dates: realtor enters an expected closing date, and checklist items get auto-calculated deadlines based on standard offsets (e.g., inspection by closing minus 21 days)
- Session-only chat history (carries forward from PROJECT.md decision -- not persisted to Firestore)
- Realtors can add custom checklist items to any category -- custom items are manual-only, never auto-complete
- Seeded items cannot be deleted but can be marked "Not Applicable" (N/A) -- preserves the standard template
- Auto-completed items (marked done by webhook) can be manually unchecked by the realtor if needed (e.g., wrong doc version) -- auto-completed badge clears on uncheck
- Items grouped by category: Pre-Contract / Under Contract / Closing (from CHKL-03)
- Progress bar per category and overall (from CHKL-04)
- Auto-completed items display a distinct badge (from CHKL-07)
- Subtle toast notification when an item auto-completes (e.g., "Agency Disclosure signed -- checklist updated")
- When transaction type changes after checklist is seeded: re-seed with new template items, preserve existing progress and completed items; new items added, realtor can mark no-longer-applicable items as N/A

### Claude's Discretion
- Checklist item scope (doc items + non-doc milestone items, or doc items only)
- Property type variations (conditional items vs separate templates)
- AI panel type (inline on checklist tab vs reuse floating chatbot)
- Notes UX pattern (inline expandable vs popover)
- Doc-to-item mapping strategy (templateId link vs name matching)
- Auto-completion trigger architecture (webhook extension vs Firestore trigger)
- Closing date input UX (where it lives, how offsets are configured)
- Auto-calculated deadline offset values for each item category

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CHKL-01 | `closingChecklist` subcollection under each client with category, task, completed, autoCompleted, notes, transactionTypes | Data model section defines exact schema with all fields including deadline offsets, N/A status, custom flag |
| CHKL-02 | Default checklist seeded from human-verified MO transaction template when transactionType is set | Template content section provides complete MO checklist items; seeding logic pattern documented |
| CHKL-03 | Checklist items grouped by category (Pre-Contract / Under Contract / Closing) on new "Closing Checklist" tab | UI architecture section covers tab addition, category grouping, and rendering pattern |
| CHKL-04 | Progress bar per category and overall | Progress bar pattern documented with CSS class reuse and calculation logic |
| CHKL-05 | User can manually toggle checklist items complete/incomplete | Toggle handler pattern documented; includes N/A and auto-completed edge cases |
| CHKL-06 | When a compliance doc is signed (via webhook), matching checklist items auto-complete with autoCompleted: true | Webhook extension pattern documented; explicit templateId mapping strategy |
| CHKL-07 | Auto-completed items display a distinct badge | Badge CSS pattern reuses existing `.gd-badge` system; auto-completed badge spec provided |
| AICX-01 | "Check in with AI" button on Closing Checklist tab opens chat panel | Reuses existing chatbot.js floating panel with context injection |
| AICX-02 | AI receives full transaction context: client name, transaction type, listing address, checklist with completion status, today's date | Context assembly pattern documented; token budget analysis provided |
| AICX-03 | AI summarizes what's done, what's outstanding, and flags overdue items | System prompt template documented with structured output guidance |
| AICX-04 | AI suggests next 2-3 priority actions | Included in system prompt template |
| AICX-05 | AI answers follow-up questions from the realtor | Session chat history pattern reuses existing chatbot.js `chatHistory` array |
| AICX-06 | Chat is stateful within session (conversation history in memory, not persisted to Firestore) | Existing chatbot.js pattern already implements this; documented for checklist context |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Firebase Firestore SDK | 10.8.0 (CDN) | Checklist subcollection CRUD, real-time listeners | Already in use; `onSnapshot` for live updates |
| Firebase Cloud Functions | v4.0.0 (Node 18) | Webhook extension, AI check-in endpoint | Already deployed; `functions/index.js` |
| Vanilla JS (ES modules) | N/A | Checklist UI module | Project constraint -- no framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `showToast()` from auth.js | N/A | Auto-completion notifications | When webhook triggers checklist auto-complete |
| `escapeHtml()` from auth.js | N/A | Safe rendering of checklist item text | All user-facing text rendering |
| `formatDate()` from auth.js | N/A | Deadline display | Showing deadline dates on checklist items |
| `httpsCallable()` from firebase-config.js | N/A | AI check-in Cloud Function calls | When realtor opens AI check-in |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `boldSignWebhook` for auto-complete | Firestore `onUpdate` trigger on complianceDocs | Webhook extension is simpler (single code path), avoids deploying a new trigger function, and keeps auto-complete logic co-located with document processing |
| Inline AI panel on checklist tab | Reusing existing floating chatbot | Floating chatbot already has all UI infrastructure (messages, input, typing indicator, voice); context injection is cheaper than building a new panel from scratch |
| `linkedTemplateId` on checklist items | Name-based matching | Explicit ID link is deterministic and survives template name changes; name matching is fragile |
| Separate checklist template per property type | Conditional items with `propertyTypes` tag | Combined template with tags is simpler to maintain; property-specific items are a small subset |

## Architecture Patterns

### Recommended Project Structure
```
js/
  checklist.js             # New: checklist data, template, rendering, AI check-in
  chatbot.js               # Modified: add checklist context injection method
  client-detail.js         # Modified: add tab, import checklist module, wire events
  compliance.js            # Unchanged (reference for patterns)
  auth.js                  # Unchanged (utility imports)
app/
  client-detail.html       # Modified: add Closing Checklist tab button + content div
functions/
  index.js                 # Modified: extend boldSignWebhook, add/extend askAssistant
css/
  greendoor.css            # Modified: add checklist, progress, badge, panel styles
```

### Pattern 1: Checklist Data Model (Firestore Subcollection)
**What:** Each checklist item is a document in `clients/{clientId}/closingChecklist/{itemId}`
**When to use:** Always -- subcollection is the established pattern (mirrors `complianceDocs` subcollection)
**Schema:**
```javascript
// Document ID: deterministic for seeded items (e.g., "buyer_rep_agreement"),
//              auto-generated for custom items
{
  task: "Sign Buyer Representation Agreement",  // Display text
  category: "pre_contract",                      // "pre_contract" | "under_contract" | "closing"
  completed: false,                              // Manual or auto toggle
  autoCompleted: false,                          // true when webhook completes it
  autoCompletedAt: null,                         // Timestamp when auto-completed
  notApplicable: false,                          // N/A marking for seeded items
  notes: "",                                     // Realtor notes on this item
  sortOrder: 1,                                  // Display order within category
  transactionSide: "buyer",                      // "buyer" | "seller" | "both"
  propertyTypes: ["SFH", "Condo", "Multi-Family", "Land"],  // Which property types
  linkedTemplateId: "buyer_rep_agreement",        // Maps to documentTemplates ID (null for non-doc items)
  isCustom: false,                               // true for realtor-added items
  isSeeded: true,                                // true for template-generated items
  deadlineOffsetDays: -30,                       // Days relative to closing date (negative = before)
  deadline: null,                                // Computed: closingDate + offset (set on seed or closing date change)
  seededAt: Timestamp,                           // When this item was seeded
  completedAt: null,                             // When manually or auto completed
  completedBy: null                              // UID of person who completed (null for webhook)
}
```

### Pattern 2: Combined Template with Tags
**What:** Single array of checklist items tagged with `transactionSide` and `propertyTypes`
**When to use:** For seeding -- filter at seed time and at render time
**Example:**
```javascript
// In js/checklist.js
export const MO_CLOSING_CHECKLIST_TEMPLATE = [
  // Pre-Contract items
  {
    id: "buyer_rep_agreement",
    task: "Sign Buyer Representation Agreement",
    category: "pre_contract",
    transactionSide: "buyer",
    propertyTypes: ["SFH", "Condo", "Multi-Family", "Land"],
    linkedTemplateId: "buyer_rep_agreement",  // matches documentTemplates ID
    deadlineOffsetDays: null,  // pre-contract items: no deadline offset
    sortOrder: 1
  },
  {
    id: "listing_agreement",
    task: "Sign Listing Agreement",
    category: "pre_contract",
    transactionSide: "seller",
    propertyTypes: ["SFH", "Condo", "Multi-Family", "Land"],
    linkedTemplateId: "listing_agreement",
    deadlineOffsetDays: null,
    sortOrder: 2
  },
  // ... more items
];
```

### Pattern 3: Real-time Listener for Checklist
**What:** `onSnapshot` on the closingChecklist subcollection for live updates when webhook fires
**When to use:** On checklist tab load (mirrors complianceDocs listener pattern)
**Example:**
```javascript
// Mirrors the complianceDocs onSnapshot pattern in client-detail.js line 2902
let checklistUnsubscribe = null;

function subscribeChecklist(clientId) {
  if (checklistUnsubscribe) checklistUnsubscribe();
  checklistUnsubscribe = onSnapshot(
    collection(db, "clients", clientId, "closingChecklist"),
    (snap) => {
      checklistItems = [];
      snap.forEach(d => { checklistItems.push({ id: d.id, ...d.data() }); });
      renderChecklist();
    }
  );
}
```

### Pattern 4: AI Context Injection via Existing Chatbot
**What:** When realtor clicks "Check in with AI" on checklist tab, open the floating chatbot panel with pre-injected checklist context
**When to use:** For AICX-01 through AICX-06
**Example:**
```javascript
// In checklist.js -- trigger AI check-in
function openChecklistAI() {
  // Build context payload
  const context = buildChecklistContext();

  // Open the existing chatbot panel
  window.toggleAiPanel();

  // Auto-send the check-in request with context
  // The askAssistant Cloud Function receives context type "checklist_checkin"
  // and uses it to build a system prompt with full transaction state
}
```

### Pattern 5: Webhook Extension for Auto-Complete
**What:** After updating complianceDocs status to "signed", also query closingChecklist for matching `linkedTemplateId`
**When to use:** Inside the existing `boldSignWebhook` function, after the complianceDocs update
**Example:**
```javascript
// In functions/index.js, inside boldSignWebhook after complianceDocs update
// Query checklist items linked to this template
const checklistQuery = await db.collection(`clients/${clientId}/closingChecklist`)
  .where("linkedTemplateId", "==", templateId)
  .where("completed", "==", false)
  .get();

if (!checklistQuery.empty) {
  const batch = db.batch();
  checklistQuery.docs.forEach(doc => {
    batch.update(doc.ref, {
      completed: true,
      autoCompleted: true,
      autoCompletedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp()
    });
  });
  await batch.commit();
}
```

### Anti-Patterns to Avoid
- **AI-generated checklist items:** Never let the AI create the seed template. Use hard-coded, human-verified items only. The AI's role is summarization and guidance, not template creation (Pitfall 8 from pitfalls research).
- **Array storage on client document:** Do not store checklist items as an array field on the client document. Use a subcollection to avoid document size limits and enable granular real-time listeners.
- **Name-based doc matching:** Do not match compliance docs to checklist items by template name string. Use explicit `linkedTemplateId` field for deterministic, rename-safe mapping.
- **Separate Firestore trigger for auto-complete:** Adding a new `onUpdate` trigger on complianceDocs adds deployment complexity and latency. Extending the webhook is simpler and keeps the auto-complete logic in a single code path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chat UI (messages, input, typing indicator) | Custom inline chat panel | Existing `chatbot.js` floating panel | Already has message rendering, typing indicator, voice input, mobile keyboard fix |
| Toast notifications | Custom notification system | `showToast()` from `auth.js` | Established pattern; consistent look |
| Badge rendering | Custom badge HTML | `.gd-badge` CSS class system | 15+ badge variants already styled in greendoor.css |
| Progress bar | Custom progress component | `.gd-progress-bar` + `.gd-progress-fill` CSS | Already exists with green fill, percentage-based width |
| Date formatting | Custom date rendering | `formatDate()` from `auth.js` | Handles Firestore Timestamps and Date objects |
| HTML escaping | Manual string sanitization | `escapeHtml()` from `auth.js` | Prevents XSS on user-entered checklist text |
| Tab navigation | Custom tab system | `data-tab` + `gd-tab-content` pattern | Established in client-detail.html line 71-78 |

**Key insight:** The existing codebase has mature UI patterns for tabs, badges, progress bars, toasts, and chat. Every checklist UI element should reuse these patterns, not invent new ones. The only genuinely new UI is the checklist item row component.

## Common Pitfalls

### Pitfall 1: AI Hallucination in Checklist Seeds
**What goes wrong:** If AI generates checklist items, it invents non-existent MO forms or requirements
**Why it happens:** LLMs generate plausible-sounding items without grounding in verified sources
**How to avoid:** Hard-code the template in `checklist.js` as a JS constant. AI only summarizes existing checklist state -- it never creates items.
**Warning signs:** Any prompt that says "generate checklist items" instead of "summarize this checklist"

### Pitfall 2: AI Context Window Overflow
**What goes wrong:** Passing full client record + all checklist items + activity history exceeds token limit
**Why it happens:** Near-close transactions have 20+ activities and 15-25 checklist items
**How to avoid:** Pass only: (1) client name + transaction type + closing date, (2) checklist items with completion status (not full notes), (3) last 5-7 activities, (4) recent conversation history (last 6 messages). Estimate ~2000 tokens for checklist context.
**Warning signs:** AI response references incorrect or outdated information; API errors on large contexts

### Pitfall 3: Race Condition on Transaction Type Change Re-seeding
**What goes wrong:** Changing transaction type triggers re-seed that overwrites in-progress items
**Why it happens:** Naive re-seed deletes all items and creates new ones
**How to avoid:** Use deterministic document IDs for seeded items. On re-seed: add new items that don't exist yet, leave existing items untouched (preserve completion state). Never delete seeded items -- realtor marks them N/A.
**Warning signs:** Completed items disappear when transaction type changes

### Pitfall 4: Auto-complete Fires on Wrong Checklist Item
**What goes wrong:** Webhook marks wrong checklist item as complete because template name matching is fuzzy
**Why it happens:** Using string name matching instead of explicit `linkedTemplateId`
**How to avoid:** Use `linkedTemplateId` field on checklist items that maps to `documentTemplates` collection IDs. Query by exact ID match.
**Warning signs:** "Purchase Agreement" checklist item completes when "HOA Addendum" is signed

### Pitfall 5: Closing Date Change Doesn't Recalculate Deadlines
**What goes wrong:** Realtor updates closing date but checklist item deadlines still show old dates
**Why it happens:** Deadlines are computed once at seed time and never updated
**How to avoid:** When closing date changes on client record, recalculate all `deadline` fields on checklist items that have `deadlineOffsetDays`. Use a batch update.
**Warning signs:** Deadlines show dates that don't align with the current closing date

### Pitfall 6: Chatbot Panel Opens Without Checklist Context
**What goes wrong:** Realtor clicks "Check in with AI" but the chatbot sends a generic question without checklist state
**Why it happens:** Context injection not wired correctly; chatbot uses default `client_detail` context
**How to avoid:** When check-in is triggered from checklist tab, pass a structured `checklistData` payload alongside the question. The Cloud Function must detect and use this context.
**Warning signs:** AI response says "I don't have information about your checklist"

## Code Examples

### Checklist Item Row HTML (Rendering Pattern)
```html
<!-- Follows .gd-compliance-row pattern from compliance tab -->
<div class="gd-checklist-item" data-item-id="agency_disclosure">
  <input type="checkbox" class="gd-checklist-check"
    data-item-id="agency_disclosure"
    checked
    onchange="toggleChecklistItem('agency_disclosure', this.checked)">
  <div class="gd-checklist-item-content">
    <span class="gd-checklist-task">Sign Agency Disclosure</span>
    <span class="gd-badge gd-badge-auto-completed">Auto-completed</span>
    <span class="gd-checklist-deadline">Due: Mar 15, 2026</span>
  </div>
  <button class="gd-checklist-notes-btn" onclick="toggleChecklistNotes('agency_disclosure')"
    title="Notes">&#128221;</button>
</div>
```

### Category Progress Bar
```javascript
function renderCategoryProgress(category, items) {
  const total = items.filter(i => !i.notApplicable).length;
  const done = items.filter(i => i.completed && !i.notApplicable).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `
    <div class="gd-checklist-category-header">
      <span>${escapeHtml(categoryLabel(category))}</span>
      <span class="gd-checklist-progress-text">${done}/${total}</span>
    </div>
    <div class="gd-checklist-progress">
      <div class="gd-checklist-progress-fill" style="width: ${pct}%"></div>
    </div>
  `;
}
```

### Seeding Logic
```javascript
async function seedChecklist(clientId, transactionType) {
  const [propType, side] = parseTransactionType(transactionType);
  // e.g., "SFH - Buyer" -> propType="SFH", side="buyer"

  const applicable = MO_CLOSING_CHECKLIST_TEMPLATE.filter(item =>
    (item.transactionSide === side || item.transactionSide === "both") &&
    item.propertyTypes.includes(propType)
  );

  const batch = writeBatch(db);
  const closingDate = clientData.closingDate ? clientData.closingDate.toDate() : null;

  for (const item of applicable) {
    const ref = doc(db, "clients", clientId, "closingChecklist", item.id);
    // setDoc with merge:true preserves existing completion state on re-seed
    batch.set(ref, {
      task: item.task,
      category: item.category,
      completed: false,
      autoCompleted: false,
      autoCompletedAt: null,
      notApplicable: false,
      notes: "",
      sortOrder: item.sortOrder,
      transactionSide: item.transactionSide,
      propertyTypes: item.propertyTypes,
      linkedTemplateId: item.linkedTemplateId || null,
      isCustom: false,
      isSeeded: true,
      deadlineOffsetDays: item.deadlineOffsetDays,
      deadline: closingDate && item.deadlineOffsetDays
        ? new Date(closingDate.getTime() + item.deadlineOffsetDays * 86400000)
        : null,
      seededAt: serverTimestamp()
    }, { merge: true });  // merge:true is critical for re-seeding
  }

  await batch.commit();
}
```

### AI Check-in Context Builder
```javascript
function buildChecklistContext() {
  const items = checklistItems
    .filter(i => !i.notApplicable)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const done = items.filter(i => i.completed);
  const outstanding = items.filter(i => !i.completed);
  const overdue = outstanding.filter(i => i.deadline && i.deadline.toDate() < new Date());

  return {
    clientName: clientData.fullName,
    transactionType: clientData.transactionType,
    closingDate: clientData.closingDate
      ? formatDate(clientData.closingDate)
      : "Not set",
    listingAddress: clientData.listingAddress || "Not linked",
    progress: {
      total: items.length,
      completed: done.length,
      percentage: Math.round((done.length / items.length) * 100)
    },
    completedItems: done.map(i => i.task),
    outstandingItems: outstanding.map(i => ({
      task: i.task,
      category: i.category,
      deadline: i.deadline ? formatDate(i.deadline) : null,
      overdue: i.deadline && i.deadline.toDate() < new Date()
    })),
    overdueCount: overdue.length,
    todayDate: new Date().toLocaleDateString("en-US")
  };
}
```

## Missouri Closing Checklist Template Content

**Confidence:** MEDIUM -- based on Missouri real estate practice research. Items align with the 7 compliance doc templates already in the system (compliance.js MO_FORM_STUBS) plus standard residential transaction milestones. User review required before shipping per locked decision.

**Discretion decision: Include both doc items AND non-doc milestone items.** Rationale: A closing checklist that only tracks document signatures misses critical milestones (inspection, appraisal, financing) that realtors actively manage. Non-doc items represent the majority of the realtor's workflow. Including them makes the checklist a complete transaction management tool rather than a document tracking duplicate.

**Discretion decision: Conditional items via `propertyTypes` tag, not separate templates.** Rationale: Only 2-3 items differ by property type (HOA items for condos, land survey for land). A single template with property type tags is simpler to maintain.

### Pre-Contract Category
| ID | Task | Side | Property Types | Linked Template | Deadline Offset |
|----|------|------|---------------|-----------------|-----------------|
| agency_disclosure | Sign Agency Disclosure | both | All | agency_disclosure | null |
| buyer_rep_agreement | Sign Buyer Representation Agreement | buyer | All | buyer_rep_agreement | null |
| listing_agreement | Sign Listing Agreement | seller | All | listing_agreement | null |
| pre_approval | Obtain Mortgage Pre-Approval Letter | buyer | All | null | null |
| property_search | Complete Property Search | buyer | All | null | null |
| listing_prep | Prepare Property for Listing (staging, photos) | seller | SFH, Condo, Multi-Family | null | null |
| purchase_offer | Submit/Accept Purchase Offer | both | All | null | null |

### Under Contract Category
| ID | Task | Side | Property Types | Linked Template | Deadline Offset |
|----|------|------|---------------|-----------------|-----------------|
| earnest_money | Deposit Earnest Money | buyer | All | null | -35 days |
| purchase_agreement | Sign Purchase Agreement | buyer | All | purchase_agreement | -35 days |
| sellers_disclosure | Review/Sign Seller's Disclosure | seller | SFH, Condo, Multi-Family | sellers_disclosure | -30 days |
| lead_paint_disclosure | Sign Lead Paint Disclosure | both | SFH, Condo | lead_paint_disclosure | -30 days |
| hoa_addendum | Sign HOA Addendum | both | Condo | hoa_addendum | -28 days |
| home_inspection | Schedule and Complete Home Inspection | buyer | SFH, Condo, Multi-Family | null | -28 days |
| inspection_response | Negotiate Inspection Response/Repairs | both | SFH, Condo, Multi-Family | null | -21 days |
| appraisal | Complete Property Appraisal | buyer | All | null | -21 days |
| land_survey | Order Land Survey | buyer | Land | null | -21 days |
| title_search | Order Title Search and Title Insurance | buyer | All | null | -21 days |
| homeowners_insurance | Obtain Homeowners Insurance | buyer | SFH, Condo, Multi-Family | null | -14 days |
| financing_approval | Obtain Final Financing Approval | buyer | All | null | -10 days |
| notice_intended_sale | File Notice of Intended Sale (MO 45-day req.) | seller | All | null | -45 days |
| repair_completion | Confirm Repair Completion (if negotiated) | both | SFH, Condo, Multi-Family | null | -7 days |

### Closing Category
| ID | Task | Side | Property Types | Linked Template | Deadline Offset |
|----|------|------|---------------|-----------------|-----------------|
| final_walkthrough | Complete Final Walk-Through | buyer | SFH, Condo, Multi-Family | null | -1 day |
| closing_disclosure | Review Closing Disclosure (3-day rule) | buyer | All | null | -3 days |
| utility_transfer | Transfer Utilities | both | SFH, Condo, Multi-Family | null | 0 days |
| closing_funds | Wire Closing Funds | buyer | All | null | 0 days |
| closing_signing | Attend Closing and Sign Documents | both | All | null | 0 days |
| deed_recording | Confirm Deed Recording | both | All | null | +1 day |
| key_exchange | Key Exchange / Possession Transfer | both | SFH, Condo, Multi-Family | null | 0 days |

**Note on deadline offsets:** Negative values mean "X days before closing date." Zero means closing day. Positive means after. Items with `null` offset are pre-contract milestones that don't have a deadline relative to closing. The 45-day Notice of Intended Sale requirement is a Missouri-specific legal requirement.

## Discretion Decisions (Recommendations)

### AI Panel Type: Reuse Floating Chatbot
**Recommendation:** Extend the existing `chatbot.js` floating panel rather than building an inline panel.
**Rationale:** The floating chatbot already has: message list, input field, typing indicator, voice input, mobile keyboard fix, session history, message formatting. Building an inline panel duplicates all of this. Instead, add a "Check in with AI" button that opens the floating panel and auto-sends a checklist check-in prompt with context. The `askAssistant` Cloud Function already accepts a `context` parameter -- add `"checklist_checkin"` as a new context type.

### Notes UX: Inline Expandable
**Recommendation:** Use an inline expandable row (click to reveal notes textarea below the item).
**Rationale:** A popover requires click-away handling, positioning logic, and z-index management. An inline expandable is simpler: click the notes icon, a `<textarea>` slides down below the checklist item row. This follows the pattern of expandable sections already in the codebase (e.g., activity details).

### Doc-to-Item Mapping: Explicit `linkedTemplateId`
**Recommendation:** Use `linkedTemplateId` field on checklist items that maps to `documentTemplates` collection IDs.
**Rationale:** Deterministic ID matching is rename-safe and exact. Name-based matching would break if template names change (e.g., "Agency Disclosure" vs "Agency Relationship Disclosure"). The `documentTemplates` collection already has stable IDs used for complianceDocs.

### Auto-Completion Trigger: Extend `boldSignWebhook`
**Recommendation:** Add checklist auto-completion logic directly inside the existing `boldSignWebhook` function, after the complianceDocs status update.
**Rationale:** (1) Single code path -- the webhook already has `clientId` and `templateId` in scope. (2) No additional Cloud Function deployment. (3) Auto-completion happens synchronously with the signed document processing, so the `onSnapshot` listener fires once with both updates. A separate Firestore trigger would add latency and a second deployment artifact.

### Closing Date Input UX
**Recommendation:** Add an "Expected Closing Date" date input field in the Overview tab's "Status & Source" section, next to the transaction type selector.
**Rationale:** The closing date is a property of the client/transaction, not a property of the checklist. Placing it on the Overview tab makes it visible regardless of which tab is active. When the closing date is set or changed, trigger a batch update of all checklist item deadlines.

### Auto-Calculated Deadline Offsets
**Recommendation:** Use the offset values in the template table above. These follow standard Missouri residential transaction timelines: inspection contingency at ~28 days before close, financing at ~10 days, final walk-through at 1 day before, etc. The 45-day Notice of Intended Sale is a Missouri legal requirement.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Array field on client doc for checklist | Subcollection `closingChecklist` per client | Best practice | Enables granular listeners, avoids doc size limits |
| AI generates checklist from scratch | Human-verified template + AI for summarization only | Phase 4 design decision | Eliminates hallucination risk |
| Name-based doc matching | Explicit `linkedTemplateId` field | Phase 4 design decision | Rename-safe, deterministic matching |
| Separate AI chat panel | Context injection into existing chatbot | Phase 4 design decision | Reuses proven UI infrastructure |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual testing (no automated test framework in project) |
| Config file | none -- vanilla JS project with no test runner |
| Quick run command | N/A (manual browser testing) |
| Full suite command | N/A (manual browser testing) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHKL-01 | closingChecklist subcollection exists with correct fields | manual | Firestore console inspection | N/A |
| CHKL-02 | Setting transaction type seeds checklist items | manual | Set transaction type in browser, verify items appear | N/A |
| CHKL-03 | Items grouped by Pre-Contract / Under Contract / Closing | manual | Visual inspection of checklist tab | N/A |
| CHKL-04 | Progress bars update on completion | manual | Toggle items, verify bar percentages | N/A |
| CHKL-05 | Manual toggle complete/incomplete works | manual | Click checkboxes, verify Firestore updates | N/A |
| CHKL-06 | Webhook auto-completes matching items | manual | Simulate webhook event via curl, verify checklist update | N/A |
| CHKL-07 | Auto-completed badge displays | manual | After webhook, verify "Auto-completed" badge visible | N/A |
| AICX-01 | Check-in button opens AI panel | manual | Click button, verify panel opens | N/A |
| AICX-02 | AI receives transaction context | manual | Open check-in, verify response references actual data | N/A |
| AICX-03 | AI summarizes done/outstanding/overdue | manual | Open check-in with mixed completion states | N/A |
| AICX-04 | AI suggests 2-3 next actions | manual | Verify response includes actionable suggestions | N/A |
| AICX-05 | Follow-up questions work | manual | Ask follow-up after initial summary | N/A |
| AICX-06 | Session-only chat history | manual | Verify follow-ups reference prior messages; close and reopen to verify reset | N/A |

### Sampling Rate
- **Per task commit:** Manual browser verification of affected feature
- **Per wave merge:** Full manual walkthrough of all checklist features
- **Phase gate:** Complete manual test of all 13 requirements before `/gsd:verify-work`

### Wave 0 Gaps
- No automated test infrastructure exists in this project (vanilla JS, no test runner)
- Manual testing protocol is the established verification method (see Phase 1-3 verification patterns)
- No Wave 0 test setup needed -- project does not use automated tests

## Open Questions

1. **askAssistant Cloud Function source code**
   - What we know: The function is deployed and callable. It accepts `{ question, context, clientId, history }`. The client-side code in chatbot.js, dashboard.js, and clients.js all call it successfully.
   - What's unclear: The function's source code is not in `functions/index.js` -- it may be deployed from a different source or was added before the current codebase snapshot. We need to see the implementation to know how to add checklist context support.
   - Recommendation: Before planning the AI check-in plan (04-03), inspect the deployed function code via `firebase functions:get askAssistant` or check the Firebase Console. If the source is unavailable, the plan should include creating/recreating the function with checklist context support.

2. **Template content user review**
   - What we know: User decision says "Claude researches standard MO transaction checklist; user reviews before it ships"
   - What's unclear: The exact review process -- should the template be presented as a document for approval, or should it be committed and reviewed in PR?
   - Recommendation: Include the template in the first plan's code so the user can review it as part of the plan verification step.

3. **Existing closingDate field on client records**
   - What we know: The FEATURES.md research mentions `clients/{clientId}.closingDate` as a field to add
   - What's unclear: Whether any client records already have this field
   - Recommendation: The seeding logic should handle `closingDate` being absent (deadlines = null) and recalculate when it's set later.

## Sources

### Primary (HIGH confidence)
- `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/functions/index.js` -- boldSignWebhook implementation, complianceDocs write pattern, HMAC verification
- `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/chatbot.js` -- askAssistant call pattern, session history, floating panel HTML injection
- `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/compliance.js` -- MO_FORM_STUBS (7 templates), template structure, transaction type arrays
- `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/client-detail.js` -- tab navigation, complianceDocs onSnapshot, transaction type change handler
- `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/app/client-detail.html` -- tab HTML structure, compliance tab layout
- `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/css/greendoor.css` -- badge classes, progress bar classes, compliance row styles
- `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/.planning/phases/04-ai-closing-checklist/04-CONTEXT.md` -- locked decisions and discretion areas

### Secondary (MEDIUM confidence)
- Missouri real estate closing timeline research -- standard residential transaction milestones, inspection/appraisal/financing timelines
- Missouri 45-day Notice of Intended Sale requirement -- verified via multiple web sources
- Standard real estate closing checklist patterns -- Pre-Contract / Under Contract / Closing categorization

### Tertiary (LOW confidence)
- Specific deadline offset values (e.g., inspection at -28 days, financing at -10 days) -- based on general MO residential practice; actual timelines vary by contract terms. These are reasonable defaults that the realtor can adjust via closing date changes.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries and patterns already exist in the codebase
- Architecture (data model, UI, webhook): HIGH -- follows established patterns from Phase 2-3
- Architecture (AI check-in): MEDIUM -- askAssistant source code not inspected; pattern is clear from client-side usage
- MO template content: MEDIUM -- based on real estate practice research; user review required
- Deadline offsets: LOW -- reasonable defaults based on general practice; contract-specific in reality

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- patterns are project-internal, not external library dependent)
