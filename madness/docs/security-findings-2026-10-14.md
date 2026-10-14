# Madness security review: Firestore rules + admin PIN flow

Night-shift bug report, 2026-10-14. **No code or rules changed.** Rules and `functions/` are
Joe-only edits; the client-side items are candidates for a future nightly PR.
Reviewed: `firestore.rules`, `js/50-auth.js`, `js/60-rooms.js`, `js/90-boot.js`, `functions/index.js`.

Context that shapes everything below: the app has **no authentication**. Firestore sees every
client as anonymous and the rules can only reason about the shape of the data, never who wrote it.
The admin PIN is a UI gate, not a server-side one. For a friend-group pool that is a reasonable
trade; the findings are ranked by how much they matter given that choice.

## Findings

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| 1 | **High** | Anyone who knows a room code can overwrite the whole `state` field (players, picks, bracket, scoring) and can replace `adminPin` with their own hash, locking the real commissioner out. The update rule only checks that `adminPin` is present and, if changed, is a string of 64+ chars. | `firestore.rules` L15-19 |
| 2 | **High** | The room document is world-readable and contains the admin PIN hash (`salt:sha256(salt+pin)`) and every player's `pinHash` inside `state`. A 4-digit PIN has 10,000 possibilities; anyone can brute-force every PIN offline in well under a second. The client-side backoff in `requireAdmin()` only slows the honest UI. | `firestore.rules` L6; `js/50-auth.js` |
| 3 | **Medium** | `gameResults` is write-once by anyone, and `notifyGameFinal` pushes `awayName`/`homeName`/scores from that document verbatim to every player's phone. A stranger with a room code can send arbitrary push notification text to the whole group ("Game Final: <anything>"). Scores are unaffected (scoring uses `state.games`). | `firestore.rules` L36-42; `functions/index.js` L112-153 |
| 4 | **Medium** | HTML injection via the room code. `?room=` from the URL and the Join box are upper-cased but not sanitised, and the join screen renders `Welcome to room <strong>${roomId}</strong>` without `escapeHtml`. Upper-casing neuters most JavaScript payloads (identifiers are case-sensitive) but still allows injected links, images that leak the viewer's IP, and layout defacement in a shared link. A `/` in the code also throws inside `db.collection('rooms').doc(code)` and trips the render error screen. | `js/90-boot.js` L7; `js/60-rooms.js` L66; `js/50-auth.js` L208 |
| 5 | **Low** | `fcmTokens/{playerId}` is world-readable and world-updatable. Tokens alone cannot send pushes (needs the server key), but anyone can add their own token to another player's doc to receive that player's "your turn" alerts, or `arrayRemove` tokens to silence someone. | `firestore.rules` L25-32 |
| 6 | **Low** | Admin session is a plain timestamp in localStorage keyed by room; anyone with the device is admin for 4 hours. Acceptable for the threat model; noted for completeness. | `js/50-auth.js` `checkAdminSession` |
| 7 | **Info** | Legacy plaintext PIN path still exists (`!adminPin.includes(':') && length !== 64`). Rules require 64+ chars on create/update, so new plaintext PINs cannot appear; the branch is dead once all 2026 rooms are gone. Candidate for the dead-code night. | `js/50-auth.js` `requireAdmin` |

## What would actually fix 1 to 3 (Joe decides)

Option A, smallest: **Firebase Anonymous Auth + owner UID.** `firebase.auth().signInAnonymously()`
at boot (one CDN script, no npm). Store `adminUid` on room create. Rules: `allow update: if
request.auth.uid == resource.data.adminUid || <only state.players[*].teamIds changed via the pick
transaction>`. The pick transaction is the hard part: Firestore rules cannot parse the JSON `state`
string, so picks would need to move out of the JSON blob into real fields, or go through a callable
Cloud Function. Rough effort: 1 to 2 nights for the client, half a night for rules, plus a migration
for existing rooms. Breaks "sessionless" joining unless the join flow also runs under anonymous auth
(it can; the uid just lives in localStorage like `mm4_me_` does today).

Option B, no auth changes: **move all writes behind callable Cloud Functions** that verify the PIN
server-side (hash stays private in a `rooms/{id}/private/secrets` doc with `allow read: if false`).
Fixes 1, 2 and 3 completely, keeps the UI identical, costs one function per mutating action
(pick, undo, advance, settings). Rough effort: 3 nights. Adds latency to every bracket click.

Option C, accept the model, harden the edges (can be nightly PRs, no rules changes):
- Sanitise room codes everywhere to `/^[A-Z0-9]{2,20}$/` and `escapeHtml(roomId)` in the join
  screen (finding 4). ~10 lines.
- Have `notifyGameFinal` re-verify the result against ESPN (or the new `scoreboard/{day}` cache
  from PR #3) before sending, and cap string lengths (finding 3). Functions edit: **Joe**.
- Rules: cap `state` size and require `gameResults.awayName/homeName` to be under 40 chars (partial
  mitigation for 3). Rules edit: **Joe**.

Recommendation: do Option C's first bullet as the next security-night PR regardless, and pick A or B
only if Joe wants the pool to survive a hostile room-code leak. For a private friend group, C alone
is defensible as long as the room code is treated like a password.

## Not findings (checked, fine)

- All user-controlled strings in templates other than `roomId` go through `escapeHtml` (names,
  team names, ESPN fields, modal text).
- Element ids in inline handlers are `crypto.randomUUID()` values; no injection path.
- Firebase web config in `index.html`/`sw.js` is public by design; the API key is not a secret.
- `resetAll` cannot delete rooms (`allow delete: if false`); it overwrites state, which finding 1
  already covers.
