---
phase: 05-showingtime-sync
verified: 2026-03-05T16:00:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 5: ShowingTime Sync Verification Report

**Phase Goal:** Realtors can connect their ShowingTime iCal feed and see imported showings in the GreenDoor calendar with a read-only "ST" badge, kept current via a 30-minute scheduled sync
**Verified:** 2026-03-05T16:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                 | Status     | Evidence                                                                                              |
|----|---------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------|
| 1  | Realtor can paste a ShowingTime iCal feed URL in Settings and save it                 | VERIFIED   | `saveShowingTimeFeed()` in settings.js L416–442; writes `showingTimeFeedUrl` via setDoc merge         |
| 2  | Clicking Sync Now imports showings from the feed into Firestore                       | VERIFIED   | `syncShowingTimeNow()` in settings.js L444–473 calls `httpsCallable(functions, "syncShowingTime")`   |
| 3  | Cancelled or removed events are deleted from Firestore on next sync                   | VERIFIED   | `syncFeedForUser` in functions/index.js L880–887 deletes docs not present in feed                     |
| 4  | A scheduled Cloud Function syncs all users with feed URLs every 30 minutes            | VERIFIED   | `scheduledShowingTimeSync` exported, schedule: "every 30 minutes", region us-central1, L966–998       |
| 5  | Syncing more than once within 15 minutes is throttled server-side                     | VERIFIED   | Rate-limit check in both `syncShowingTime` (L940–949) and `scheduledShowingTimeSync` (L981–984)       |
| 6  | Invalid or expired feed URLs show a clear error message in Settings                   | VERIFIED   | Error banner rendered by `renderShowingTimeIntegration` when `showingTimeSyncError` exists (L378–390) |
| 7  | Last successful sync time is displayed in Settings                                    | VERIFIED   | `formatDateTime(profile.showingTimeLastSyncedAt)` rendered in connected state (L370–372)              |
| 8  | ShowingTime showings appear in the GreenDoor calendar with a distinct ST badge        | VERIFIED   | `isShowingTime` detection in calendar.js L57–61; CSS ::after badges in greendoor.css L4057–4073       |
| 9  | ST showings are read-only — no Edit, Delete, or View Client buttons in popover        | VERIFIED   | `if (ev.type !== "showingtime")` gates actions in showPopover (calendar.js L327–335)                  |
| 10 | ST showings cannot be dragged to a different day or time                              | VERIFIED   | `isDraggable` flag in renderMonth (L170); draggable skipped in renderWeek (L249–252); moveEvent guard (L499) |
| 11 | Calendar legend includes a 4th ST entry alongside Showings, Follow-ups, and Events    | VERIFIED   | `gd-legend-showingtime` div in app/calendar.html L67; CSS styling in greendoor.css L3950–3966        |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact                    | Expected                                                                      | Status     | Details                                                                                             |
|-----------------------------|-------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------------|
| `functions/index.js`        | syncShowingTime callable + scheduledShowingTimeSync scheduled + syncFeedForUser helper | VERIFIED | All three present; `node functions/index.js` import check returns `function` for both exports       |
| `functions/package.json`    | node-ical dependency                                                          | VERIFIED   | `"node-ical": "^0.22.0"` present in dependencies                                                   |
| `app/settings.html`         | Integrations card with showingtime-integration div                            | VERIFIED   | Card between Email Sending and Help & Support (L125–131); contains `id="showingtime-integration"`  |
| `js/settings.js`            | renderShowingTimeIntegration, saveShowingTimeFeed, syncShowingTimeNow, disconnectShowingTime | VERIFIED | All four functions present (L338, L416, L444, L475); formatDateTime imported on L10               |
| `js/calendar.js`            | ST type detection, read-only popover, drag prevention                         | VERIFIED   | `source === "showingtime"` check L57; drag guards L170, L249–252, L499; popover gating L327        |
| `app/calendar.html`         | ST legend item with gd-legend-showingtime class                               | VERIFIED   | Legend item found at L67                                                                            |
| `css/greendoor.css`         | ST badge CSS for legend dot, month event dot, and week event block            | VERIFIED   | Three rule blocks found at L3950–3966, L4057–4073, L4181–4197; all use ::after pseudo-element     |

---

### Key Link Verification

| From                                | To                                  | Via                                               | Status   | Details                                                                                      |
|-------------------------------------|-------------------------------------|---------------------------------------------------|----------|----------------------------------------------------------------------------------------------|
| `js/settings.js`                    | `functions/index.js` syncShowingTime | `httpsCallable(functions, 'syncShowingTime')`     | WIRED    | Found at settings.js L452; exact pattern `httpsCallable(functions, "syncShowingTime")`       |
| `js/settings.js`                    | `users/{uid}.showingTimeFeedUrl`    | `setDoc` with `merge: true` on save               | WIRED    | Found at settings.js L434; `showingTimeFeedUrl` written via setDoc merge                     |
| `functions/index.js syncFeedForUser` | `showings` collection              | `batch.set` with deterministic IDs `st_{realtorId}_{sanitizedUid}` | WIRED | `st_${realtorId}_${sanitizedUid}` pattern confirmed at L856; batch.set at L896         |
| `functions/index.js scheduledShowingTimeSync` | `syncFeedForUser`         | Iterates users with feed URLs, calls shared helper | WIRED   | `syncFeedForUser(userDoc.id, userData.showingTimeFeedUrl)` at L987                           |
| `js/calendar.js showingsSnap.forEach` | `allCalEvents` array             | Checks `s.source === 'showingtime'` to set type   | WIRED    | `isShowingTime = s.source === "showingtime"` at L57; type assigned at L61                   |
| `js/calendar.js showPopover`        | `pop-actions` element              | Skips Edit/Delete/ViewClient when `ev.type === "showingtime"` | WIRED | `if (ev.type !== "showingtime")` gates entire actions block at L327                    |
| `js/calendar.js renderMonth`        | CSS `.gd-cal-event-dot.showingtime` | `ev.type` class on dot element                    | WIRED    | `class="gd-cal-event-dot ${ev.type}"` at L171; CSS selector at greendoor.css L4057           |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                       | Status    | Evidence                                                                                     |
|-------------|-------------|-----------------------------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|
| SHWT-01     | 05-01       | Settings page has "Integrations" section with ShowingTime iCal feed URL input     | SATISFIED | Integrations card in app/settings.html L125–131; input rendered by renderShowingTimeIntegration |
| SHWT-02     | 05-01       | Feed URL saves to users/{uid}.showingTimeFeedUrl                                  | SATISFIED | setDoc writes `{ showingTimeFeedUrl: url }` to `users/{uid}` at settings.js L434            |
| SHWT-03     | 05-01       | "Sync Now" button triggers callable Cloud Function to fetch and parse the iCal feed | SATISFIED | httpsCallable syncShowingTime triggered at settings.js L452                                  |
| SHWT-04     | 05-01       | Cloud Function converts webcal:// to https://, fetches feed, parses with node-ical | SATISFIED | URL normalize at functions/index.js L820; `ical.async.fromURL` at L825                      |
| SHWT-05     | 05-01       | Each VEVENT upserted to showings collection with title, times, location, source: "showingtime" | SATISFIED (note) | Upserted to top-level `showings` collection (not subcollection); all fields present at L862–876; calendar reads same collection |
| SHWT-06     | 05-01       | Cancelled events in feed are removed from Firestore (or marked cancelled)         | SATISFIED | `status === "CANCELLED"` VEVENTs excluded from feedEvents (L838); orphaned docs batch-deleted (L883–887) |
| SHWT-07     | 05-01       | Scheduled Cloud Function syncs all users with feed URLs every 30 minutes          | SATISFIED | `scheduledShowingTimeSync` with `schedule: "every 30 minutes"` at functions/index.js L966–967 |
| SHWT-08     | 05-01       | Rate limited to max once per 15 minutes per user                                  | SATISFIED | 15-minute elapsed check in both callable (L940–949) and scheduler (L981–984)                 |
| SHWT-09     | 05-02       | ShowingTime showings display in calendar with distinct "ST" badge, read-only      | SATISFIED | ST badge via CSS ::after; read-only via drag prevention + popover action gating               |
| SHWT-10     | 05-01       | Invalid or expired feed URLs show clear error in Settings with instructions       | SATISFIED | Error banner with 3 troubleshooting tips rendered at settings.js L379–390                    |
| SHWT-11     | 05-01       | Last synced timestamp displayed in Settings                                       | SATISFIED | `formatDateTime(profile.showingTimeLastSyncedAt)` at settings.js L371                        |

**Note on SHWT-05:** The requirement text specifies `users/{uid}/showings/{icalUid}` (subcollection) but implementation uses the top-level `showings` collection with doc ID `st_{realtorId}_{sanitizedUid}`. This is a deliberate design decision documented in Plan 01 — the existing calendar query already targets the top-level `showings` collection, so using the subcollection would have required a separate query and composite index. The functional requirement (VEVENT data persisted with `source: "showingtime"`, queryable by realtorId) is fully satisfied.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODOs, FIXMEs, placeholders, empty implementations, or stub returns found in any of the six modified files. All HTML `placeholder` attributes are legitimate input placeholder text, not stub indicators.

---

### Human Verification Required

The following items require a running browser session to verify:

#### 1. Disconnected State UI Rendering

**Test:** Open Settings page as a user without a showingTimeFeedUrl configured.
**Expected:** Integrations card shows 5-step setup guide and feed URL input field.
**Why human:** Dynamic innerHTML injection cannot be verified by static file analysis.

#### 2. Connected State Visual Appearance

**Test:** Save a feed URL, then check the Settings Integrations card.
**Expected:** Green status dot, truncated URL (first 50 chars), "Last synced: Never synced", Sync Now + Disconnect buttons.
**Why human:** Requires live Firestore read and DOM rendering to confirm correct state transition.

#### 3. Sync Now Spinner and Toast Feedback

**Test:** Click "Sync Now" with a valid feed URL.
**Expected:** Button shows spinner, toast appears with "Synced N showings" on success or rate-limit message if within 15 minutes.
**Why human:** Requires live Cloud Function invocation and Firebase connectivity.

#### 4. ST Badge Visual Appearance in Calendar

**Test:** After sync, open the Calendar page and navigate to a month containing imported showings.
**Expected:** ST showings appear as green event dots with white "ST" pill badge at top-right; 4-item legend visible.
**Why human:** CSS ::after pseudo-elements cannot be visually verified by static analysis.

#### 5. Read-Only Behavior in Calendar Popover

**Test:** Click an ST-badged event in either month or week view.
**Expected:** Popover shows title, date/time, location, "Source: ShowingTime" label. No Edit, Delete, or View Client buttons.
**Why human:** Requires live Firestore data and rendered calendar to confirm popover content.

#### 6. Drag Prevention for ST Events

**Test:** Attempt to drag an ST-badged event to a different day in month or week view.
**Expected:** Event cannot be dragged; no movement occurs.
**Why human:** Requires browser interaction to test drag-and-drop behavior.

#### 7. Disconnect Clears ST Showings from Calendar

**Test:** Click Disconnect and confirm. Navigate to Calendar.
**Expected:** All ST showings disappear from calendar; Integrations card returns to disconnected state.
**Why human:** Requires live Firestore delete operations and calendar re-render.

---

### Gaps Summary

None. All 11 observable truths verified, all 7 artifacts confirmed substantive and wired, all 11 SHWT requirements satisfied. Four commits exist and verified (a629a08, 2e7740b, 865597e, 08f0b13). No anti-patterns found.

The only notable deviation from the original requirement text is SHWT-05's collection path (`showings` top-level vs. `users/{uid}/showings` subcollection), which is an intentional architectural choice that enables the existing calendar query to pick up ST showings without any additional code — the functional intent of the requirement is fully met.

---

_Verified: 2026-03-05T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
