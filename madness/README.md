# Madness

Snake-draft bracket pool PWA, live at stoekmedia.com/madness. Vanilla JS, zero runtime
dependencies, Firebase Firestore for realtime sync, ESPN public scoreboard for scores.
Deployed by GitHub Pages straight from `main`, so **merging to `main` is deploying**.

## Layout

| Path | What |
|------|------|
| `index.html` | Markup + all CSS. Loads the `js/` files in order at the bottom of `<body>`. |
| `js/00-constants.js` | Round names, regions, R1 seed pairings, feeder map. |
| `js/10-espn.js` | ESPN adapter: scoreboard fetch, tournament team import, event parsing. |
| `js/20-live.js` | Live score polling, game-final detection, bracket auto-advance, wake lock. |
| `js/30-state.js` | The global `S` state object, Firebase init, FCM push, badge, notification prompt. |
| `js/40-ui.js` | Toast and in-app modal primitives. |
| `js/50-auth.js` | PIN hashing, admin PIN flow, player identity, join screen. |
| `js/60-rooms.js` | localStorage/Firestore persistence, room create/join/listen, lobby. |
| `js/70-logic.js` | Pure game logic: snake order, bracket slots and cascades, `syncGames`, `scores`. |
| `js/80-pages.js` | `render()` and every page renderer (draft, bracket, leaderboard, live, settings). |
| `js/90-boot.js` | URL param boot, service worker registration, install banner. |
| `sw.js` | Service worker: FCM background handler + app cache. |
| `functions/` | Cloud Functions (draft-turn and game-final push). Has its own package.json. |
| `firestore.rules` | Security rules. |
| `test/` | Node unit tests for the pure logic. |
| `scripts/stamp.js` | Maintains the `?v=` cache-busting hash on the script tags. |

The `js/` files are **classic scripts, not ES modules**. They share one global scope,
exactly as if they were still one `<script>` block, because the markup uses inline
`onclick="fn()"` handlers that need global functions. Load order is the filename prefix.
A function in `20-live.js` may freely call one declared in `70-logic.js`; only top-level
code (which is nearly all in `30-state.js` and `90-boot.js`) depends on order.

## Editing the JS

1. Edit files in `js/`.
2. Run `node scripts/stamp.js`. This rewrites the `?v=` hash on every `js/` script tag in
   `index.html`. **Skipping this ships stale code**: `sw.js` serves `js/*` cache-first, so
   an installed PWA keeps using the old file until the URL changes. `index.html` itself is
   network-first, so a new hash in it is enough to pull the new files.
3. Run `node --test "test/*.test.js"`. The suite fails if the stamp is out of date.
4. Merging two branches that both touched `js/` conflicts on the stamped script tags in
   `index.html` and nowhere else. Run `node scripts/stamp.js` again: it collapses a conflict
   block made only of those tags, then `git add index.html` and finish the merge.

## Tests

```
node --test "test/*.test.js"
```

`test/_harness.js` evaluates `00`, `10`, `20` and `70` in the Node process with stubs for
`S`, `requireAdmin`, `saveState`, `render`, `fetch`, etc. Covered so far: snake-draft order,
scoring (per round, upset bonus, custom values), bracket slot resolution, manual advance
and cascade clearing through the Final Four, ESPN-driven auto-advance, ESPN scoreboard
parsing and tournament-team import filtering (the conference-tournament bug from 2026).

Not covered: anything that touches Firestore transactions (`pickTeam`, `undoDraft`,
`autoPickHighestSeed`), the PIN flow, and all rendering.

## Rules of the road

- Never auto-merge. Every change is a PR for Joe to review.
- No npm dependencies in the web app. `package.json` here has none and must stay that way.
- `firestore.rules`, `functions/`, and the `CACHE_NAME` in `sw.js` are Joe-only edits.
- Feature and refactor freeze from 2027-02-15 until the tournament ends. Bug reports only.
