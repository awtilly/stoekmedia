---
phase: 4
slug: ai-closing-checklist
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual testing (no automated test framework in project) |
| **Config file** | none — vanilla JS project with no test runner |
| **Quick run command** | Manual browser verification |
| **Full suite command** | Full manual walkthrough of all checklist features |
| **Estimated runtime** | ~10 minutes (full manual walkthrough) |

---

## Sampling Rate

- **After every task commit:** Manual browser verification of affected feature
- **After every plan wave:** Full manual walkthrough of all checklist features
- **Before `/gsd:verify-work`:** Full suite must pass (all 13 requirements verified)
- **Max feedback latency:** ~60 seconds (page reload + interaction)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | CHKL-01 | manual | Firestore console: verify closingChecklist subcollection fields | N/A | ⬜ pending |
| 04-01-02 | 01 | 1 | CHKL-02 | manual | Set transaction type → verify items seeded | N/A | ⬜ pending |
| 04-02-01 | 02 | 1 | CHKL-03 | manual | Visual: items grouped by Pre-Contract / Under Contract / Closing | N/A | ⬜ pending |
| 04-02-02 | 02 | 1 | CHKL-04 | manual | Toggle items → verify progress bar percentages update | N/A | ⬜ pending |
| 04-02-03 | 02 | 1 | CHKL-05 | manual | Click checkboxes → verify Firestore updates | N/A | ⬜ pending |
| 04-03-01 | 03 | 2 | CHKL-06 | manual | Simulate webhook via curl → verify checklist auto-update | N/A | ⬜ pending |
| 04-03-02 | 03 | 2 | CHKL-07 | manual | After webhook → verify "Auto-completed" badge visible | N/A | ⬜ pending |
| 04-03-03 | 03 | 2 | AICX-01 | manual | Click "Check in with AI" → verify panel opens | N/A | ⬜ pending |
| 04-03-04 | 03 | 2 | AICX-02 | manual | Open check-in → verify response references actual transaction data | N/A | ⬜ pending |
| 04-03-05 | 03 | 2 | AICX-03 | manual | Open check-in with mixed completion → verify done/outstanding/overdue | N/A | ⬜ pending |
| 04-03-06 | 03 | 2 | AICX-04 | manual | Verify response includes 2-3 actionable next-action suggestions | N/A | ⬜ pending |
| 04-03-07 | 03 | 2 | AICX-05 | manual | Ask follow-up after initial summary → verify context maintained | N/A | ⬜ pending |
| 04-03-08 | 03 | 2 | AICX-06 | manual | Verify follow-ups reference prior messages; close+reopen → verify reset | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* No automated test infrastructure exists in this project (vanilla JS, no test runner). Manual testing protocol is the established verification method (see Phase 1-3 verification patterns).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Checklist subcollection structure | CHKL-01 | No test runner; Firestore verification | Inspect Firestore console for closingChecklist subcollection fields |
| Transaction type seeds checklist | CHKL-02 | UI interaction required | Set transaction type on client, verify items appear grouped |
| Items grouped by category | CHKL-03 | Visual layout verification | Verify Pre-Contract / Under Contract / Closing groups render |
| Progress bars update | CHKL-04 | Visual rendering | Toggle items, verify bar percentages match |
| Manual toggle works | CHKL-05 | Browser interaction | Click checkboxes, verify Firestore + UI updates |
| Webhook auto-completes items | CHKL-06 | Requires webhook simulation | curl webhook endpoint, verify matching items complete |
| Auto-completed badge displays | CHKL-07 | Visual rendering | After webhook, verify distinct badge on auto-completed items |
| Check-in panel opens | AICX-01 | UI interaction | Click button on checklist tab, verify panel opens |
| AI receives transaction context | AICX-02 | AI response inspection | Open check-in, verify response references actual client data |
| AI summarizes progress | AICX-03 | AI response quality | Open with mixed states, verify done/outstanding/overdue summary |
| AI suggests next actions | AICX-04 | AI response quality | Verify 2-3 actionable suggestions in response |
| Follow-up questions work | AICX-05 | Conversation continuity | Ask follow-up, verify context from prior exchange maintained |
| Session-only history | AICX-06 | State management | Verify follow-ups work; close+reopen panel, verify history reset |

---

## Validation Sign-Off

- [ ] All tasks have manual verify instructions
- [ ] Sampling continuity: manual verification after every task commit
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
