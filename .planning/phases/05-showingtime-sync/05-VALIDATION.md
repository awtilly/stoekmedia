---
phase: 5
slug: showingtime-sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual testing (no automated test framework in project) |
| **Config file** | none |
| **Quick run command** | Manual: paste feed URL in Settings, click Sync Now, verify calendar |
| **Full suite command** | Manual: full walkthrough of all SHWT requirements |
| **Estimated runtime** | ~5 minutes (manual walkthrough) |

---

## Sampling Rate

- **After every task commit:** Manual smoke test of changed feature
- **After every plan wave:** Full manual walkthrough of all SHWT requirements
- **Before `/gsd:verify-work`:** All 11 SHWT requirements manually verified
- **Max feedback latency:** N/A (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SHWT-01 | manual | Visual inspection of Settings page | N/A | ⬜ pending |
| 05-01-02 | 01 | 1 | SHWT-02 | manual | Check Firestore Console after save | N/A | ⬜ pending |
| 05-01-03 | 01 | 1 | SHWT-03 | manual | Click Sync Now, observe toast + Firestore data | N/A | ⬜ pending |
| 05-01-04 | 01 | 1 | SHWT-04 | manual | Use webcal:// URL, verify sync succeeds | N/A | ⬜ pending |
| 05-01-05 | 01 | 1 | SHWT-05 | manual | Check Firestore showings collection for st_ docs | N/A | ⬜ pending |
| 05-01-06 | 01 | 1 | SHWT-06 | manual | Cancel event in ShowingTime, re-sync, verify removal | N/A | ⬜ pending |
| 05-01-07 | 01 | 1 | SHWT-07 | manual | Deploy, wait 30 min, check Cloud Functions logs | N/A | ⬜ pending |
| 05-01-08 | 01 | 1 | SHWT-08 | manual | Click Sync Now twice within 15 min, verify throttle | N/A | ⬜ pending |
| 05-02-01 | 02 | 2 | SHWT-09 | manual | View calendar, click ST event, verify no edit/delete | N/A | ⬜ pending |
| 05-02-02 | 02 | 2 | SHWT-10 | manual | Enter invalid URL, click Sync Now, verify error UI | N/A | ⬜ pending |
| 05-02-03 | 02 | 2 | SHWT-11 | manual | After sync, verify timestamp in Settings | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no automated test framework exists in this project. All validation is manual.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Integrations card visible in Settings | SHWT-01 | UI visual check | Open Settings, verify ShowingTime card appears |
| Feed URL saves to Firestore | SHWT-02 | Requires Firestore Console | Paste URL, click Save, check Firestore doc |
| Sync Now triggers Cloud Function | SHWT-03 | End-to-end flow | Click Sync Now, check toast + Firestore showings |
| webcal:// converted and parsed | SHWT-04 | Protocol-specific | Use webcal:// URL, verify sync works |
| VEVENTs upserted correctly | SHWT-05 | Requires feed data | Check showings collection for st_ prefixed docs |
| Cancelled events removed | SHWT-06 | Requires ShowingTime action | Cancel in ShowingTime, re-sync, verify removal |
| Scheduled sync every 30 min | SHWT-07 | Requires deployed function + time | Deploy, check Cloud Functions logs after 30 min |
| Rate limited to 15 min | SHWT-08 | Time-based behavior | Click Sync Now twice within 15 min |
| ST badge + read-only calendar | SHWT-09 | UI visual check | View calendar, click ST event, verify badge + no edit |
| Error banner on bad URL | SHWT-10 | UI error flow | Enter invalid URL, click Sync Now, check error |
| Last synced timestamp shown | SHWT-11 | UI visual check | After sync, verify timestamp in Settings |

---

## Validation Sign-Off

- [ ] All tasks have manual verification steps defined
- [ ] Sampling continuity: manual smoke test after each task commit
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency: N/A (manual)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
