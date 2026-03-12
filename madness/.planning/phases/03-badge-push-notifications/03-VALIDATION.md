---
phase: 3
slug: badge-push-notifications
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — no test infrastructure exists; all phase behaviors are manual-only |
| **Config file** | none — Wave 0 sets up Firebase CLI in `madness/` |
| **Quick run command** | `firebase functions:log --project march-madness-snake-draft` |
| **Full suite command** | Manual smoke test matrix (see Manual-Only Verifications) |
| **Estimated runtime** | ~5 minutes per platform (manual) |

---

## Sampling Rate

- **After every task commit:** Manual smoke test — open app, verify notification flow
- **After every plan wave:** Full manual test matrix across iOS Safari PWA + Chrome Android + Chrome Desktop
- **Before `/gsd:verify-work`:** All notification types verified on at least one mobile platform
- **Max feedback latency:** N/A (manual testing)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | PUSH-04 | smoke | Check Firestore console for token doc | N/A | ⬜ pending |
| 3-01-02 | 01 | 1 | PUSH-06 | manual | Join room, verify permission prompt | N/A | ⬜ pending |
| 3-01-03 | 01 | 1 | BDGE-01 | manual | Install PWA, start draft, verify badge | N/A | ⬜ pending |
| 3-01-04 | 01 | 1 | BDGE-02 | manual | Make pick, verify badge clears | N/A | ⬜ pending |
| 3-02-01 | 02 | 2 | PUSH-05 | smoke | `firebase deploy --only functions` succeeds | N/A | ⬜ pending |
| 3-02-02 | 02 | 2 | PUSH-01 | manual | Close app, another player picks, verify notification | N/A | ⬜ pending |
| 3-03-01 | 03 | 2 | PUSH-02 | manual | Trigger game final, verify notification | N/A | ⬜ pending |
| 3-03-02 | 03 | 2 | PUSH-03 | manual | Trigger ranking change, verify notification | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Firebase CLI initialized in `madness/` directory (`.firebaserc`, `firebase.json`)
- [ ] Blaze billing plan verified/enabled for `march-madness-snake-draft`
- [ ] VAPID key generated in Firebase console
- [ ] `madness/functions/` directory created with `package.json` and dependencies

*These are console/setup tasks that must be done manually before execution begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Badge shows when it's user's turn | BDGE-01 | Requires installed PWA + OS badge rendering | Install PWA on iOS/Android, start draft, verify badge on home screen icon |
| Badge clears on pick or turn pass | BDGE-02 | Requires installed PWA + OS badge rendering | Make a pick or let timer expire, verify badge clears |
| Draft turn push notification | PUSH-01 | Requires closed/background app + real push delivery | Close app, have another player pick so it's your turn, verify notification appears |
| Game final notification | PUSH-02 | Requires real FCM delivery chain | Wait for game to go final, verify notification with score |
| Leaderboard change notification | PUSH-03 | Requires real FCM delivery chain + ranking computation | Trigger ranking change via game result, verify notification |
| FCM token stored | PUSH-04 | Can verify via Firestore console | Grant notification permission, check `rooms/{id}/fcmTokens/{playerId}` exists |
| Cloud Functions deployed | PUSH-05 | Requires Firebase deploy + trigger | Deploy functions, update room doc, check `firebase functions:log` |
| Contextual permission prompt | PUSH-06 | Requires user gesture + browser permission dialog | Join a draft room, verify prompt appears after joining (not on page load) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < N/A (manual)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
