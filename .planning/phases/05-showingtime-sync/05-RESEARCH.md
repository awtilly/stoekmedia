# Phase 5: ShowingTime Sync - Research

**Researched:** 2026-03-05
**Domain:** iCal feed parsing, Firebase scheduled functions, calendar integration
**Confidence:** HIGH

## Summary

Phase 5 integrates ShowingTime showing appointments into GreenDoor via one-way iCal feed consumption. The realtor pastes their ShowingTime calendar sync URL into a new "Integrations" card in Settings. A callable Cloud Function fetches and parses the feed using `node-ical`, upserting VEVENT data into Firestore. A scheduled Cloud Function runs every 30 minutes to keep all users' feeds current. ShowingTime showings appear in the calendar with a distinct "ST" badge and are read-only (no edit, no delete, no drag).

The technical risk is low. `node-ical` is a mature library with async URL fetching built in, the iCal VEVENT format is well-specified (RFC 5545), and Firebase v2 scheduled functions are fully supported. The main subtlety is the data model: ST showings should be stored in the top-level `showings` collection (matching existing queries in calendar.js, dashboard.js, and admin.js) with a `source: "showingtime"` field to distinguish them, rather than a subcollection under users which would require rewriting multiple existing queries.

**Primary recommendation:** Use `node-ical` 0.22.x for iCal parsing, `onSchedule` from `firebase-functions/v2/scheduler` for the 30-minute cron, and store ST showings in the existing top-level `showings` collection with `source: "showingtime"` and deterministic document IDs (`st_{realtorId}_{icalUid}`) for idempotent upsert via `setDoc`.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **ST badge & calendar display**: Same green color (#22c55e) as regular GreenDoor showings, plus a small "ST" badge/tag on the event dot. Add a 4th legend item to the calendar legend: green dot with "ST" label alongside existing Showings/Follow-ups/Events. Click on ST showing opens a read-only popover (title, time, location, "ShowingTime" source label) -- no Edit/Delete buttons. ST showings are NOT draggable.
- **Settings integration section**: New "Integrations" card (generic title, future-proofs for other integrations) placed between Email Sending and Help & Support. Disconnected state: step-by-step setup guide showing how to find the iCal URL in ShowingTime, plus the feed URL text input with placeholder and Save button. Connected state: green status dot + "Connected", saved feed URL (truncated), last synced timestamp, "Sync Now" and "Disconnect" buttons -- matches BoldSign/Email sender card pattern.
- **Cancelled showing handling**: Cancelled showings are removed from the calendar entirely (Firestore doc deleted on next sync). Showings missing from the feed are also deleted -- feed is the single source of truth. No historical retention of past ST showings that drop off the feed.
- **Error & sync feedback**: "Sync Now" button shows spinner/loading state while running; toast on complete ("Synced 12 showings") or failure. Invalid/expired feed URLs show red error banner in the Integrations card with 2-3 troubleshooting tips. Background scheduled syncs are silent -- no push notifications on failure; last sync time + error status visible on Settings page only.

### Claude's Discretion
- ST badge visual design (pill, superscript, icon approach)
- Exact step-by-step instructions content for ShowingTime setup guide
- Data model details (subcollection vs top-level collection, field names)
- node-ical parsing implementation and VEVENT field mapping
- Rate limiting implementation for 15-minute per-user throttle
- Scheduled function architecture (pub/sub trigger, batch processing)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SHWT-01 | Settings page has "Integrations" section with ShowingTime iCal feed URL input | Settings card pattern documented; HTML insertion point identified (between Email Sending and Help & Support) |
| SHWT-02 | Feed URL saves to users/{uid}.showingTimeFeedUrl | Firestore `setDoc` with `merge: true` pattern already used in `saveProfile()` |
| SHWT-03 | "Sync Now" button triggers callable Cloud Function to fetch and parse the iCal feed | `httpsCallable` pattern established in settings.js; `onCall` in functions/index.js |
| SHWT-04 | Cloud Function converts webcal:// to https://, fetches feed, parses with node-ical | node-ical `async.fromURL()` handles HTTP(S) fetching; webcal:// replacement is a simple string operation |
| SHWT-05 | Each VEVENT upserted to showings collection with title, times, location, source: "showingtime" | Deterministic doc ID `st_{realtorId}_{icalUid}` enables idempotent `setDoc`; field mapping from node-ical documented |
| SHWT-06 | Cancelled events in feed are removed from Firestore | Query existing ST showings for user, diff against feed UIDs, batch delete missing ones |
| SHWT-07 | Scheduled Cloud Function syncs all users with feed URLs every 30 minutes | `onSchedule("every 30 minutes")` from firebase-functions/v2/scheduler |
| SHWT-08 | Rate limited to max once per 15 minutes per user | Store `lastSyncedAt` timestamp on user doc; skip if < 15 minutes ago |
| SHWT-09 | ShowingTime showings display in calendar with distinct "ST" badge, read-only | New `type: "showingtime"` in allCalEvents; CSS badge class; popover without edit/delete |
| SHWT-10 | Invalid or expired feed URLs show clear error in Settings with instructions | Store `showingTimeSyncError` on user doc; render red error banner with troubleshooting tips |
| SHWT-11 | Last synced timestamp displayed in Settings | Store `showingTimeLastSyncedAt` on user doc; render with `formatDateTime()` or `timeAgo()` |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-ical | 0.22.x | Parse iCal/ICS feeds from URLs | The standard Node.js iCal parser; handles VEVENT, RRULE, EXDATE, timezone-aware dates; async URL fetching built in |
| firebase-functions/v2/scheduler | ^4.0.0 (bundled) | Scheduled Cloud Function trigger | Official Firebase v2 scheduler; uses Cloud Scheduler under the hood; cron and App Engine syntax |
| firebase-admin | ^12.0.0 (existing) | Firestore batch operations | Already in project; batch writes for upsert + delete operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| firebase-functions/v2/https | ^4.0.0 (existing) | onCall for "Sync Now" callable | Already used for other callable functions in index.js |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-ical | ical.js (Mozilla) | Lower-level, no built-in URL fetching, better for generating iCal but overkill for parsing |
| node-ical | ical (npm) | Predecessor package, unmaintained, node-ical is the actively maintained fork |
| Top-level showings collection | users/{uid}/showings subcollection | Would require rewriting calendar.js, dashboard.js, and admin.js queries that already query the top-level `showings` collection |

**Installation:**
```bash
cd functions && npm install node-ical
```

## Architecture Patterns

### Recommended Data Model

**ST showings stored in the existing top-level `showings` collection** with a `source` field:

```
showings/{st_realtorId_icalUid}
  realtorId: string          // matches existing query pattern
  source: "showingtime"      // distinguishes from manual showings
  icalUid: string            // original VEVENT UID for dedup
  address: string            // from SUMMARY or LOCATION
  showingDate: Timestamp     // from DTSTART
  endDate: Timestamp         // from DTEND
  status: "scheduled"        // always scheduled for active ST showings
  location: string           // from LOCATION field
  description: string        // from DESCRIPTION field
  icalSequence: number       // from SEQUENCE field, for change detection
  createdAt: Timestamp
  updatedAt: Timestamp
```

**Why top-level collection:** The existing `calendar.js` queries `collection(db, "showings")` with `where("realtorId", "==", uid)`. Dashboard and admin queries also use this pattern. Storing ST showings in the same collection means zero changes to existing queries -- they automatically appear. The `source` field allows filtering when needed.

**User profile fields (on `users/{uid}`):**
```
showingTimeFeedUrl: string | null
showingTimeLastSyncedAt: Timestamp | null
showingTimeSyncError: string | null
showingTimeSyncCount: number | null
```

**Deterministic document ID pattern:** `st_{realtorId}_{icalUid}` -- enables idempotent `setDoc` (no duplicate checking needed), matches the project's established deterministic ID pattern (see `clientId_closing_documents`, `clientId_signed_templateId`).

### Cloud Function Architecture

```
functions/index.js additions:
  syncShowingTime (onCall)           -- "Sync Now" button handler
  scheduledShowingTimeSync (onSchedule) -- 30-min cron
  syncFeedForUser(uid, feedUrl)      -- shared sync logic (internal helper)
```

**Shared sync logic (`syncFeedForUser`):**
1. Convert `webcal://` to `https://` in feed URL
2. Call `ical.async.fromURL(url)` to fetch and parse
3. Filter returned object for entries where `type === 'VEVENT'`
4. Query existing ST showings for this user: `where("realtorId", "==", uid), where("source", "==", "showingtime")`
5. Build a map of existing `icalUid -> docId`
6. For each VEVENT in feed: `setDoc` with deterministic ID (upsert)
7. For existing docs NOT in the feed: `deleteDoc` (cancelled/removed)
8. Update user doc: `showingTimeLastSyncedAt`, `showingTimeSyncError: null`, `showingTimeSyncCount`
9. Return `{ synced: count, removed: removedCount }`

**Error handling:**
- Wrap `fromURL` in try/catch -- network errors, invalid URLs, malformed ICS
- On error: set `showingTimeSyncError` on user doc, do NOT delete existing showings
- Return error message to client for toast display

### Calendar Integration Pattern

```javascript
// In loadCalendarData(), add after existing showings query:
const stShowingsSnap = await getDocs(
  query(collection(db, "showings"),
    where("realtorId", "==", uid),
    where("source", "==", "showingtime"),
    orderBy("showingDate", "asc"))
).catch(e => { console.error("Load ST showings:", e); return { forEach() {} }; });

stShowingsSnap.forEach(d => {
  const s = d.data();
  allCalEvents.push({
    id: d.id,
    type: "showingtime",   // <-- new type for ST badge rendering
    title: s.address || "ShowingTime",
    start: s.showingDate?.toDate ? s.showingDate.toDate() : new Date(),
    end: s.endDate?.toDate ? s.endDate.toDate() : new Date(start.getTime() + 3600000),
    clientId: null,        // ST showings are not linked to GreenDoor clients (v1)
    color: "#22c55e",      // same green as regular showings
    data: s
  });
});
```

**Important:** The existing `showingsSnap` query on line 47 of calendar.js does NOT have a `where("source", ...)` filter, so it will return BOTH manual and ST showings. This means ST showings will already appear twice unless we either:
- **Option A (recommended):** Add `where("source", "!=", "showingtime")` to the existing showings query, then add a separate ST query. This is cleaner but requires a composite index.
- **Option B:** Remove the separate ST query and let existing showings query pick up ST showings too, but add logic in the `forEach` to set `type: "showingtime"` when `source === "showingtime"`. This avoids the extra query but mixes concerns.

**Recommendation: Option B** -- modify the existing `showingsSnap.forEach` to check `s.source === "showingtime"` and set the type accordingly. This avoids an extra Firestore query and composite index, and is simpler:

```javascript
showingsSnap.forEach(d => {
  const s = d.data();
  if (s.status === "cancelled") return;
  const isShowingTime = s.source === "showingtime";
  const start = s.showingDate?.toDate ? s.showingDate.toDate() : new Date();
  allCalEvents.push({
    id: d.id,
    type: isShowingTime ? "showingtime" : "showing",
    title: s.address || (isShowingTime ? "ShowingTime" : "Showing"),
    start,
    end: s.endDate?.toDate ? s.endDate.toDate() : new Date(start.getTime() + 3600000),
    clientId: s.clientId || null,
    color: "#22c55e",
    data: s
  });
});
```

### Anti-Patterns to Avoid
- **Storing ST showings in a subcollection under users:** Would require rewriting 4+ existing query sites across calendar.js, dashboard.js, admin.js, and client-detail.js that all query the top-level `showings` collection.
- **Using autodetect/sync API of node-ical:** Always use `async.fromURL()` or `async.parseICS()` in Cloud Functions to avoid blocking.
- **Deleting all ST showings and re-inserting on every sync:** Wasteful writes. Use deterministic IDs with `setDoc` for upsert, only delete docs not in the feed.
- **Storing the feed URL in a separate collection:** Use the existing `users/{uid}` document with merge to store feed config alongside other settings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| iCal parsing | Custom regex parser for VEVENT blocks | `node-ical` | RFC 5545 has edge cases (folded lines, escaped chars, timezones, RRULE, EXDATE) that are deceptively complex |
| URL fetching + ICS parsing | `fetch()` + manual parse | `ical.async.fromURL()` | node-ical handles HTTP fetching, content type detection, and parsing in one call |
| Timezone conversion | Manual UTC offset math | node-ical's date objects | Library returns proper JS Date objects with timezone awareness |
| Cron scheduling | setInterval or Cloud Tasks | `onSchedule` from firebase-functions/v2/scheduler | Firebase handles Cloud Scheduler job creation, retries, and monitoring automatically |
| Webcal URL normalization | Complex URL parser | Simple string replace: `url.replace(/^webcal:\/\//i, "https://")` | webcal:// is literally https:// with a different scheme -- per RFC, they are equivalent |

**Key insight:** The iCal format looks simple but has many edge cases (line folding at 75 chars, backslash escaping, timezone references, recurring event expansion). node-ical handles all of these correctly. The only safe approach is to use the library, not parse manually.

## Common Pitfalls

### Pitfall 1: Existing Showings Query Returns ST Showings Too
**What goes wrong:** The existing `showingsSnap` query in calendar.js has no `source` filter, so after adding ST showings to the `showings` collection, they appear with `type: "showing"` instead of `type: "showingtime"`.
**Why it happens:** The existing code was written before ST showings existed. All documents in `showings` were manual.
**How to avoid:** In the existing `showingsSnap.forEach`, check `s.source === "showingtime"` and set event type accordingly. Do NOT add a separate query -- let the existing query handle both.
**Warning signs:** ST showings appear without the "ST" badge, or appear twice on the calendar.

### Pitfall 2: webcal:// Scheme Not Handled
**What goes wrong:** `node-ical.async.fromURL()` or `fetch()` fails with an "unsupported protocol" error.
**Why it happens:** ShowingTime may provide URLs with `webcal://` scheme. Node.js fetch and HTTP libraries don't support webcal://.
**How to avoid:** Always normalize the URL before fetching: `url.replace(/^webcal:\/\//i, "https://")`.
**Warning signs:** Sync fails with network/protocol errors even though the URL works in Google Calendar.

### Pitfall 3: Sync Deletes Everything on Network Error
**What goes wrong:** A failed fetch returns empty results, the diff logic sees all existing showings as "missing from feed," and deletes them all.
**Why it happens:** Not distinguishing between "feed returned zero events" and "feed fetch failed."
**How to avoid:** Wrap `fromURL` in try/catch. On error, set `showingTimeSyncError` and return early WITHOUT deleting existing showings. Only perform the deletion diff when the fetch succeeds.
**Warning signs:** All ST showings disappear and reappear intermittently.

### Pitfall 4: Firestore Composite Index Missing
**What goes wrong:** Query `where("realtorId", "==", uid), where("source", "==", "showingtime")` fails with an index error at runtime.
**Why it happens:** Firestore requires composite indexes for multi-field queries.
**How to avoid:** The sync Cloud Function needs this composite index. Deploy or create it before first sync. However, if using Option B (single query without source filter in calendar.js), the calendar client side does NOT need this index -- only the Cloud Function cleanup query does.
**Warning signs:** First sync fails with a Firestore index error in Cloud Functions logs.

### Pitfall 5: iCal UID Contains Characters Invalid for Firestore Doc IDs
**What goes wrong:** Some iCal UIDs contain `/`, `.`, or other characters that may cause issues in Firestore document paths.
**Why it happens:** iCal UIDs are arbitrary strings, often email-like (e.g., `abc123@showingtime.com`).
**How to avoid:** Sanitize the UID for use in document IDs. Replace problematic characters: `icalUid.replace(/[\/\.#\$\[\]]/g, '_')`. Or use a hash: `crypto.createHash('md5').update(icalUid).digest('hex')`.
**Warning signs:** setDoc fails with invalid path errors.

### Pitfall 6: Rate Limit Check Uses Client Clock
**What goes wrong:** Rate limiting is bypassed because the user's browser clock is wrong, or is checked client-side where it can be circumvented.
**Why it happens:** Checking "last synced 15 min ago" on the client side.
**How to avoid:** Check `showingTimeLastSyncedAt` server-side in the Cloud Function. Use Firestore server timestamp for comparison.
**Warning signs:** Users can spam the sync button and cause excessive fetch calls to ShowingTime.

## Code Examples

### node-ical: Parse Feed from URL
```javascript
// Source: node-ical GitHub README + official docs
const ical = require("node-ical");

async function parseFeed(feedUrl) {
  // Normalize webcal:// to https://
  const url = feedUrl.replace(/^webcal:\/\//i, "https://");

  // Fetch and parse in one call
  const data = await ical.async.fromURL(url);

  const events = [];
  for (const [key, event] of Object.entries(data)) {
    if (event.type !== "VEVENT") continue;

    events.push({
      uid: event.uid,
      summary: event.summary || "",           // Title/subject
      start: event.start,                      // JS Date object
      end: event.end,                          // JS Date object
      location: event.location || "",          // Venue
      description: event.description || "",    // Details
      status: (event.status || "").toUpperCase(), // CONFIRMED, TENTATIVE, CANCELLED
      sequence: event.sequence || 0,           // Revision number
    });
  }

  return events;
}
```

### Firebase v2 Scheduled Function
```javascript
// Source: Firebase docs - firebase.google.com/docs/functions/schedule-functions
const { onSchedule } = require("firebase-functions/v2/scheduler");

exports.scheduledShowingTimeSync = onSchedule(
  { schedule: "every 30 minutes", region: "us-central1", timeoutSeconds: 300 },
  async (event) => {
    // Query all users with a feed URL
    const usersSnap = await db.collection("users")
      .where("showingTimeFeedUrl", "!=", null)
      .get();

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      // Rate limit: skip if synced within last 15 minutes
      const lastSync = userData.showingTimeLastSyncedAt?.toDate();
      if (lastSync && (Date.now() - lastSync.getTime()) < 15 * 60 * 1000) {
        continue;
      }

      try {
        await syncFeedForUser(userDoc.id, userData.showingTimeFeedUrl);
      } catch (err) {
        console.error(`Sync failed for user ${userDoc.id}:`, err.message);
      }
    }
  }
);
```

### Deterministic Doc ID + Upsert Pattern
```javascript
// Source: Project pattern from phases 1-4 (clientId_closing_documents, clientId_signed_templateId)
const FieldValue = require("firebase-admin/firestore").FieldValue;

function sanitizeIcalUid(uid) {
  // iCal UIDs can contain @, dots, etc. -- sanitize for Firestore doc ID
  return uid.replace(/[\/\.#\$\[\]]/g, "_");
}

async function syncFeedForUser(realtorId, feedUrl) {
  const url = feedUrl.replace(/^webcal:\/\//i, "https://");
  const ical = require("node-ical");

  let data;
  try {
    data = await ical.async.fromURL(url);
  } catch (err) {
    // Network/parse error -- save error but do NOT delete existing showings
    await db.doc(`users/${realtorId}`).update({
      showingTimeSyncError: err.message || "Failed to fetch feed",
    });
    throw err;
  }

  // Collect valid events from feed
  const feedEvents = {};
  for (const [key, event] of Object.entries(data)) {
    if (event.type !== "VEVENT") continue;
    if ((event.status || "").toUpperCase() === "CANCELLED") continue;
    const sanitizedUid = sanitizeIcalUid(event.uid);
    feedEvents[sanitizedUid] = event;
  }

  // Get existing ST showings for this user
  const existingSnap = await db.collection("showings")
    .where("realtorId", "==", realtorId)
    .where("source", "==", "showingtime")
    .get();

  const batch = db.batch();
  let upsertCount = 0;
  let deleteCount = 0;

  // Upsert: events in feed
  for (const [sanitizedUid, event] of Object.entries(feedEvents)) {
    const docId = `st_${realtorId}_${sanitizedUid}`;
    const docRef = db.doc(`showings/${docId}`);

    batch.set(docRef, {
      realtorId,
      source: "showingtime",
      icalUid: event.uid,
      address: event.summary || event.location || "ShowingTime Showing",
      showingDate: event.start ? admin.firestore.Timestamp.fromDate(new Date(event.start)) : null,
      endDate: event.end ? admin.firestore.Timestamp.fromDate(new Date(event.end)) : null,
      location: event.location || "",
      description: event.description || "",
      status: "scheduled",
      icalSequence: event.sequence || 0,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    upsertCount++;
  }

  // Delete: existing docs not in feed
  for (const doc of existingSnap.docs) {
    const existingUid = sanitizeIcalUid(doc.data().icalUid);
    if (!feedEvents[existingUid]) {
      batch.delete(doc.ref);
      deleteCount++;
    }
  }

  await batch.commit();

  // Update user sync metadata
  await db.doc(`users/${realtorId}`).update({
    showingTimeLastSyncedAt: FieldValue.serverTimestamp(),
    showingTimeSyncError: null,
    showingTimeSyncCount: upsertCount,
  });

  return { synced: upsertCount, removed: deleteCount };
}
```

### Read-Only Popover for ST Showings
```javascript
// Source: Existing showPopover() pattern in calendar.js
// Modify the showPopover function to handle "showingtime" type:
window.showPopover = function (eventId, anchorEl) {
  const ev = allCalEvents.find(e => e.id === eventId);
  if (!ev) return;

  const pop = document.getElementById("cal-popover");
  document.getElementById("pop-title").textContent = ev.title;

  let meta = formatDateTime(Timestamp.fromDate(ev.start));
  if (ev.type === "showingtime" && ev.data.location) {
    meta += `<br>${escapeHtml(ev.data.location)}`;
  }
  if (ev.type === "showingtime") {
    meta += `<br><span class="gd-text-muted" style="font-size:0.75rem;">Source: ShowingTime</span>`;
  }
  // ... existing client name logic ...
  document.getElementById("pop-meta").innerHTML = meta;

  let actions = "";
  // No edit/delete for ST showings
  if (ev.type !== "showingtime") {
    if (ev.clientId) {
      actions += `<a href="..." class="gd-btn gd-btn-sm gd-btn-primary">View Client</a>`;
    }
    if (ev.type === "event") {
      actions += `<button class="gd-btn gd-btn-sm" onclick="editEvent('${ev.id}')">Edit</button>`;
      actions += `<button class="gd-btn gd-btn-sm" onclick="deleteEvent('${ev.id}')">Delete</button>`;
    }
  }
  document.getElementById("pop-actions").innerHTML = actions;
  // ... position popover ...
};
```

### ST Badge CSS
```css
/* ST badge on calendar event dots */
.gd-cal-event-dot.showingtime {
  background: #22c55e;
  position: relative;
}
.gd-cal-event-dot.showingtime::after {
  content: "ST";
  position: absolute;
  right: 2px;
  top: -1px;
  font-size: 0.45rem;
  font-weight: 700;
  background: #fff;
  color: #22c55e;
  border-radius: 2px;
  padding: 0 2px;
  line-height: 1.1;
}

.gd-cal-week-event.showingtime {
  background: #22c55e;
  position: relative;
}
.gd-cal-week-event.showingtime::after {
  content: "ST";
  position: absolute;
  right: 4px;
  top: 2px;
  font-size: 0.55rem;
  font-weight: 700;
  background: rgba(255,255,255,0.9);
  color: #22c55e;
  border-radius: 3px;
  padding: 0 3px;
  line-height: 1.3;
}

/* Legend entry */
.gd-legend-showingtime {
  background: #22c55e;
  position: relative;
}
```

### Settings Integrations Card HTML
```html
<!-- Integrations Section - between Email Sending and Help & Support -->
<div class="gd-card gd-settings-card">
  <h3>Integrations</h3>
  <div id="showingtime-integration">
    <!-- Rendered dynamically by settings.js -->
  </div>
</div>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| firebase-functions v1 pubsub.schedule() | firebase-functions/v2/scheduler onSchedule() | 2023 (v2 GA) | Cleaner API, region/memory/timeout in options object |
| ical npm package | node-ical fork (jens-maus) | 2020+ | Active maintenance, async support, RRULE/EXDATE handling |
| Manual HTTP fetch + ical parse | ical.async.fromURL() | Built-in | Single call handles fetch + parse; uses native fetch on Node 18+ |

**Deprecated/outdated:**
- `ical` npm package: Predecessor to `node-ical`; unmaintained. Use `node-ical` instead.
- Firebase Functions v1 `pubsub.schedule()`: Still works but v2 `onSchedule` is the current standard for new functions.

## Open Questions

1. **Firestore batch limit of 500 operations**
   - What we know: Firestore batch writes are limited to 500 operations per batch.
   - What's unclear: Could a single user have 500+ ShowingTime showings? Unlikely for most realtors, but high-volume teams might.
   - Recommendation: Implement chunked batching (process in batches of 450) as a safety measure. Low effort, prevents edge case failures.

2. **ShowingTime feed STATUS field behavior**
   - What we know: iCal standard defines STATUS as CONFIRMED/TENTATIVE/CANCELLED. The STATE.md flags this as a pre-work item: "Inspect a live ShowingTime iCal feed to confirm STATUS, SEQUENCE, EXDATE, and DESCRIPTION field behavior."
   - What's unclear: Whether ShowingTime sets STATUS=CANCELLED for cancelled showings or simply removes them from the feed.
   - Recommendation: Handle both: filter out CANCELLED events AND delete docs for events missing from feed. This covers both behaviors.

3. **Composite index for source + realtorId on showings collection**
   - What we know: The Cloud Function cleanup query needs `where("realtorId", "==", uid), where("source", "==", "showingtime")` which requires a composite index.
   - What's unclear: Whether this needs manual creation or auto-creation via Firebase error message.
   - Recommendation: Document the required index. Firebase will auto-suggest it on first query failure, but it's better to deploy the index definition proactively.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual testing (no automated test framework in project) |
| Config file | none |
| Quick run command | Manual: paste feed URL in Settings, click Sync Now, verify calendar |
| Full suite command | Manual: full walkthrough of all SHWT requirements |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHWT-01 | Integrations card visible in Settings | manual | Visual inspection of Settings page | N/A |
| SHWT-02 | Feed URL saves to Firestore | manual | Check Firestore Console after save | N/A |
| SHWT-03 | Sync Now triggers Cloud Function | manual | Click Sync Now, observe toast + Firestore data | N/A |
| SHWT-04 | webcal:// converted, feed parsed | manual | Use webcal:// URL, verify sync succeeds | N/A |
| SHWT-05 | VEVENTs upserted to showings | manual | Check Firestore showings collection for st_ docs | N/A |
| SHWT-06 | Cancelled events removed | manual | Cancel event in ShowingTime, re-sync, verify removal | N/A |
| SHWT-07 | Scheduled sync runs every 30 min | manual | Deploy, wait 30 min, check Cloud Functions logs | N/A |
| SHWT-08 | Rate limited to 15 min | manual | Click Sync Now twice within 15 min, verify throttle | N/A |
| SHWT-09 | ST badge + read-only in calendar | manual | View calendar, click ST event, verify no edit/delete | N/A |
| SHWT-10 | Error banner on bad URL | manual | Enter invalid URL, click Sync Now, verify error UI | N/A |
| SHWT-11 | Last synced timestamp shown | manual | After sync, verify timestamp in Settings | N/A |

### Sampling Rate
- **Per task commit:** Manual smoke test of changed feature
- **Per wave merge:** Full manual walkthrough of all SHWT requirements
- **Phase gate:** All 11 SHWT requirements manually verified before `/gsd:verify-work`

### Wave 0 Gaps
None -- no automated test infrastructure exists in this project. All validation is manual.

## Sources

### Primary (HIGH confidence)
- [node-ical GitHub](https://github.com/jens-maus/node-ical) - API documentation, async.fromURL(), VEVENT field mapping, version info
- [Firebase Schedule Functions docs](https://firebase.google.com/docs/functions/schedule-functions) - v2 onSchedule import, cron syntax, schedule options
- Project source code: `functions/index.js`, `functions/package.json`, `js/calendar.js`, `js/settings.js`, `app/settings.html`, `app/calendar.html`, `css/greendoor.css` -- all read directly

### Secondary (MEDIUM confidence)
- [ShowingTime Help Center](https://help.home.showingtime.com/knowledgebase/articles/1881913) - Calendar sync steps (Menu > Profile > Calendar Sync), feed options (all vs confirmed, past appointments)
- [ShowingTime Appointment Center](https://apptcenter.uservoice.com/knowledgebase/articles/431165-calendar-sync) - Feed is .ics/webcal format, one-way sync, 12-hour Google Calendar delay note
- [iCalendar RFC 5545 spec](https://icalendar.org/iCalendar-RFC-5545/3-6-1-event-component.html) - VEVENT component structure
- [Webcal Wikipedia](https://en.wikipedia.org/wiki/Webcal) - webcal:// is equivalent to https:// with different scheme

### Tertiary (LOW confidence)
- ShowingTime feed URL exact format: Not documented publicly. Assumed to be `webcal://` or `https://` URL ending in `.ics` based on iCal standard and ShowingTime docs saying they use ".ics & webcal calendar feeds."

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - node-ical is the established iCal parser for Node.js; Firebase v2 scheduler is well-documented
- Architecture: HIGH - data model decision informed by thorough analysis of existing query patterns across calendar.js, dashboard.js, admin.js, client-detail.js
- Pitfalls: HIGH - identified through code analysis (existing query returns both types), protocol knowledge (webcal://), and established project patterns (error handling, deterministic IDs)

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable domain, no rapidly changing APIs)
