---
phase: 02-player-identity-draft-clock
verified: 2026-03-12T00:00:00Z
status: human_needed
score: 13/13 must-haves verified
re_verification: false
human_verification:
  - test: "New player self-registration end-to-end"
    expected: "Open ?room=CODE in a browser, enter a name and 4-digit PIN, tap Join, land inside the room on the Setup tab with no further prompts"
    why_human: "Requires a live browser session with Firebase to confirm Firestore write and localStorage identity assignment work together"
  - test: "Auto-recognition on return visit"
    expected: "Closing and reopening the same URL immediately shows the room interior without a join prompt"
    why_human: "Requires a real browser session to verify localStorage lookup and render() gate behave correctly end-to-end"
  - test: "Returning-player reclaim on new device"
    expected: "Opening the URL in an incognito window, tapping a player name from 'Returning Player?' list, entering the PIN, and landing inside the room"
    why_human: "Requires a real browser session to verify PIN hash comparison and identity persistence"
  - test: "Turn enforcement — non-active player cannot pick"
    expected: "As a non-active-turn player (not admin), clicking a team pick button shows 'It\u2019s not your turn!' toast and does not advance the draft"
    why_human: "Requires two simultaneous browser sessions with distinct player identities"
  - test: "Draft clock color transitions and auto-pick"
    expected: "Timer shows green above 30s, yellow 11-30s, red with pulse at 1-10s; on expiry the highest available seed is auto-picked and a toast confirms it"
    why_human: "Requires a live draft session to observe real-time countdown and auto-pick trigger"
  - test: "Audio beep and haptic at 10 seconds"
    expected: "An audible beep plays exactly once when the timer crosses 10 seconds; on Android/iOS a haptic vibration accompanies it"
    why_human: "Audio and haptic output cannot be verified programmatically; requires a physical device test"
  - test: "Pause / Resume clock"
    expected: "Commissioner (admin-unlocked) can pause the clock mid-pick; timer freezes at the paused value; Resume restores remaining time and the clock counts down from there"
    why_human: "Requires a live session with admin privileges to verify pause/resume UI and clock continuity"
  - test: "AUTH-05 enforcement scope — client-side only"
    expected: "Reviewer confirms whether client-side-only turn enforcement satisfies the requirement, given that Firestore rules do not enforce it server-side"
    why_human: "AUTH-05 states 'enforced by Firestore security rules' but the actual firestore.rules has no turn-check. All enforcement is client-side. A human must decide if this is acceptable for the friend-group use case."
---

# Phase 2: Player Identity & Draft Clock Verification Report

**Phase Goal:** Players join rooms via shareable links, maintain persistent identity, and draft under time pressure with a synced countdown clock
**Verified:** 2026-03-12
**Status:** human_needed (all automated checks pass; 8 items require human testing)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

The five Success Criteria from ROADMAP.md are treated as the primary truths. Must-haves from the three plan frontmasters are verified as supporting evidence.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A new player can open a shared room link, enter a name and PIN, and land inside the room ready to draft | VERIFIED | `selfRegister()` at line 2344 reads `join-name` and `join-pin`, hashes PIN, pushes player to `S.players`, calls `setMyPlayerId()`, then `render()`. Identity gate in `render()` at line 2857-2859 gates on `getMyPlayerId()`. |
| 2 | A returning player on the same device is recognized automatically without re-entering credentials | VERIFIED | `getMyPlayerId()` at line 2308 reads from `localStorage('mm4_me_'+roomId)`. `render()` identity gate at line 2858-2859 passes through if `myId` is found and exists in `S.players`. |
| 3 | A player on a new device can reclaim identity by entering name and PIN | VERIFIED | `renderJoinScreen()` at lines 2376-2385 shows returning-player list if `S.players.length > 0`. `claimPlayer()` at lines 2311-2342 prompts for PIN, hashes, compares against `player.pinHash`, calls `setMyPlayerId()`. Legacy `passphraseHash` migration path is present at lines 2323-2338. |
| 4 | Only the player whose turn it is can make a draft pick — all other players see disabled pick controls | VERIFIED | `pickTeam()` at lines 3377-3380 checks `!adminUnlocked && myId !== ds.order[ds.cp]` and shows toast. `renderDraft()` at line 3334 computes `isMyTurn = adminUnlocked || myId === ds.order[ds.cp]` and at line 3348 applies `${!isMyTurn || ds.complete ? 'disabled' : ''}` on every pick button. |
| 5 | A visible countdown timer ticks down, changes color, plays an audio alert at 10 seconds, and auto-picks on expiry | VERIFIED | Timer element at line 3342 (`id="draft-timer"`). `updateDraftClock()` at lines 3493-3524 runs every 250ms, updates text and CSS class (`timer-green`/`timer-yellow`/`timer-red`), calls `playTimerBeep()` + `triggerHaptic()` at `seconds === 10` (lines 3507-3510), and calls `autoPickHighestSeed()` when `remaining === 0`. |

**Score:** 5/5 truths verified

---

### Plan-Level Must-Have Truths (13 total across 3 plans)

#### Plan 02-01: Player Identity (AUTH-01 through AUTH-04)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A new player sees join screen with name + PIN fields | VERIFIED | `renderJoinScreen()` line 2371-2373 renders `id="join-name"` and `id="join-pin"` inputs |
| 2 | After name + PIN, player lands inside the room | VERIFIED | `selfRegister()` line 2356-2358 calls `setMyPlayerId()` then `render()` |
| 3 | Closing/reopening URL auto-recognizes the player | VERIFIED | `getMyPlayerId()` reads localStorage; `render()` gate at line 2858 passes if found |
| 4 | New-device player taps name and enters PIN to reclaim | VERIFIED | `claimPlayer()` lines 2315-2321 hash + compare PIN; `renderJoinScreen()` lines 2376-2385 show player list |
| 5 | Admin can add players with 4-digit PIN (backward compat) | VERIFIED | `addPlayer()` lines 3036-3039 prompt for PIN, validate `/^\d{4}$/`, store `pinHash` |

#### Plan 02-02: Draft Clock (AUTH-05, AUTH-06, DRFT-01 through DRFT-05)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | Only active drafter can pick; others see disabled buttons | VERIFIED | `isMyTurn` line 3334, disabled attr line 3348, toast line 3378 |
| 7 | Visible countdown timer ticks down, synced via Firestore | VERIFIED | `draft-timer` element line 3342; `pickDeadline` set as `firebase.firestore.Timestamp.fromDate()` lines 3362, 3389; interval at line 3486 |
| 8 | Timer changes color: green (>30s), yellow (>10s), red (<=10s) | VERIFIED | CSS at lines 1855-1857; class assignment in `updateDraftClock()` line 3503 |
| 9 | When timer expires, highest available seed is auto-picked | VERIFIED | `autoPickHighestSeed()` lines 3530-3550; called from `updateDraftClock()` when `remaining === 0` |
| 10 | Commissioner can pause and resume the clock | VERIFIED | `pauseDraftClock()` lines 3552-3562; `resumeDraftClock()` lines 3565-3575; UI buttons at lines 3338-3340 |
| 11 | Timer duration configurable per room | VERIFIED | `setDraftClock()` lines 3578-3582; UI preset buttons at lines 3014-3015 (No Limit, 60s, 90s, 120s) |

#### Plan 02-03: Audio & Haptics (DRFT-06, DRFT-07)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 12 | Audio beep plays at 10 seconds remaining | VERIFIED | `playTimerBeep()` lines 3435-3451; called in `updateDraftClock()` at `seconds === 10` line 3509 |
| 13 | Haptic fires alongside audio; degrades on unsupported devices | VERIFIED | `triggerHaptic()` lines 3453-3476 uses `navigator.vibrate(50)` with iOS checkbox fallback; `try/catch` at line 3459 silences unsupported |
| 14 | Audio alert fires only once per pick | VERIFIED | `_beeped` flag at line 3426; set true at line 3508; reset in `startDraft()` line 3356, `pickTeam()` line 3375, `undoDraft()` line 3400, `autoPickHighestSeed()` line 3531, `resumeDraftClock()` line 3566 |
| 15 | Haptics silently degrade | VERIFIED | `triggerHaptic()` wrapped in `try/catch` at lines 3459, 3476 |

**Score:** 15/15 plan must-haves verified (including audio-only split from truth #5)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `index.html` | `selfRegister()`, updated `claimPlayer()`, `renderJoinScreen()` (Plan 01) | VERIFIED | Function present at lines 2344, 2311, 2361 respectively |
| `index.html` | Turn enforcement in `pickTeam`/`renderDraft`, draft clock system, timer config UI (Plan 02) | VERIFIED | `pickTeam()` line 3371, `renderDraft()` line 3321, clock functions lines 3484-3582 |
| `index.html` | `playTimerBeep()`, `triggerHaptic()`, AudioContext warmup (Plan 03) | VERIFIED | Lines 3428-3432, 3435-3451, 3453-3476, warmup listener line 2148 |

All artifacts: VERIFIED (substantive, not stubs; wired into render and clock loops).

---

### Key Link Verification

#### Plan 02-01 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|---------|
| `renderJoinScreen()` | `selfRegister()` | join form submit button `onclick="selfRegister()"` | WIRED | Line 2373: `onclick="selfRegister()"` on Join button |
| `selfRegister()` | `setMyPlayerId()` | localStorage identity persistence | WIRED | Line 2356: `setMyPlayerId(player.id)` inside `selfRegister()` |
| `render()` | `renderJoinScreen()` | identity gate check | WIRED | Lines 2857-2859: `if(!myId || !S.players.some(...)) { renderJoinScreen(); return; }` |
| `claimPlayer()` | `hashPin()` | PIN verification for reclaim | WIRED | Line 2318: `const hash = await hashPin(pin.trim())` then compared against `player.pinHash` |

#### Plan 02-02 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|---------|
| `pickTeam()` | `getMyPlayerId()` | turn check | WIRED | Line 3372: `const myId = getMyPlayerId()` used in turn check at line 3377 |
| `renderDraft()` | `draft-timer` element | countdown display with color classes | WIRED | Line 3342 injects `<div id="draft-timer">`, updated in `updateDraftClock()` line 3500-3503 |
| `startDraft()`/`pickTeam()` | `S.ds.pickDeadline` | absolute deadline set on each new pick | WIRED | Lines 3362 (startDraft), 3389 (pickTeam after advance) |
| `updateDraftClock()` | `autoPickHighestSeed()` | triggers when remaining hits 0 | WIRED | Line 3518: `autoPickHighestSeed()` called when `remaining === 0` |
| `pauseDraftClock()` | `S.ds.pausedRemaining` | stores remaining ms, clears pickDeadline | WIRED | Lines 3558-3559: `ds.pausedRemaining = remaining; ds.pickDeadline = null` |

#### Plan 02-03 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|---------|
| `updateDraftClock()` | `playTimerBeep()` | called when `seconds === 10` | WIRED | Line 3509: `playTimerBeep()` inside `if(seconds === 10 && !_beeped)` block |
| `updateDraftClock()` | `triggerHaptic()` | called alongside `playTimerBeep` at 10s | WIRED | Line 3510: `triggerHaptic()` in same block |
| user interaction (any click) | AudioContext resume | warmup on first gesture | WIRED | Lines 2148-2151: `document.addEventListener('click', function _warmup(){ warmupAudio(); ... }, { once: true })` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| AUTH-01 | 02-01 | Creator can share a join link that opens directly to the room | SATISFIED | Existing room link mechanic preserved; `renderJoinScreen()` is the entry point when `?room=CODE` URL is opened by any non-identified visitor |
| AUTH-02 | 02-01 | New players enter display name + 4-digit PIN on first join | SATISFIED | `renderJoinScreen()` name + PIN form; `selfRegister()` validates and creates player |
| AUTH-03 | 02-01 | Identity persists via localStorage — no re-entry needed after first join | SATISFIED | `setMyPlayerId()` writes to localStorage; `render()` gate reads via `getMyPlayerId()` |
| AUTH-04 | 02-01 | PIN only needed to reclaim on new device or cleared browser | SATISFIED | `claimPlayer()` required only when localStorage has no identity for this room |
| AUTH-05 | 02-02 | Only the current drafter can make a pick, enforced by Firestore security rules | PARTIAL | Client-side enforcement fully implemented in `pickTeam()` (line 3377) and `renderDraft()` `isMyTurn` (line 3334). However, the Firestore security rules (`firestore.rules`) do NOT include server-side turn enforcement — the room update rule simply checks adminPin format. Turn enforcement is client-only. See Human Verification item 8. |
| AUTH-06 | 02-02 | UI disables pick controls for non-active drafters | SATISFIED | `isMyTurn` computed at line 3334; pick buttons have `${!isMyTurn || ds.complete ? 'disabled' : ''}` at line 3348 |
| DRFT-01 | 02-02 | Configurable timer duration per room (60s, 90s, 120s, no limit) | SATISFIED | `setDraftClock()` function line 3578; preset buttons at lines 3014-3015 with values 0, 60, 90, 120 |
| DRFT-02 | 02-02 | Visual countdown with color thresholds (green > yellow > red) | SATISFIED | CSS at lines 1855-1857; applied in `updateDraftClock()` line 3503 |
| DRFT-03 | 02-02 | Timer syncs across all players via Firestore server timestamps | SATISFIED | `pickDeadline` stored as `firebase.firestore.Timestamp.fromDate()` at lines 3362, 3389, 3407, 3545, 3570; reconstructed after JSON deserialization at lines 2422-2423, 2483-2484 |
| DRFT-04 | 02-02 | Auto-pick highest available seed when timer expires | SATISFIED | `autoPickHighestSeed()` at lines 3530-3550; triggered from `updateDraftClock()` at `remaining === 0` |
| DRFT-05 | 02-02 | Commissioner can pause and resume the clock | SATISFIED | `pauseDraftClock()` lines 3552-3562; `resumeDraftClock()` lines 3565-3575; admin-only buttons in renderDraft at lines 3337-3341 |
| DRFT-06 | 02-03 | Audio alert at 10 seconds remaining | SATISFIED | `playTimerBeep()` lines 3435-3451; called in `updateDraftClock()` at `seconds === 10` with `_beeped` guard |
| DRFT-07 | 02-03 | Haptic alert on timer events (conditional — drop entirely if iOS unsupported) | SATISFIED | `triggerHaptic()` lines 3453-3476; Vibration API for Android, checkbox switch trick for iOS; silent `try/catch` degradation |

**All 13 required requirement IDs present and accounted for.** No orphaned requirements found for Phase 2.

---

### Anti-Patterns Found

Scanned `index.html` for TODO/FIXME/placeholder/stub patterns across phase 2 changes.

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `index.html` | None found in phase 2 functions | — | Clean implementation; no stubs, no placeholder returns, no console-log-only handlers |

---

### Human Verification Required

The automated pass rate is 13/13 must-haves. The following items require human testing.

#### 1. New Player Self-Registration

**Test:** Open `index.html?room=TESTROOM` in a browser. Enter a name and 4-digit PIN in the "Join as New Player" form and tap Join.
**Expected:** You land inside the room on the Setup tab with no further prompts. The room badge appears in the header.
**Why human:** Requires a live Firebase connection to confirm Firestore write and localStorage identity assignment succeed together.

#### 2. Auto-Recognition on Return Visit

**Test:** After joining as a player, close the tab and reopen the same URL.
**Expected:** You bypass the join screen entirely and land directly on the Setup tab.
**Why human:** Requires a real browser session and localStorage to verify the identity gate passes correctly.

#### 3. Returning-Player Reclaim on New Device

**Test:** Open the same URL in a private/incognito window. The join screen should appear. Tap your player name under "Returning Player?", enter your PIN.
**Expected:** You land inside the room. Enter the wrong PIN — verify "Incorrect PIN" alert appears and you remain on the join screen.
**Why human:** Requires two browser profiles to simulate new-device behavior.

#### 4. Turn Enforcement — Non-Active Player Cannot Pick

**Test:** Open the URL in two browser windows with two different player identities. As the non-active drafter, click a team pick button.
**Expected:** "It's not your turn!" toast appears and the draft does not advance.
**Why human:** Requires two simultaneous player sessions.

#### 5. Draft Clock Color Transitions and Auto-Pick

**Test:** Start a draft with a 60-second clock. Watch the timer count down.
**Expected:** Timer shows green above 30s, yellow between 11-30s, red with pulse animation at 1-10s. On expiry, the highest available seed is auto-picked and a toast confirms the selection.
**Why human:** Requires a live draft session to observe real-time color changes and auto-pick trigger.

#### 6. Audio Beep and Haptic at 10 Seconds

**Test:** Start a draft with a 60-second clock. Wait for the 10-second mark.
**Expected:** An audible beep plays exactly once at 10 seconds. On Android or iOS 17.4+, the device vibrates. The beep does not repeat on subsequent ticks.
**Why human:** Audio and haptic output cannot be verified programmatically. Requires a physical mobile device.

#### 7. Pause / Resume Clock

**Test:** As admin-unlocked, start a draft with a 60-second clock. Click "Pause Clock" at around 40 seconds. Wait 10 seconds. Click "Resume Clock".
**Expected:** Timer freezes at the paused value (approximately 40s). After Resume, it counts down from the same remaining time — not from 60 again.
**Why human:** Requires a live session with admin privileges to verify pause continuity.

#### 8. AUTH-05 Enforcement Scope — Client-Side Only

**Test:** A developer should review whether client-side-only turn enforcement satisfies the requirement for this use case.
**Expected:** If the answer is "yes, friend-group trust model is sufficient," AUTH-05 can be considered closed. If server-side enforcement is required, Firestore rules need to be updated to check turn order.
**Why human:** AUTH-05 explicitly states "enforced by Firestore security rules." The current `firestore.rules` file has no turn-check logic — the update rule only validates the adminPin field format. A human must decide whether the client-side enforcement in `pickTeam()` satisfies the intent.

---

### Verification Summary

All 13 phase must-haves and all 5 roadmap success criteria are verifiably implemented in `index.html`. The three commits (`4045957`, `0c3be67`, `3be5887`) exist and correspond to the three plans.

The one notable finding is that **AUTH-05** requires human judgment: the requirement text says "enforced by Firestore security rules" but the server-side `firestore.rules` has no per-turn enforcement. All turn enforcement is client-side in `pickTeam()` and `renderDraft()`. This is a design trade-off — for a friend-group app where all state is stored as a single JSON blob, adding per-pick Firestore rule enforcement would require restructuring the data model (e.g., subcollection of picks). The client-side implementation is functionally correct; the gap is whether the requirement wording is satisfied.

---

_Verified: 2026-03-12_
_Verifier: Claude (gsd-verifier)_
