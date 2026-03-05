# Phase 5: ShowingTime Sync - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Realtors can connect their ShowingTime iCal feed URL in Settings and see imported showings in the GreenDoor calendar with a read-only "ST" badge, kept current via a 30-minute scheduled Cloud Function sync. This phase adds: feed URL configuration in Settings, a callable sync Cloud Function, a scheduled sync Cloud Function, and calendar display of imported showings.

</domain>

<decisions>
## Implementation Decisions

### ST badge & calendar display
- Same green color (#22c55e) as regular GreenDoor showings, plus a small "ST" badge/tag on the event dot
- Add a 4th legend item to the calendar legend: green dot with "ST" label alongside existing Showings/Follow-ups/Events
- Click on ST showing opens a read-only popover (title, time, location, "ShowingTime" source label) — no Edit/Delete buttons
- ST showings are NOT draggable — source of truth is ShowingTime; local moves would revert on next sync

### Settings integration section
- New "Integrations" card (generic title, future-proofs for other integrations) placed between Email Sending and Help & Support
- **Disconnected state:** Step-by-step setup guide showing how to find the iCal URL in ShowingTime, plus the feed URL text input with placeholder and Save button
- **Connected state:** Green status dot + "Connected", saved feed URL (truncated), last synced timestamp, "Sync Now" and "Disconnect" buttons — matches BoldSign/Email sender card pattern

### Cancelled showing handling
- Cancelled showings are removed from the calendar entirely (Firestore doc deleted on next sync)
- Showings missing from the feed are also deleted — feed is the single source of truth
- No historical retention of past ST showings that drop off the feed

### Error & sync feedback
- "Sync Now" button shows spinner/loading state while running; toast on complete ("Synced 12 showings") or failure
- Invalid/expired feed URLs show red error banner in the Integrations card with 2-3 troubleshooting tips (check URL format, verify feed is active, re-copy URL)
- Background scheduled syncs are silent — no push notifications on failure; last sync time + error status visible on Settings page only

### Claude's Discretion
- ST badge visual design (pill, superscript, icon approach)
- Exact step-by-step instructions content for ShowingTime setup guide
- Data model details (subcollection vs top-level collection, field names)
- node-ical parsing implementation and VEVENT field mapping
- Rate limiting implementation for 15-minute per-user throttle
- Scheduled function architecture (pub/sub trigger, batch processing)

</decisions>

<specifics>
## Specific Ideas

- Connected state should match existing Settings card patterns (BoldSign "Connected" dot, Email sender status row)
- Step-by-step setup guide is important because realtors may not know where to find their iCal URL in ShowingTime
- Troubleshooting tips on error should be actionable, not generic ("Check URL starts with webcal:// or https://", "Verify feed is still active in ShowingTime", "Try re-copying the URL")

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `calendar.js`: `allCalEvents[]` array merges showings/followUps/events — ST showings will be added to this array with `type: "showingtime"` or similar
- `calendar.js`: `showPopover()` function already renders read-only popovers for showings — extend or reuse for ST showings
- `settings.js`: Pattern for card sections with status dots, action buttons, `httpsCallable()` for Cloud Functions
- `showToast()` from `auth.js`: For sync success/failure feedback
- `escapeHtml()` from `auth.js`: For rendering feed URL and showing titles safely

### Established Patterns
- Calendar event types: `{id, type, title, start, end, clientId, color, data}` — ST showings follow this shape
- Cloud Functions: `httpsCallable(functions, "functionName")` for sync trigger
- Status dot pattern: `.gd-settings-status-dot.gd-connected` — reuse for ShowingTime connected state
- Firestore queries: `where("realtorId", "==", uid)` on top-level collections — existing showings use this pattern
- Calendar legend: `.gd-calendar-legend-item` with `.gd-calendar-legend-dot` — add ST entry

### Integration Points
- `settings.html`: Add Integrations card between Email Sending and Help & Support
- `settings.js`: Add feed URL save/load, sync trigger, disconnect, error display
- `calendar.js` `loadCalendarData()`: Add query for ST showings, merge into `allCalEvents`
- `calendar.html`: Add ST legend item
- `functions/index.js`: Add `syncShowingTime` callable + `scheduledShowingTimeSync` scheduled function
- Firestore: `users/{uid}.showingTimeFeedUrl` for feed config, showing docs for imported events

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-showingtime-sync*
*Context gathered: 2026-03-05*
