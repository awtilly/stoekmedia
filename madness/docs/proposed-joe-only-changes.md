# Proposed edits to the Joe-only files (sw.js, firestore.rules, functions/index.js)

Night shift never edits these. Each block below is ready to paste; apply in the order listed.

## 1. firestore.rules: scoreboard cache read access (needed by PR #3)

Inside `match /databases/{database}/documents {`, after the `rooms` block:

```
    // Scoreboard cache written by the pollScoreboard Cloud Function (admin SDK bypasses rules)
    match /scoreboard/{day} {
      allow read: if true;
      allow write: if false;
    }
```

Deploy: `cd madness && firebase deploy --only firestore:rules`.

## 2. sw.js: do not hand index.html to a failed script/asset fetch (after PR #2 merges)

Why: the cache-first branch ends in `.catch(() => caches.match('./index.html'))`. With the app split
into `js/` files, an offline miss on a never-cached JS URL would return HTML as JavaScript and the
app would throw instead of showing the cached shell. Also bump the cache name so old entries are
evicted on activate.

```diff
-const CACHE_NAME = 'mm-draft-v8';
+const CACHE_NAME = 'mm-draft-v9';
```

```diff
       return fetch(event.request).then(response => {
         if (response.ok && event.request.method === 'GET') {
           const clone = response.clone();
           caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
         }
         return response;
       });
-    }).catch(() => caches.match('./index.html'))
+    }).catch(() => Response.error())
   );
```

Do **not** add `./js/*.js` to `PRECACHE_URLS`: requests carry `?v=<hash>` and the cache matches on
the full URL, so unversioned precache entries would never be hit. Runtime caching on first load
already covers the js/ files; offline-on-first-visit was never supported for the CDN scripts either.

## 3. functions/index.js: push payloads that iOS will display (needed before the App Store build)

Both `sendEachForMulticast` calls send `data` only. Add `notification` and `apns` so a backgrounded
iOS app shows them. Web clients will then also get a browser-rendered notification, so `sw.js`
`onBackgroundMessage` must skip `showNotification` when `payload.notification` exists (see 4).

```diff
   const message = {
     tokens,
+    notification: { title: "You're on the clock!", body: `Pick #${pickNumber} (Round ${roundNumber}) -- make your selection` },
+    apns: { payload: { aps: { sound: 'default', badge: 1 } } },
     data: {
       title: "You're on the clock!",
```

Repeat for `gameMessage` and `leaderMessage` with their title/body strings.
Deploy: `cd madness && firebase deploy --only functions`.

## 4. sw.js: avoid double notifications once 3 is deployed

```diff
 messaging.onBackgroundMessage((payload) => {
+  if (payload.notification) return; // browser already displayed it
   const data = payload.data || {};
```

Bump `CACHE_NAME` again when shipping this.

## 5. functions/espn-parse.js: same final-detection guard as the client parser (with the `espn-final-guards` branch)

`functions/espn-parse.js` on PR #3 is a copy of `espn.parseScoreboardEvents()`. The `espn-final-guards` branch changes the
client copy so that a "post" game with no decided winner is not reported as `completed` (otherwise `checkGameFinals()`
crowns the home team) and an event with fewer than two competitors is dropped. Once Track 2 is live, clients read the
server-parsed events, so the server copy needs the identical change or the bug comes back. Replace, in `parseScoreboardEvents`:

```js
    const away = teams.find(t => t.homeAway === 'away') || teams[0];
    const home = teams.find(t => t.homeAway === 'home') || teams[1];
    if (!away || !home || away === home) return null;

    let completed = statusType.completed || false;
    if (completed && !!away.winner === !!home.winner) {
      const a = parseInt(away.score, 10), h = parseInt(home.score, 10);
      if (a > h) { away.winner = true; home.winner = false; }
      else if (h > a) { home.winner = true; away.winner = false; }
      else completed = false;
    }
```

and `completed: statusType.completed || false,` → `completed,` in the returned object. Then `firebase deploy --only functions`.
The five tests added to `test/espn.test.js` on `espn-final-guards` are the spec; run them against the server copy if you want
(`require('../functions/espn-parse')` in place of `app.espn`).

## 6. functions/index.js: the "Leaderboard Shake-up" push compares the room against itself (found Shift 11, 2026-10-17)

`notifyGameFinal` fires on `rooms/{roomId}/gameResults/{gameId}` create, then reads `rooms/{roomId}` and compares
`computeRankings(state)` with `result.rankingsBefore`. But the client (`checkGameFinals()` in `js/20-live.js`) writes the
gameResults document BEFORE it advances the bracket, and the room document only changes 800 ms later via the debounced
`saveState()` write (same order on `finals-solo-retry`). So the function always reads the pre-game state: "current"
rankings equal `rankingsBefore`, `rankingsChanged` is false, and the shake-up notification never sends. When it does
differ it is because of some unrelated earlier edit, not this game. Two smaller problems in the same block: the message
says "<leader> takes the lead" whenever ANY position changed, even a 3rd/4th swap; and `sendEachForMulticast` caps at 500
tokens (fine for a room, noting it for the day a public room exists).

Fix in two halves. Client half (night-shift branch `finals-rankings-after`, to be staged on top of `finals-solo-retry`):
in `checkGameFinals()` compute `rankingsAfter` by running `autoAdvanceBracket(game)` + `syncGames()` BEFORE the
gameResults write and store both `rankingsBefore` and `rankingsAfter` (plus `leaderBefore`/`leaderAfter` names) in the
document. Server half (yours):

```js
  // in notifyGameFinal, replace the computeRankings/previousRankings block with:
  const previousRankings = result.rankingsBefore || [];
  const currentRankings = Array.isArray(result.rankingsAfter) && result.rankingsAfter.length
    ? result.rankingsAfter            // written by the reporting client from its post-advance state
    : computeRankings(state);         // older clients: best effort (usually equal to previousRankings)
  const leaderChanged = previousRankings[0] !== currentRankings[0];
  const rankingsChanged = previousRankings.length > 0 &&
    currentRankings.some((pid, idx) => previousRankings[idx] !== pid);
  ...
  body: leaderChanged
    ? `${leaderName} takes the lead after ${result.winnerName} wins`
    : `Standings shuffled after ${result.winnerName} wins`,
```

Then `firebase deploy --only functions`. Until both halves are in, the shake-up push is effectively off, which is harmless;
the game-final push is unaffected.
