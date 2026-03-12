---
phase: 2
slug: player-identity-draft-clock
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual browser testing (no automated test framework in project) |
| **Config file** | None — zero-dependency vanilla JS project |
| **Quick run command** | Open `index.html?room=TEST` in browser |
| **Full suite command** | Manual test matrix across Chrome, Safari, Chrome Android, iOS Safari |
| **Estimated runtime** | ~5 minutes (manual walkthrough) |

---

## Sampling Rate

- **After every task commit:** Reload `index.html?room=TEST` in browser, walk through modified flow
- **After every plan wave:** Full manual test: create room -> add players -> start draft -> timer -> auto-pick -> verify across 2 browsers
- **Before `/gsd:verify-work`:** Cross-browser test matrix (Chrome desktop, Chrome Android, iOS Safari)
- **Max feedback latency:** ~60 seconds (manual reload + walkthrough)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | AUTH-01 | manual | Open `?room=CODE` link in new browser | N/A | ⬜ pending |
| 02-01-02 | 01 | 1 | AUTH-02 | manual | Open room link in incognito, fill join form | N/A | ⬜ pending |
| 02-01-03 | 01 | 1 | AUTH-03 | manual | Join room, close tab, reopen same URL | N/A | ⬜ pending |
| 02-01-04 | 01 | 1 | AUTH-04 | manual | Clear localStorage, reopen room, tap name, enter PIN | N/A | ⬜ pending |
| 02-02-01 | 02 | 1 | AUTH-05 | manual | Open two browser windows as different players | N/A | ⬜ pending |
| 02-02-02 | 02 | 1 | AUTH-06 | manual | Check pick buttons while not your turn | N/A | ⬜ pending |
| 02-03-01 | 03 | 2 | DRFT-01 | manual | Create room, set timer in setup | N/A | ⬜ pending |
| 02-03-02 | 03 | 2 | DRFT-02 | manual | Watch timer count down through thresholds | N/A | ⬜ pending |
| 02-03-03 | 03 | 2 | DRFT-03 | manual | Open room in two browsers, compare timers | N/A | ⬜ pending |
| 02-03-04 | 03 | 2 | DRFT-04 | manual | Let timer expire, verify correct team picked | N/A | ⬜ pending |
| 02-03-05 | 03 | 2 | DRFT-05 | manual | Admin pauses mid-timer, resumes, verify continuity | N/A | ⬜ pending |
| 02-03-06 | 03 | 2 | DRFT-06 | manual | Let timer reach 10s, listen for beep | N/A | ⬜ pending |
| 02-03-07 | 03 | 2 | DRFT-07 | manual | Test on iOS Safari + Android Chrome | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No automated test framework — all testing is manual browser-based, appropriate for a zero-dependency vanilla JS SPA at friend-group scale.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Room link opens directly to room | AUTH-01 | Requires browser navigation | Open `?room=CODE` in fresh browser/incognito |
| New player name + PIN registration | AUTH-02 | Requires form interaction | Open incognito, enter name + 4-digit PIN, verify join |
| Identity persists across sessions | AUTH-03 | Requires tab close/reopen | Join, close tab, reopen URL, verify auto-recognized |
| PIN reclaim on new device | AUTH-04 | Requires localStorage clear | Clear storage, reopen room, tap name, enter PIN |
| Only current drafter can pick | AUTH-05 | Requires two browser sessions | Open two windows as different players, verify only active drafter's buttons are enabled |
| Non-active drafters see disabled controls | AUTH-06 | Visual verification | Check pick buttons are disabled when not your turn |
| Configurable timer duration | DRFT-01 | Requires UI interaction | Create room, configure timer (60/90/120/none) in setup |
| Color thresholds on timer | DRFT-02 | Visual verification | Watch timer transition green → yellow → red |
| Timer syncs across clients | DRFT-03 | Requires two browsers | Open same room in two browsers, compare countdown |
| Auto-pick on expiry | DRFT-04 | Requires waiting for timer | Let timer expire, verify highest seed auto-picked |
| Commissioner pause/resume | DRFT-05 | Requires admin interaction | Pause mid-timer, verify freeze, resume, verify continuity |
| Audio alert at 10s | DRFT-06 | Requires audio output | Let timer reach 10s, verify beep plays |
| Haptic alert | DRFT-07 | Requires physical device | Test on iOS Safari and Android Chrome |

---

## Validation Sign-Off

- [ ] All tasks have manual verification instructions
- [ ] Sampling continuity: every commit verifiable via browser reload
- [ ] Wave 0 not needed — no automated test infrastructure
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
