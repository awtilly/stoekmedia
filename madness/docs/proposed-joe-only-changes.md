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
