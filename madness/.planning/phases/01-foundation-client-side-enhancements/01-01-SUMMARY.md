---
phase: 01-foundation-client-side-enhancements
plan: 01
subsystem: pwa
tags: [service-worker, manifest, pwa, caching, network-first, app-shortcuts]

# Dependency graph
requires: []
provides:
  - "Network-first service worker (fresh HTML when online, cached fallback offline)"
  - "Enhanced PWA manifest with dark branding, maskable icon, and 3 app shortcuts"
  - "Tab-param boot handler (?tab=live|bracket|leaderboard) for shortcut navigation"
affects: [01-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Network-first for HTML, cache-first for static assets (SW caching strategy)"
    - "Query param routing (?tab=X) for SPA shortcut navigation"

key-files:
  created: []
  modified:
    - sw.js
    - manifest.json
    - index.html

key-decisions:
  - "Reused icon-512.png as maskable icon (adequate padding to be validated later)"
  - "Live scores shortcut works without room context since live tab is room-independent"

patterns-established:
  - "SW caching: network-first for navigate, cache-first for CDN scripts, passthrough for Firestore API"
  - "Shortcut URLs use ?tab= query params resolved at boot before render()"

requirements-completed: [FNDN-01, FNDN-02, FNDN-03]

# Metrics
duration: 2min
completed: 2026-03-12
---

# Phase 1 Plan 1: PWA Foundation Summary

**Network-first service worker fixing stale-cache bug, dark-themed manifest with maskable icon and 3 app shortcuts, and tab-param boot handler for direct navigation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-12T01:03:54Z
- **Completed:** 2026-03-12T01:06:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Rewrote service worker from cache-first (stale installs) to network-first for HTML with cache-first for static assets
- Enhanced manifest with dark branding (#1a1a1a background), display_override, orientation, maskable icon, and 3 shortcuts
- Added boot handler that reads ?tab= query param and auto-navigates to Live Scores, Bracket, or Leaderboard tabs
- Live scores shortcut works even without a room context (no-room fallback)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite service worker to network-first for HTML** - `ed7e690` (feat)
2. **Task 2: Enhance manifest and add tab-param boot handler** - `30c19b4` (feat)

## Files Created/Modified
- `sw.js` - Rewritten with network-first for navigation, cache-first for static assets, Firestore passthrough, cache v4
- `manifest.json` - Dark background, display_override, orientation, maskable icon, 3 app shortcuts with ?tab= URLs
- `index.html` - Boot section reads ?tab= param, navigates to specified tab; live tab works without room

## Decisions Made
- Reused existing icon-512.png as maskable icon rather than generating a new one with safe-zone padding (per research open question #1, can be validated later with maskable.app)
- Live scores shortcut navigates directly even without room context, since live tab is room-independent; other tabs (bracket, leaderboard) require room context and fall through to lobby

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- PWA foundation is complete: service worker, manifest, and shortcut routing all in place
- Ready for plan 01-02 (Web Share API and Screen Wake Lock)
- Manifest should be finalized before Selection Sunday installs (iOS reads manifest only at install time)

## Self-Check: PASSED

- All 4 files verified present (sw.js, manifest.json, index.html, 01-01-SUMMARY.md)
- Both task commits verified (ed7e690, 30c19b4)
- All 15 automated verification checks passed

---
*Phase: 01-foundation-client-side-enhancements*
*Completed: 2026-03-12*
