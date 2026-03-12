# Roadmap: March Madness PWA Enhancement

## Overview

This roadmap delivers the 2026 tournament-ready PWA in three phases, ordered by the critical dependency chain: fix the cache so updates reach users, build the draft experience (identity + clock), then layer on re-engagement (badge + push). Phase 1 must ship before Selection Sunday so the manifest is correct when users install. Phase 2 must be complete before draft day. Phase 3 can ship mid-tournament.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Client-Side Enhancements** - Cache fix, manifest polish, native share, wake lock, haptics
- [ ] **Phase 2: Player Identity & Draft Clock** - Join flow, PIN security, Firestore rules, timed draft with auto-pick
- [ ] **Phase 3: Badge & Push Notifications** - App icon badge, FCM setup, Cloud Functions, notification UX

## Phase Details

### Phase 1: Foundation & Client-Side Enhancements
**Goal**: Users get reliable updates on every visit, a polished install experience, and native-feeling interactions (share, haptics, wake lock)
**Depends on**: Nothing (first phase)
**Requirements**: FNDN-01, FNDN-02, FNDN-03, SHAR-01, SHAR-02, SHAR-03, LIVE-01, LIVE-02
**Success Criteria** (what must be TRUE):
  1. A user who already has the PWA installed sees new features after reopening the app (no stale cache)
  2. User can long-press the app icon on Android and jump directly to Live Scores, Bracket, or Leaderboard
  3. User can tap a share button and send a room invite via the OS share sheet (or clipboard on unsupported browsers)
  4. User can share leaderboard standings as formatted text via the OS share sheet
  5. The phone screen stays on while the Live Scores tab is active, even if the user does not touch the screen
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Service worker rewrite (network-first), manifest branding, app shortcuts, tab param handler
- [ ] 01-02-PLAN.md -- Native share (room links + leaderboard), screen wake lock with visibility re-acquisition

### Phase 2: Player Identity & Draft Clock
**Goal**: Players join rooms via shareable links, maintain persistent identity, and draft under time pressure with a synced countdown clock
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, DRFT-01, DRFT-02, DRFT-03, DRFT-04, DRFT-05, DRFT-06, DRFT-07
**Success Criteria** (what must be TRUE):
  1. A new player can open a shared room link, enter a display name and PIN, and land inside the room ready to draft
  2. A returning player on the same device is recognized automatically without re-entering credentials
  3. A player on a new device can reclaim their identity by entering their name and PIN
  4. Only the player whose turn it is can make a draft pick -- all other players see disabled pick controls
  5. A visible countdown timer ticks down during each pick, changes color as time runs low, plays an audio alert at 10 seconds, and auto-picks the highest available seed on expiry
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

### Phase 3: Badge & Push Notifications
**Goal**: Users who step away from the app are pulled back in by icon badges and push notifications for draft turns, game results, and leaderboard changes
**Depends on**: Phase 2
**Requirements**: BDGE-01, BDGE-02, PUSH-01, PUSH-02, PUSH-03, PUSH-04, PUSH-05, PUSH-06
**Success Criteria** (what must be TRUE):
  1. When it is the user's turn to draft, the app icon shows a badge (clears after picking or when the turn passes)
  2. A user who has closed the app receives a push notification when it becomes their turn to draft
  3. A user receives push notifications for game final scores and leaderboard changes
  4. The app asks for notification permission at a contextually appropriate moment (after joining a draft, not on first visit), with guided onboarding for iOS users who must install the PWA first
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Client-Side Enhancements | 0/2 | Not started | - |
| 2. Player Identity & Draft Clock | 0/? | Not started | - |
| 3. Badge & Push Notifications | 0/? | Not started | - |
