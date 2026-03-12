# March Madness Snake Draft — PWA Enhancement

## What This Is

A real-time multiplayer NCAA March Madness bracket pool web app with snake draft mechanics. Players join rooms, draft tournament teams in snake order, fill out brackets, and track scores as games play out. Built as a zero-dependency vanilla JS PWA with Firebase Firestore for real-time sync and ESPN API for live scores. Deployed at stoekmedia.com/madness via GitHub Pages.

## Core Value

The draft and live scoring experience must feel like a native app — instant, tactile, and always connected — so friend groups stay engaged from Selection Sunday through the championship.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Snake draft with configurable player count and draft order — existing
- ✓ Real-time Firestore sync across all connected players — existing
- ✓ ESPN API auto-import of all 64 tournament teams (seeds, regions, logos) — existing
- ✓ Interactive bracket with round-by-round advancement — existing
- ✓ Live scores tab with 30-second auto-refresh — existing
- ✓ Configurable scoring (Doubling, Linear, Back-loaded, Flat + upset bonus) — existing
- ✓ Room-based multi-tenancy with short room codes — existing
- ✓ Admin PIN security with SHA-256 hashing — existing
- ✓ Player identity via passphrases + localStorage — existing
- ✓ PWA installable with offline support — existing
- ✓ Responsive mobile-first layout with bottom nav — existing
- ✓ Multi-tournament support — existing
- ✓ First Four play-in team support — existing
- ✓ Clipboard room link sharing — existing

### Active

<!-- Current scope. Building toward these for 2026 tournament. -->

- [ ] Draft clock with configurable timer, auto-pick highest seed on expiry
- [ ] Haptic feedback on draft picks, bracket actions, and UI interactions
- [ ] Native share via Web Share API with clipboard fallback
- [ ] App shortcuts for Live Scores, Bracket, Leaderboard via manifest.json
- [ ] Enhanced splash screen with better branding and display_override
- [ ] Screen wake lock on Live Scores tab
- [ ] App icon badge for pending draft picks (your turn)
- [ ] Push notifications for draft turns, game finals, and leaderboard changes

### Out of Scope

- Mobile native app (Capacitor/React Native) — web-first, PWA covers mobile needs
- User accounts / auth system — sessionless passphrase model works for friend groups
- Payment / monetization — this is for fun, not profit
- Framework migration (React, Vue, etc.) — vanilla JS keeps it simple and fast
- Server-side rendering — static hosting via GitHub Pages is sufficient

## Context

- **Deployment:** GitHub Pages at stoekmedia.com/madness (part of stoekmedia monorepo)
- **Architecture:** Single-file SPA (index.html, ~3,500 lines). Global state object `S` persisted to localStorage and synced to Firestore. One `render()` function rebuilds DOM via template literals.
- **Firebase project:** `march-madness-snake-draft` — Firestore and Storage confirmed. Cloud Functions status unknown (needed for push notifications).
- **Scale:** 10-20 concurrent rooms during tournament
- **Timeline:** Must be ready for 2026 NCAA tournament. Selection Sunday is imminent. Drafts happen after bracket reveal, giving ~1 week for implementation.
- **ESPN API:** Public endpoint at site.api.espn.com, used client-side for team import and live scores.

## Constraints

- **Timeline**: 2026 tournament ready — Selection Sunday is days away
- **Architecture**: Single-file vanilla JS approach preferred for simplicity; may split into modules if maintainability requires it
- **Hosting**: GitHub Pages (static only) — backend logic must use Firebase Cloud Functions
- **Dependencies**: Zero npm dependencies; Firebase SDK loaded via CDN
- **Compatibility**: Must work on iOS Safari, Chrome Android, and desktop Chrome (the PWA surfaces)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Auto-pick highest seed on draft clock expiry | Fair, deterministic, no gaming the system | — Pending |
| Keep single-file architecture initially | Zero-build simplicity; split later if needed | — Pending |
| Firebase Cloud Messaging for push | Already using Firebase ecosystem; natural fit | — Pending |
| Web Share API with clipboard fallback | Progressive enhancement; works everywhere | — Pending |

---
*Last updated: 2026-03-11 after initialization*
