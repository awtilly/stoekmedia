---
phase: 2
slug: compliance-documents
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual testing (no automated test framework in project) |
| **Config file** | none |
| **Quick run command** | Manual browser testing |
| **Full suite command** | Manual browser testing |
| **Estimated runtime** | ~5 minutes (full send flow) |

---

## Sampling Rate

- **After every task commit:** Manual browser test of affected feature
- **After every plan wave:** Full walkthrough of compliance tab send flow
- **Before `/gsd:verify-work`:** Complete send-to-status flow with BoldSign verified
- **Max feedback latency:** Manual — per commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | BSND-01 | manual-only | Verify "From" field in received signature email | N/A | ⬜ pending |
| 02-01-02 | 01 | 1 | BSND-02 | manual-only | Verify "From" field in received signature email | N/A | ⬜ pending |
| 02-01-03 | 01 | 1 | BSND-03 | manual-only | Check Cloud Function logs for profile read | N/A | ⬜ pending |
| 02-01-04 | 01 | 1 | BSND-04 | manual-only | Test with user profile missing email field | N/A | ⬜ pending |
| 02-02-01 | 02 | 1 | COMP-01 | manual-only | Verify Firestore document structure in Firebase console | N/A | ⬜ pending |
| 02-02-02 | 02 | 1 | COMP-02 | manual-only | Query documentTemplates in Firebase console; verify 7 docs | N/A | ⬜ pending |
| 02-02-03 | 02 | 1 | COMP-03 | manual-only | Send a doc and verify field values in received document | N/A | ⬜ pending |
| 02-03-01 | 03 | 2 | COMP-04 | manual-only | Navigate to client detail, verify 6th tab appears | N/A | ⬜ pending |
| 02-03-02 | 03 | 2 | COMP-05 | manual-only | Set transaction type on client; verify tab shows matching forms | N/A | ⬜ pending |
| 02-03-03 | 03 | 2 | COMP-06 | manual-only | Visual inspection of compliance tab rows | N/A | ⬜ pending |
| 02-03-04 | 03 | 2 | COMP-07 | manual-only | Click Send, verify BoldSign document created | N/A | ⬜ pending |
| 02-03-05 | 03 | 2 | COMP-08 | manual-only | Check sent email sender field | N/A | ⬜ pending |
| 02-03-06 | 03 | 2 | COMP-09 | manual-only | Verify Firestore subcollection after send | N/A | ⬜ pending |
| 02-03-07 | 03 | 2 | COMP-10 | manual-only | Change status in Firestore console; verify UI updates without refresh | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No automated test framework exists in this project — all validation is manual browser testing. This is appropriate for a static HTML + vanilla JS + Firebase app with no build step or test runner.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sender name shows realtor's display name | BSND-01 | Requires receiving actual BoldSign email | Send doc, check "From" field in received email |
| Sender email shows realtor's email | BSND-02 | Requires receiving actual BoldSign email | Send doc, check "From" field in received email |
| Sender data from Firestore profile | BSND-03 | Cloud Function server-side behavior | Check Cloud Function logs for profile read |
| Fallback to Firebase Auth email | BSND-04 | Requires profile without email field | Remove email from profile, send doc, verify Auth email used |
| documentTemplates stores metadata | COMP-01 | Firestore collection structure | Check Firebase console for document structure |
| MO form stubs seeded | COMP-02 | Seed data verification | Query documentTemplates, verify 7 documents |
| Merge field mapping resolves | COMP-03 | End-to-end BoldSign rendering | Send doc, verify field values in received document |
| Compliance Docs tab exists | COMP-04 | Visual UI element | Navigate to client detail, verify 6th tab |
| Templates filtered by type | COMP-05 | UI behavior with Firestore query | Set transaction type, verify filtered forms |
| Row layout correct | COMP-06 | Visual layout verification | Inspect compliance tab rows |
| Send button triggers BoldSign | COMP-07 | Integration with BoldSign API | Click Send, verify document created in BoldSign |
| Cloud Function sets sender | COMP-08 | Server-side + email verification | Check sent email sender field |
| Status in complianceDocs subcollection | COMP-09 | Firestore write verification | Check subcollection after send |
| Real-time status updates | COMP-10 | Live UI reactivity | Modify Firestore doc, verify UI updates without refresh |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < manual per commit
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
