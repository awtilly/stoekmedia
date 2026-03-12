# Requirements: March Madness PWA Enhancement

**Defined:** 2026-03-11
**Core Value:** The draft and live scoring experience must feel like a native app — instant, tactile, and always connected

## v1 Requirements

Requirements for the 2026 tournament release. Each maps to roadmap phases.

### Foundation

- [x] **FNDN-01**: Service worker uses network-first strategy for index.html so updates reach installed PWAs
- [x] **FNDN-02**: Manifest updated with enhanced splash screen branding (background_color, theme_color, larger icons, display_override)
- [x] **FNDN-03**: App shortcuts in manifest for Live Scores, Bracket, and Leaderboard tabs

### Player Identity & Draft Security

- [ ] **AUTH-01**: Creator can share a join link that opens directly to the room
- [ ] **AUTH-02**: New players enter display name + 4-digit PIN on first join via the link
- [ ] **AUTH-03**: Identity persists via localStorage — no re-entry needed after first login
- [ ] **AUTH-04**: PIN only needed to reclaim identity on new device or cleared browser
- [ ] **AUTH-05**: Only the current drafter can make a pick, enforced by Firestore security rules
- [ ] **AUTH-06**: UI disables pick controls for non-active drafters

### Draft Clock

- [ ] **DRFT-01**: Configurable timer duration per room (60s, 90s, 120s, no limit)
- [ ] **DRFT-02**: Visual countdown with color thresholds (green > yellow > red)
- [ ] **DRFT-03**: Timer syncs across all players via Firestore server timestamps (pickDeadline)
- [ ] **DRFT-04**: Auto-pick highest available seed when timer expires
- [ ] **DRFT-05**: Commissioner can pause and resume the clock
- [ ] **DRFT-06**: Audio alert at 10 seconds remaining
- [ ] **DRFT-07**: Haptic alert on timer events (conditional — drop entirely if iOS unsupported)

### Sharing & Engagement

- [ ] **SHAR-01**: Native share via Web Share API with clipboard fallback for room links
- [ ] **SHAR-02**: Share room code/link via OS share sheet (Messages, WhatsApp, etc.)
- [ ] **SHAR-03**: Share leaderboard standings as formatted text

### Live Experience

- [ ] **LIVE-01**: Screen wake lock keeps display active on Live Scores tab
- [ ] **LIVE-02**: Wake lock re-acquires automatically on tab visibility change

### Badge

- [ ] **BDGE-01**: App icon badge shows pending pick count when it's user's turn to draft
- [ ] **BDGE-02**: Badge clears when user makes their pick or turn passes

### Push Notifications

- [ ] **PUSH-01**: "It's your turn to draft" push notification when user's pick is up
- [ ] **PUSH-02**: "Game just went final" notification with score and upset alert
- [ ] **PUSH-03**: "Leaderboard shake-up" notification when rankings change
- [ ] **PUSH-04**: FCM token management — store per player per room in Firestore
- [ ] **PUSH-05**: Firebase Cloud Functions deployed for server-side push triggers
- [ ] **PUSH-06**: Contextual permission prompt (e.g., after joining draft, not on first visit)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Notifications

- **NOTF-01**: User can configure notification preferences (which events trigger push)
- **NOTF-02**: Quiet hours / do-not-disturb setting

### Sharing

- **SHAR-04**: Share bracket as screenshot via canvas capture

### Haptics

- **HAPT-01**: Granular haptic settings (enable/disable per event type)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom notification sounds | Poor browser support, default system sounds are familiar and reliable |
| Background Sync for draft picks | Not supported on iOS; Firestore handles offline writes natively |
| Periodic Background Sync for scores | Not supported on iOS; unreliable browser engagement scoring |
| Share Target (receiving shares) | No use case for incoming shared content in a bracket pool |
| Full-screen mode | Hides status bar clock — bad UX during timed drafts |
| Notification action buttons | Limited support, marginal value for significant complexity |
| Framework migration | Vanilla JS keeps it simple; no build step needed |
| Native mobile app | PWA covers mobile needs for friend-group scale |
| User accounts / Firebase Auth | Sessionless PIN model is sufficient for friend groups |
| Geolocation | No use case in a bracket pool app |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FNDN-01 | Phase 1 | Complete |
| FNDN-02 | Phase 1 | Complete |
| FNDN-03 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| AUTH-05 | Phase 2 | Pending |
| AUTH-06 | Phase 2 | Pending |
| DRFT-01 | Phase 2 | Pending |
| DRFT-02 | Phase 2 | Pending |
| DRFT-03 | Phase 2 | Pending |
| DRFT-04 | Phase 2 | Pending |
| DRFT-05 | Phase 2 | Pending |
| DRFT-06 | Phase 2 | Pending |
| DRFT-07 | Phase 2 | Pending |
| SHAR-01 | Phase 1 | Pending |
| SHAR-02 | Phase 1 | Pending |
| SHAR-03 | Phase 1 | Pending |
| LIVE-01 | Phase 1 | Pending |
| LIVE-02 | Phase 1 | Pending |
| BDGE-01 | Phase 3 | Pending |
| BDGE-02 | Phase 3 | Pending |
| PUSH-01 | Phase 3 | Pending |
| PUSH-02 | Phase 3 | Pending |
| PUSH-03 | Phase 3 | Pending |
| PUSH-04 | Phase 3 | Pending |
| PUSH-05 | Phase 3 | Pending |
| PUSH-06 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-11 after roadmap creation*
