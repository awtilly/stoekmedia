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

## Not findings

- Pick, undo and auto-pick are all transactional and check turn/taken against server state.
- `_roomGeneration` correctly discards stale listeners after switching rooms.
- Debounce timer is cleared on every call, so rapid settings edits coalesce into one write.
