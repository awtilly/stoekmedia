---
phase: 1
slug: foundation-client-side-enhancements
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — vanilla JS project, no build tooling |
| **Config file** | None — no package.json |
| **Quick run command** | Manual browser testing (Chrome DevTools Application panel) |
| **Full suite command** | Manual testing on real Android device (installed PWA) |
| **Estimated runtime** | ~5 minutes per full manual pass |

---

## Sampling Rate

- **After every task commit:** Visual inspection in Chrome DevTools Application panel
- **After every plan wave:** Test on real Android device (installed PWA)
- **Before `/gsd:verify-work`:** All 5 success criteria verified on real device
- **Max feedback latency:** ~60 seconds (deploy to GitHub Pages + hard refresh)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | FNDN-01 | manual-only | DevTools > Application > Service Workers | N/A | ⬜ pending |
| 01-01-02 | 01 | 1 | FNDN-02 | manual-only | DevTools > Application > Manifest | N/A | ⬜ pending |
| 01-01-03 | 01 | 1 | FNDN-03 | manual-only | Long-press PWA icon on Android | N/A | ⬜ pending |
| 01-02-01 | 02 | 1 | SHAR-01 | manual-only | Tap share button on mobile | N/A | ⬜ pending |
| 01-02-02 | 02 | 1 | SHAR-02 | manual-only | Tap share, verify room link content | N/A | ⬜ pending |
| 01-02-03 | 02 | 1 | SHAR-03 | manual-only | Tap leaderboard share, verify text | N/A | ⬜ pending |
| 01-02-04 | 02 | 1 | LIVE-01 | manual-only | Navigate to Live Scores, wait 2+ min | N/A | ⬜ pending |
| 01-02-05 | 02 | 1 | LIVE-02 | manual-only | Switch away and return, verify wake lock | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — manual testing only. No test framework to set up.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Network-first SW serves fresh HTML | FNDN-01 | Requires real service worker context (HTTPS) | Deploy, open installed PWA, verify new content visible |
| Manifest has enhanced branding | FNDN-02 | Requires Chrome DevTools Application panel | Open DevTools > Application > Manifest, inspect fields |
| Long-press shows 3 shortcuts | FNDN-03 | Requires real Android device with PWA installed | Long-press app icon, verify Live Scores/Bracket/Leaderboard shortcuts |
| Share button invokes OS share sheet | SHAR-01 | Requires real device with Web Share API | Tap share button on mobile, verify OS share sheet opens |
| Room link shared via share sheet | SHAR-02 | Requires real device interaction | Tap room share, verify link in shared content |
| Leaderboard shared as formatted text | SHAR-03 | Requires real device interaction | Tap leaderboard share, verify formatted text |
| Screen stays on during Live Scores | LIVE-01 | Requires real device wake lock | Navigate to Live Scores, wait 2+ minutes without touching |
| Wake lock re-acquires on tab return | LIVE-02 | Requires real device wake lock | Switch away from app, return, verify screen stays on |

---

## Validation Sign-Off

- [x] All tasks have manual verify instructions
- [x] Sampling continuity: manual inspection after every commit
- [x] Wave 0 covers all MISSING references — N/A (manual only)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
