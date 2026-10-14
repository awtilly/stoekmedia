# Madness render performance review

Night-shift findings, 2026-10-14. No code changed. Evidence from grep over `js/` on the
`madness/modularize` branch. Verdict up front: **nothing here is worth a PR before the sync fix**;
the app is small (64 teams, under 20 players) and every hot path is linear in those numbers.
Listed so the category is covered and so nobody "optimises" the wrong thing.

| # | Severity | Finding | Why it is tolerable |
|---|----------|---------|---------------------|
| 1 | Low | `render()` has 46 call sites and rebuilds the entire app shell via `innerHTML` every time, including on every Firestore snapshot. Scroll position and focused inputs are lost on each remote update (e.g. typing a player name while someone else picks). | Snapshots arrive at most once per pick / admin edit. The input-loss is a UX bug worth a targeted fix (re-focus by id after render, already done for `#pn` and `#tn`), not a virtual-DOM rewrite. |
| 2 | Low | Bracket page: `slotHTML` is called 60 times per region and each call runs `owner()` (scans all players' rosters), `getMyPlayerId()` (localStorage read) and `S.players.find`. Roughly 60 × (players × roster) lookups per render. | With 10 players × 6 teams that is ~3,600 array hits, well under a millisecond. Precomputing an `ownerByTeamId` map once per render would cut it to 60 lookups; a 15-line change if the bracket ever feels slow on old phones. |
| 3 | Low | `S.teams.find` (11) and `S.players.find` (12) sites in `80-pages.js`, all inside templates. Same shape as 2. | Same reasoning. A `teamById` map built once per render is the fix if needed. |
| 4 | Low | Live tab re-renders the whole scores grid every 30 s (`renderLive(c)`), and with PR #3 on every cache snapshot (once a minute). Team logos are `<img loading="lazy">` from ESPN's CDN and are re-requested from browser cache on each render. | Browser cache makes the image reloads free; a full day is ~100 cards. Only visible cost is a flicker on the tab; could be avoided by diffing per card id, not worth it. |
| 5 | Low | `localStorage.setItem('mm4', JSON.stringify(S))` runs on every `saveState()` and every snapshot (3 sites). Full state serialises to roughly 40 KB with 64 teams and logos. | Synchronous but sub-millisecond on modern phones; iOS Safari's localStorage is the slowest and still fine at this size. |
| 6 | Info | Draft clock ticks every 250 ms but only updates one element's text; it does not call `render()`. Good. | No action. |
| 7 | Info | Firestore persistence `synchronizeTabs: true` plus a 4,640-line `index.html` (CSS is 2,000 of those lines) means first paint is dominated by the Firebase CDN scripts (~400 KB), not our code. | If load time ever matters, the real lever is the Firebase SDK (modular v10 tree-shaken build would need a bundler, which the zero-dependency rule forbids). Leave it. |

## If a perf PR is ever wanted (in order of value)

1. Preserve input focus/caret and `.content-scroll` scroll position across `render()` (UX, not speed).
2. Build `ownerByTeamId` and `teamById` once at the top of `render()` and pass them down (findings 2-3).
3. Per-card keyed update on the Live tab to stop the 30 s flicker (finding 4).
