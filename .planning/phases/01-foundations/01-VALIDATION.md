---
phase: 1
slug: foundations
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — no test infrastructure exists (vanilla JS app, no build system) |
| **Config file** | none |
| **Quick run command** | Manual browser testing |
| **Full suite command** | Manual browser testing |
| **Estimated runtime** | ~5 minutes (full manual walkthrough) |

---

## Sampling Rate

- **After every task commit:** Manual browser test of changed functionality
- **After every plan wave:** Full manual walkthrough of all 9 requirements
- **Before `/gsd:verify-work`:** Full walkthrough checklist must pass
- **Max feedback latency:** Immediate (manual browser reload)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | TXTP-01 | manual-only | Open client detail, verify dropdown in Overview tab with 8 options + blank | N/A | ⬜ pending |
| 01-01-02 | 01 | 1 | TXTP-02 | manual-only | Select value, refresh page, verify value persists | N/A | ⬜ pending |
| 01-02-01 | 02 | 1 | FLDR-01 | manual-only | Click "+ New Folder", enter name, verify card appears | N/A | ⬜ pending |
| 01-02-02 | 02 | 1 | FLDR-02 | manual-only | Click kebab > Rename, enter new name, verify card updates | N/A | ⬜ pending |
| 01-02-03 | 02 | 1 | FLDR-03 | manual-only | Add files to folder, delete folder, verify files at root | N/A | ⬜ pending |
| 01-02-04 | 02 | 1 | FLDR-04 | manual-only | Create folders, add files, verify count badges | N/A | ⬜ pending |
| 01-02-05 | 02 | 1 | FLDR-05 | manual-only | Click folder card, verify filtered view, click breadcrumb | N/A | ⬜ pending |
| 01-02-06 | 02 | 1 | FLDR-06 | manual-only | Use three-dot menu "Move to folder", also test drag-and-drop | N/A | ⬜ pending |
| 01-03-01 | 03 | 2 | FLDR-07 | manual-only | Set transaction type, verify system folder appears, cannot delete/rename | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No automated test framework needed.

**Justification:** All requirements are UI interactions (dropdown selection, folder card clicks, drag-and-drop, context menus) requiring a live Firestore connection and browser DOM. The project is a vanilla JS app deployed directly to Firebase Hosting with no build system. Adding E2E testing infrastructure is out of scope for this phase and contradicts the project's "no framework migration" constraint.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Transaction type dropdown with 8 options | TXTP-01 | Browser DOM + Firestore schema | Open client detail, check Overview tab dropdown has SFH/Condo/Multi-Family/Land x Buyer/Seller options |
| Transaction type persists on refresh | TXTP-02 | Requires live Firestore write/read | Select value, hard refresh, verify same value selected |
| Create named folder | FLDR-01 | Browser DOM interaction | Click "+ New Folder", enter name, verify folder card appears |
| Rename folder | FLDR-02 | Browser DOM interaction | Click kebab > Rename, enter new name, verify update |
| Delete folder moves files to root | FLDR-03 | Requires Firestore batch write verification | Add files to folder, delete folder, verify files appear at root |
| Folder cards show name and file count | FLDR-04 | Visual verification | Create folders, add files, check count badges update |
| Folder navigation with breadcrumb | FLDR-05 | DOM navigation state | Click folder card, verify filter, click breadcrumb to return |
| Move file via context menu and drag | FLDR-06 | Complex DOM interactions | Test three-dot menu "Move to folder" and drag-and-drop |
| Closing Documents auto-created | FLDR-07 | Requires Firestore trigger verification | Set transaction type, verify system folder appears and is protected |

---

## Validation Sign-Off

- [x] All tasks have manual verify instructions
- [x] Sampling continuity: manual test after every task commit
- [x] Wave 0 justified: no automated testing appropriate for this phase
- [x] No watch-mode flags
- [x] Feedback latency < 30s (manual browser reload)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
