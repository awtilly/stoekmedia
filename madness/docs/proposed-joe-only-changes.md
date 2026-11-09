# Proposed edits to the Joe-only files (sw.js, firestore.rules, functions/index.js)

Night shift never edits these. Each block below is ready to paste; apply in the order listed.

## 1. firestore.rules: scoreboard cache read access (needed by PR #3)

> **DONE 2026-10-31.** Joe applied an equivalent rule directly on `main` (commit 86e46c6a, `match /scoreboard/{doc}`) and deployed it, and deployed `pollScoreboard` the same night (`firebase functions:list` shows it scheduled on nodejs22). The scheduler fires every minute and exits without writing until the March/April window opens or `scoreboard/_config.enabled` is `true`, so an empty `scoreboard` collection in the off-season is expected. Kept below for the record.

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
gameResults write and store both `rankingsBefore` and `rankingsAfter` in the document (player ids only; the
function resolves the leader name from room state as it does today). Server half (yours):

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

## 7. sw.js: push and offline-shell fixes from the Shift 12 review (2026-10-17)

All five are inside `sw.js`, so they are yours. 7a and 7b change what users see today; the rest are housekeeping.
Bump `CACHE_NAME` once for the whole batch (shares the bump in 2).

### 7a. The badge call throws before the notification is shown (every push lost on browsers without the Badging API)

`onBackgroundMessage` calls `self.navigator.setAppBadge(...)` unguarded whenever the payload has `badgeCount`. Firefox
(desktop and Android) and Safari before 16.4 have no `setAppBadge` on the worker navigator, so the call is a
synchronous `TypeError`; the `.catch` never attaches, and the throw happens **before** `showNotification`, so those
users get no notification at all (Chrome then shows its own "This site has been updated in the background").

```diff
-  if (data.badgeCount) {
+  if (data.badgeCount && 'setAppBadge' in self.navigator) {
     self.navigator.setAppBadge(parseInt(data.badgeCount)).catch(() => {});
   }
```

### 7b. Return the notification promise so the push event waits for it

The handler calls `self.registration.showNotification(title, options)` without returning it. Firebase wraps the push
in `event.waitUntil(handler(payload))`; with `undefined` returned, the event settles immediately and the worker can be
torn down before the notification is posted (seen as missing or duplicate "updated in the background" toasts).

```diff
-  self.registration.showNotification(title, options);
+  return self.registration.showNotification(title, options);
```

### 7c. The offline shell is frozen at service-worker install time

Network-first navigations store the response under the navigation URL (`./`, `./?room=ABC`, ...), but the offline
fallback always reads `caches.match('./index.html')`, which only the install-time precache ever writes. Offline users
therefore get the `index.html` from whenever `CACHE_NAME` last changed, not the last page they loaded online. It still
runs (its old `?v=` js entries are never evicted), but every stamp-only deploy is invisible offline until you bump the
cache name. Also, each distinct `?room=` URL adds a cache entry that nothing evicts.

```diff
           if (response.ok) {
             const clone = response.clone();
-            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
+            caches.open(CACHE_NAME).then(c => c.put('./index.html', clone));
           }
```

Keying every navigation under `./index.html` keeps one fresh shell and stops the per-room growth.

### 7d. Notification click focuses the first Madness tab even if it is a different room

`notificationclick` focuses any window whose URL contains `/madness/` and ignores `data.url`. With two rooms open, or
a tab parked on Live Scores, the tap lands on the wrong page. Navigate the focused client when the URL differs:

```diff
         if (client.url.includes('/madness/') && 'focus' in client) {
-          return client.focus();
+          return client.focus().then(c => (c && 'navigate' in c && !c.url.endsWith(url)) ? c.navigate(url) : c);
         }
```

(`url` is relative to the worker scope, so compare after `new URL(url, self.registration.scope).href` if you want it exact.)

### 7e. `firebase-messaging-compat.js` is loaded by `index.html` but not precached

`PRECACHE_URLS` lists app-compat and firestore-compat only. The messaging script is fetched by a plain `<script>` tag
(no-cors, opaque response), and the runtime cache skips opaque responses (`response.ok` is false), so it is never cached
and fails to load offline. Harmless today because `initFCM` is guarded, but it is a console error on every offline open.

```diff
   'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
-  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js'
+  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
+  'https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js'
 ];
```

Reviewed and left alone: `skipWaiting` + `clients.claim` are fine because `90-boot.js` only shows a "Refresh" banner
and never reloads a live draft; the Firestore pass-through test; the `response.ok && GET` guard on runtime caching.

## 8. functions/package.json + firebase.json: move off the nodejs20 runtime before 2026-10-30 (found Shift 36, 2026-10-26)

> **DONE 2026-10-30.** Applied by PR #49 (`madness/node22-runtime`, merged 2026-10-30) and deployed; `firebase functions:list` showed both `notifyDraftTurn` and `notifyGameFinal` on `nodejs22` the same night. Kept below for the record; nothing left to do here. `pollScoreboard` was deployed 2026-10-31 as well (see section 1).

**(Was time-critical.)** Google's Cloud Functions runtime table lists `nodejs20` as deprecated 2026-04-30 and
**decommissioned 2026-10-30**. After that date you cannot create or update a function on that runtime, and
workloads still on it "may be disabled". Both live functions (`notifyDraftTurn`, `notifyGameFinal`, checked with
`firebase functions:list` on 2026-10-26) run on `nodejs20`, and PR #3 (`espn-cache`) pins the same runtime, so its
`firebase deploy --only functions` would be refused once the date passes.

`nodejs22` is supported until 2027-10-31 (deprecation 2027-04-30), which covers the 2027 tournament. The installed
Firebase CLI (15.29.0) knows the runtime. `firebase-functions ^6` and `firebase-admin ^12` both run on Node 22, and
the code uses nothing version-specific (`require`, global `fetch`, Firestore v2 triggers).

```diff
--- madness/functions/package.json
-  "engines": { "node": "20" },
+  "engines": { "node": "22" },
```

```diff
--- madness/firebase.json
   "functions": {
     "source": "functions",
-    "runtime": "nodejs20"
+    "runtime": "nodejs22"
   },
```

Then, from `madness/`:

```sh
firebase deploy --only functions --project march-madness-snake-draft
firebase functions:list --project march-madness-snake-draft   # both rows should now say nodejs22
```

Apply the same two-line change to PR #3's copy of `functions/package.json` when you merge it (its `firebase.json`
is the same file). If you deploy after 2026-10-30 without this change the deploy fails with a runtime error rather
than silently keeping the old version, so the risk is downtime of the push notifications, not corruption.
## 9. functions/ncaa.js: the proxy has no cache in front of it (found Shift 48, 2026-11-01)

Context: main ea7ce33d (merged #53, 2026-10-31) added the `ncaa` HTTPS function that forwards the two ncaa-api
routes the clients use (one day's scoreboard for the Live tab's fallback poll, one year's bracket for the import).
Its header comment and the response header say "cached at the edge for 30 s", but a plain
`https://us-central1-….cloudfunctions.net/ncaa/...` URL has no CDN in front of it: Cloud Functions only honours
`Cache-Control` when the function sits behind Firebase Hosting rewrites. Probed 2026-11-01 00:10 EDT: repeated GETs of
the same scoreboard route each took ~2 s (a fresh upstream fetch every time) and no `Age` header ever came back.

Why it matters: the public ncaa-api instance allows ~3 requests/s per IP. Normally the clients never reach this proxy
during the tournament (they read the `scoreboard/{date}` document that `pollScoreboard` writes once a minute). But the
moment that document is missing or more than 3 minutes old (function outage, Scheduler hiccup, or a date it does not
cover), every open Live tab falls back to polling the proxy every 30 s, and all of those become separate upstream
calls from the function's egress IP. A few dozen phones in fallback is enough to be rate-limited (429 → the proxy
answers 502 → every Live tab shows "scores unavailable"), which is exactly the moment the fallback exists for.

Fix (zero dependencies, functions/ only): a per-instance in-memory cache keyed by path, 30 s TTL, and serve the last
good body when the upstream is in trouble so a rate-limit never blanks the Live tab. With `maxInstances: 5` the
worst case becomes 5 upstream calls per 30 s per route, independent of how many phones are polling.

Revised Shift 60 (2026-11-09); this replaces the first version of the diff. Four things changed:

- **The cache is bounded** (`CACHE_MAX = 64` routes, the oldest is dropped). The first version kept every route it
  had ever answered for the life of the instance; phones only ask for today, yesterday and a picked day, so 64 never
  drops a route in use, and the instance's memory no longer depends on how many different dates were requested.
- **A failing upstream is asked once per 30 s per route, not once per phone.** The first version went back to the
  upstream on every request once the 30 s had passed, also while it was answering 429, which is the one moment the
  extra calls hurt. Now a stale answer also restarts the 30 s wait (`checked`).
- **A 404/403 for a route that answered 200 a moment ago serves the last body** instead of an empty day. For
  seasons after 2025 the upstream answers a day without games with 200 and an empty list, and 404 when its own
  request to NCAA.com failed (§11 has the detail), so a 404 right after a 200 is an outage, not an off day.
- **Stale has an age limit** (`STALE_MAX_MS`, 10 minutes). After that the relay answers what it answers today
  (502, or the empty day with `upstreamStatus`), and the app shows its "Scores unavailable" line instead of a
  scoreboard frozen at some earlier minute.

The diff below is the real `git diff` of the change (it applies with `git apply` from the repo root). It was
run against a copy of `functions/ncaa.js` as deployed on main 0354aeef with a stubbed `fetch` and clock, 7 checks:
hit inside 30 s, refetch after, stale on 429 / 500 / network error / 404, no stale after 10 minutes, the plain 404
answer unchanged when nothing is cached, never more than 64 entries with the most recent kept, a route that keeps
being refreshed is never the one dropped, and 40 requests during a 429 make one upstream call. `functions/` itself
was not touched.

```diff
--- a/madness/functions/ncaa.js
+++ b/madness/functions/ncaa.js
@@ -12,6 +12,21 @@
 const { onRequest } = require('firebase-functions/v2/https');
 const { NCAA_API_BASE, FETCH_HEADERS, allowedPath } = require('./scoreboard-logic');
 
+// Per-instance response cache. cloudfunctions.net URLs have no CDN, so the Cache-Control header below only helps
+// the browser; this keeps N phones in fallback from becoming N upstream calls (ncaa-api allows ~3 req/s per IP).
+const CACHE_TTL_MS = 30 * 1000;
+const STALE_MAX_MS = 10 * 60 * 1000; // how old a body may be and still be served when the upstream is in trouble
+const CACHE_MAX = 64;                // entries; phones only ask for today, yesterday and a picked day
+const _cache = new Map(); // path -> { body, at, checked }, oldest first
+
+function sendStale(res, hit) {
+  if (!hit || Date.now() - hit.at > STALE_MAX_MS) return false;
+  hit.checked = Date.now();            // do not ask a struggling upstream again for this route for 30 s
+  res.set('X-Cache', 'stale');
+  res.type('application/json').status(200).send(hit.body);
+  return true;
+}
+
 const ALLOWED_ORIGINS = [
   /^https:\/\/([a-z0-9-]+\.)?stoekmedia\.com$/,
   /^capacitor:\/\/localhost$/,
@@ -30,19 +45,37 @@ exports.ncaa = onRequest({
   if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
   const p = String(req.path || '').replace(/\/+$/, '');
   if (!allowedPath(p)) { res.status(404).json({ error: 'route not available' }); return; }
+  const hit = _cache.get(p);
+  if (hit && Date.now() - hit.checked < CACHE_TTL_MS) {
+    res.set('Cache-Control', 'public, max-age=30');
+    res.set('X-Cache', hit.checked === hit.at ? 'hit' : 'stale');
+    res.type('application/json').status(200).send(hit.body);
+    return;
+  }
   try {
     const r = await fetch(NCAA_API_BASE + p, { headers: FETCH_HEADERS });
     if (r.status === 404 || r.status === 403) {
+      // This route answered 200 a moment ago, so this 404 is the upstream failing to reach NCAA.com, not an off day.
+      if (sendStale(res, hit)) return;
       // ncaa.com: no page for that date/year yet (off day, or the bracket is not published). Empty, not an error.
       res.set('Cache-Control', 'public, max-age=60');
       res.status(200).json(p.startsWith('/brackets') ? { championships: [], upstreamStatus: r.status } : { games: [], upstreamStatus: r.status });
       return;
     }
-    if (!r.ok) { res.status(502).json({ error: 'upstream ' + r.status }); return; }
+    if (!r.ok) {
+      // Rate-limited or upstream trouble: a slightly stale scoreboard beats an empty Live tab.
+      if (sendStale(res, hit)) return;
+      res.status(502).json({ error: 'upstream ' + r.status }); return;
+    }
     const body = await r.text();
+    _cache.delete(p);                                  // re-insert = most recent
+    const t = Date.now();
+    _cache.set(p, { body, at: t, checked: t });
+    if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value); // drop the oldest; memory stays bounded
     res.set('Cache-Control', 'public, max-age=30');
     res.type('application/json').status(200).send(body);
   } catch (err) {
+    if (sendStale(res, hit)) return;
     res.status(502).json({ error: String(err && err.message || err) });
   }
 });
```

Then `firebase deploy --only functions:ncaa --project march-madness-snake-draft`, and `curl -sI` the scoreboard
route twice within 30 s: the second answer should carry `X-Cache: hit` and return in well under a second.

Optional, same spirit: the `pollScoreboard` scheduler is the only caller that *should* hit ncaa-api during the
tournament, and it already does so at most twice a minute, so it needs no change. Cosmetic: `firestore.rules`
line 46 still says "Cached ESPN scoreboard"; it is a comment, change it whenever the rules are next edited.

## 10. functions/ncaa-parse.js: conference tournament games are not NCAA tournament games (found Shift 49, 2026-11-01)

`functions/ncaa-parse.js` is the server copy of `ncaa.parseScoreboard()` in `js/10-ncaa.js`, and during the tournament
every phone reads ITS output from `scoreboard/{date}`. Replaying the real 2026 scoreboards (Selection Sunday eve through
the title game, fetched through the `ncaa` proxy) through the app's own `checkGameFinals()` produced 90 gameResult writes
instead of the expected 67 (63 tournament games + 4 First Four games). The 23 extras were the conference tournament
semifinals and finals of 3/14-3/15: ncaa.com lists those with a `bracketRound` (their own bracket, 1-6) but an EMPTY
`bracketId`, and the parser set `tournament` when any of `bracketId`, `bracketRound` or `championshipId` was truthy.
Consequences on Selection Sunday 2027 as deployed: a "Game Final" / "UPSET!" push and a `gameResults` document for
every conference game involving a room team, and 8 conference games between two bracket teams parked in
`_pendingAdvance`, from where they would fill a later bracket slot with the *conference* result the moment the two
teams were drawn to meet again (Houston-Arizona, Purdue-Michigan, UConn-St. John's, Virginia-Duke ... in 2026).

Second, smaller: ncaa.com spells the round title `First Four&#174;`, and the Live tab escapes the note, so the four
First Four cards read "NCAA Tournament - First Four&#174;" literally.

The `madness/ncaa-conf-guard` branch makes both fixes in the client copy with a regression test on five untouched games
from the real payloads (`test/fixtures/ncaa-scoreboard-selection-sunday.json`, `test/conf-tournament-flag.test.js`).
The server copy needs the identical two lines. In `functions/ncaa-parse.js`:

```diff
-    const tournament = !!(g.bracketId || g.bracketRound || g.championshipId);
-    const roundTitle = g.championshipGame && g.championshipGame.round && g.championshipGame.round.title || '';
+    const tournament = parseInt(g.bracketId, 10) > 0;
+    // ncaa.com writes "First Four&#174;"; the Live tab escapes the note, so strip the entity rather than print it.
+    const roundTitle = String(g.championshipGame && g.championshipGame.round && g.championshipGame.round.title || '').replace(/&#174;|&reg;|®/g, '').trim();
```

and in the header comment replace "Only NCAA tournament games carry bracketId/championshipId" with the wording now in
`js/10-ncaa.js` (numeric `bracketId` only; conference games carry a `bracketRound` and no `bracketId`). Then remove the
`{ todo: ... }` option from the last test in `test/conf-tournament-flag.test.js` (it asserts the server copy and is
marked todo until this lands), run `node --test "test/*.test.js"`, and deploy:

```sh
firebase deploy --only functions:pollScoreboard --project march-madness-snake-draft
```

Nothing is urgent before March; `pollScoreboard` does not write outside the 3/10-4/10 window. The replay script that
found this is `caddyshack/tools/night-shift/progress/madness-scripts/ncaa-tournament-replay.js` (`--harness` points it
at any checkout); with the fix it reports 67 writes, 0 pending, champion Michigan, in order and out of order.

## 11. functions/scoreboard.js: a failing upstream must not be written as an empty day (found Shift 59, 2026-11-08)

`pollScoreboard` treats a 403/404 from ncaa-api as "no scoreboard page for that date" and writes an empty day, so
phones stay on the cache on an off day. That was true of the old ncaa.com feed. Today (checked 2026-11-08 against the
live proxy and the ncaa-api source, `src/index.ts` scoreboard route):

- a day without games is a plain **200** with `"games": []` (2026/07/15 and 2027/03/20 both answer that way);
- a **404** is what ncaa-api returns for the current season when its own fetch of the NCAA feed fails: the new feed
  throws, it falls through to the old endpoint logic, and that returns 404 for any year after 2025.

So in March 2027 the 404 branch can only fire when the NCAA feed has a bad minute, and what it does then is replace
`scoreboard/{today}` with zero events. Every phone gets that document from the server, treats it as current, shows
"No games found" in the middle of a game and stays off the fallback poll. Nothing is logged, because the branch is
silent. A longer outage reads as an empty day for as long as it lasts instead of "last known scores, unavailable". The
sustained case is not far-fetched: ncaa-api reads the NCAA feed through a fixed persisted-query id, and when NCAA
changes that id every scoreboard request fails this way until ncaa-api is updated and its public instance redeployed.

The `madness/live-empty-day-guard` branch covers the phones (an empty document does not replace the same day's games,
and the proxy's `upstreamStatus` answer counts as a failed poll). The function should stop writing the empty day over
a good one. In `functions/scoreboard.js`:

```diff
       const r = await fetch(scoreboardUrl(ymd), { headers: FETCH_HEADERS });
       if (r.status === 404 || r.status === 403) {
-        // ncaa.com answers 403/404 for a date with no scoreboard page (an off day between rounds):
-        // write an empty day so phones stay on the cache instead of falling back to direct polling.
+        // A day without games is a 200 with an empty list. 403/404 is ncaa-api failing to reach the NCAA feed
+        // (or, on the old feed, a date with no page): never let it replace games that are already cached.
+        const prev = await db.doc(`scoreboard/${ymd}`).get();
+        if (prev.exists && (prev.data().eventCount || 0) > 0) {
+          console.warn(`NCAA ${ymd} responded ${r.status}; keeping the ${prev.data().eventCount} games already cached`);
+          continue;
+        }
         data = { games: [] };
```

The extra read only happens on a 403/404 tick. An off day (no document yet, or an empty one) is still written empty,
so nothing changes there.

Second, smaller, same file: the two `fetch` calls have no timeout and the function has 30 seconds for both dates.
Before 4 am ET the list is [today, yesterday], and yesterday is the one with the late game still being played; a stalled
request for today uses up the whole invocation and yesterday is not polled that minute. Give each request its own limit:

```diff
-      const r = await fetch(scoreboardUrl(ymd), { headers: FETCH_HEADERS });
+      const r = await fetch(scoreboardUrl(ymd), { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
```

(the existing `catch` already logs and moves on to the next date). Deploy with section 10:

```sh
firebase deploy --only functions:pollScoreboard --project march-madness-snake-draft
```

Nothing is urgent before March; `pollScoreboard` does not write outside the 3/10-4/10 window.
