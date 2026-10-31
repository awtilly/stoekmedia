# Madness sync/race review: Firestore writes

Night-shift findings, 2026-10-14. No code changed. Candidate for a race/sync nightly PR.
Reviewed: `js/60-rooms.js` (`saveState`, `_debouncedFirestoreWrite`, `_applyRoomSnapshot`),
`js/80-pages.js` (`pickTeam`, `undoDraft`, `autoPickHighestSeed`), `js/20-live.js` (`checkGameFinals`).

## Findings

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High during a live draft** | **Lost pick.** Picks go through `runTransaction` (good, added in 20784cf). But every other mutation (`addPlayer`, `changeScoring`, `advanceTeam`, `resolvePlayIn`, `refreshTeamData`, settings) calls `saveState()`, which after an 800 ms debounce does `set({ state: JSON.stringify(S) }, { merge: true })` with the **whole** state blob, built from the local `S` at fire time. If a player's pick transaction commits in the gap between the admin's last snapshot and that write, the admin's blob still has the old `ds.cp` and roster, and the `set` overwrites the pick. Window is roughly the debounce plus snapshot latency, so about 1 second per admin edit. Likely cause of at least some of the 2026 "my pick vanished" reports alongside the pre-transaction race. |
| 2 | **Medium** | **Last writer wins for bracket edits.** Two admins advancing different games within the debounce window: each client's blob contains only its own change; the second write erases the first. `checkGameFinals` reduces this (only the first reporter syncs) but manual taps and `advanceTeam` cascades are still whole-blob. |
| 3 | **Low** | `resetAll` uses `update(...).catch(() => {})` then `location.reload()`. If the update fails (offline, rules), the page reloads into the old state with local storage already cleared; the user sees the room as if it were never reset, with no error. |
| 4 | **Low** | `connectToRoom` drops snapshots while `_pickInFlight`. Correct for the pick itself, but a snapshot carrying someone else's change arriving during a slow transaction is discarded; Firestore delivers the next snapshot after the transaction commits, so this self-heals. Noted only. |
| 5 | **Info** | `_applyRoomSnapshot` sets `_isRemoteUpdate` around `render()` so any `saveState()` triggered by rendering (legacy phase redirect) skips the Firestore write. Intentional and fine; the flag is synchronous so no leak. |
| 6 | **Medium during a timed draft** | **Draft clock trusts the writing device's wall clock.** (added 2026-10-18) `pickDeadline` is written as `Timestamp.fromDate(new Date(Date.now() + timerDuration * 1000))` at seven sites in `js/80-pages.js` (start, pick, undo, auto-pick, skip, resume). Every other device then counts down `deadline - Date.now()` with *its own* clock. A phone that is 40 s fast sees the clock hit zero 40 s early; with `draft-clock-any-tab` queued (every tab runs the fallback) an admin tab whose clock is fast auto-picks for the drafter before their real time is up, and a slow clock lets a pick run long. Phones are usually within a few seconds (NTP), but a laptop with a drifted BIOS clock or a device with manual time is enough. |

## Proposed fix for 1 and 2 (one PR, ~40 lines in `js/60-rooms.js`)

Make `_debouncedFirestoreWrite` a transaction that re-reads the room and merges, instead of a blind `set`:

```js
await db.runTransaction(async tx => {
  const ref = db.collection('rooms').doc(roomId);
  const snap = await tx.get(ref);
  const remote = snap.exists && snap.data().state ? JSON.parse(snap.data().state) : {};
  const shared = {};
  for (const k in S) if (!VIEW_LOCAL.includes(k)) shared[k] = S[k];
  // Draft progress is owned by the pick transactions: never regress it from a stale local copy.
  if (remote.ds && S.ds && (remote.ds.cp || 0) > (S.ds.cp || 0)) {
    shared.ds = remote.ds;
    const remoteRosters = Object.fromEntries((remote.players || []).map(p => [p.id, p.teamIds || []]));
    shared.players = (shared.players || []).map(p => ({ ...p, teamIds: remoteRosters[p.id] || p.teamIds || [] }));
  }
  tx.update(ref, { state: JSON.stringify(shared), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
});
```

That closes finding 1 (picks can only move forward) without changing the data model. Finding 2 wants
the same treatment for `bracket`: merge per-slot, taking the non-null value when the local slot is
null. Both are unit-testable through the harness if the merge step is pulled into a pure
`mergeSharedState(local, remote)` function in `70-logic.js`; write the tests first, they are the
point of the PR. Risk: Medium (touches every Firestore write); run the headless smoke test and a
two-tab manual draft before merging.

## Finding 6: clock skew, proposed fix (no code yet; small nightly PR, ~30 lines in `js/80-pages.js` + `js/60-rooms.js`)

Do not trust `Date.now()` on either side. Two options, cheapest first:

1. **Server offset estimate (preferred, no data-model change).** Every room write already goes through Firestore; add `lastWriteAt: firebase.firestore.FieldValue.serverTimestamp()` to the room doc in `_debouncedFirestoreWrite` and the pick transaction. In `_applyRoomSnapshot`, when the snapshot is not from local cache (`!snap.metadata.hasPendingWrites`), compute `_clockOffset = lastWriteAt.toMillis() - Date.now()` (clamped to +/-5 min, ignore if `lastWriteAt` is null during a pending server timestamp). `updateDraftClock` then uses `Date.now() + _clockOffset`. The deadline itself can keep being written from the picker's clock, because the picker's skew is folded into the offset every other device computes against the same server time. Accuracy: snapshot latency, about 0.5 s, far better than today.
2. **Server-stamped deadline.** Write `pickStartedAt: serverTimestamp()` + `timerDuration` instead of an absolute `pickDeadline` and derive the deadline on read. Cleaner but every one of the seven write sites, `updateDraftClock`, the pause/resume math and `autopick-double-fire`'s guard change; wait until the queued draft-clock PRs (tick, beep, any-tab) have merged so they do not all conflict.

Either way, unit-test with a fake `Date.now` and a fake server time in the harness (`draft-clock.test.js` is the template). Keep the autopick fallback rule as is: at most one device should fire, and `autopick-double-fire` already makes the second transaction a no-op.

## Not findings

- Pick, undo and auto-pick are all transactional and check turn/taken against server state.
- `_roomGeneration` correctly discards stale listeners after switching rooms.
- Debounce timer is cleared on every call, so rapid settings edits coalesce into one write.
