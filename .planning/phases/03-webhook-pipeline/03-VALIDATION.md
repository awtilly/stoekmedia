---
phase: 3
slug: webhook-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — no test framework detected in project |
| **Config file** | none — manual verification pattern |
| **Quick run command** | Manual: deploy + trigger webhook |
| **Full suite command** | Manual: end-to-end send → sign → verify pipeline |
| **Estimated runtime** | ~2-5 minutes (deploy + manual test) |

---

## Sampling Rate

- **After every task commit:** Manual verification via Firebase emulator or deployed test
- **After every plan wave:** Full end-to-end: send doc via BoldSign, complete signing, verify webhook pipeline
- **Before `/gsd:verify-work`:** All 12 requirements manually verified
- **Max feedback latency:** ~60 seconds (deploy time)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | WHBK-01 | manual | Deploy + POST to endpoint | N/A | ⬜ pending |
| 03-01-02 | 01 | 1 | WHBK-02 | manual | Send forged request, verify 401 | N/A | ⬜ pending |
| 03-01-03 | 01 | 1 | WHBK-03 | manual | Send non-Completed event, verify 200 | N/A | ⬜ pending |
| 03-01-04 | 01 | 1 | WHBK-04 | manual | Verify collectionGroup lookup | N/A | ⬜ pending |
| 03-01-05 | 01 | 1 | WHBK-05 | manual | Verify PDF download from BoldSign | N/A | ⬜ pending |
| 03-02-01 | 02 | 1 | WHBK-06 | manual | Check Storage after webhook | N/A | ⬜ pending |
| 03-02-02 | 02 | 1 | WHBK-07 | manual | Check files collection | N/A | ⬜ pending |
| 03-02-03 | 02 | 1 | WHBK-08 | manual | Check complianceDocs status | N/A | ⬜ pending |
| 03-02-04 | 02 | 1 | WHBK-09 | manual | Fire webhook twice, verify single file | N/A | ⬜ pending |
| 03-02-05 | 02 | 1 | WHBK-10 | manual | Check BoldSign delivery log | N/A | ⬜ pending |
| 03-03-01 | 03 | 2 | SDUI-01 | manual | View compliance tab after signing | N/A | ⬜ pending |
| 03-03-02 | 03 | 2 | SDUI-02 | manual | View files tab for signed badge | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] CollectionGroup index for `complianceDocs.boldSignDocumentId` — required before WHBK-04 works
- [ ] `BOLDSIGN_WEBHOOK_SECRET` environment variable set in Firebase Functions config

*No test framework to install — project relies on manual verification.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Webhook receives POST from BoldSign | WHBK-01 | Requires deployed Cloud Function + BoldSign callback | Deploy function, configure BoldSign webhook URL, send test document |
| HMAC rejects forged requests | WHBK-02 | Requires HTTP request to deployed endpoint | Send POST with invalid/missing signature header, verify 401 |
| Signed PDF in Storage | WHBK-06 | Requires BoldSign → webhook → Storage pipeline | Complete signing flow, check Firebase Storage console |
| Signed badge in UI | SDUI-02 | Visual verification | View client's Closing Documents in browser after webhook processes |
| Idempotency on duplicate | WHBK-09 | Requires re-delivery simulation | Manually POST same payload twice, verify single file record |

---

## Validation Sign-Off

- [ ] All tasks have manual verification steps defined
- [ ] Sampling continuity: manual check after each task commit
- [ ] Wave 0 covers CollectionGroup index and env variable
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (deploy time)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
