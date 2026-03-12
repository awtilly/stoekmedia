# Phase 2: Player Identity & Draft Clock - Research

**Researched:** 2026-03-11
**Domain:** Player identity (localStorage + Firestore), draft clock sync (server timestamps), audio/haptic alerts
**Confidence:** HIGH

## Summary

Phase 2 transforms the current admin-only draft flow into a multiplayer experience where each player joins via a shared link, claims an identity with a display name and 4-digit PIN, and drafts under time pressure with a synchronized countdown clock. The existing codebase already has the foundation: rooms with `?room=CODE` URL parameters, a passphrase-based player claim system (`claimPlayer()`), localStorage identity persistence (`mm4_me_{roomId}`), and SHA-256 hashing via `crypto.subtle`. The primary work is (1) replacing the "passphrase" system with a simpler 4-digit PIN model, (2) adding a `pinHash` field to player objects in Firestore, (3) storing a `pickDeadline` absolute timestamp in the room document for clock sync, (4) building a client-side countdown that renders from `pickDeadline - Date.now()`, and (5) enforcing turn-based picking both in the UI and in Firestore security rules.

The critical architectural insight (already flagged in STATE.md) is that **background tab throttling** means the countdown timer must use absolute server timestamps (`pickDeadline`), not a decrementing counter. The client computes remaining time as `pickDeadline.toMillis() - Date.now()` on each tick, which self-corrects even after tab backgrounding. Auto-pick on expiry should be triggered by the active drafter's client, with a server-side fallback (or any client detecting expiry) as a safety net.

**Primary recommendation:** Store `pickDeadline` as a Firestore Timestamp on the room document. Each client renders `Math.max(0, pickDeadline - now)`. The active drafter's client triggers auto-pick when the timer hits zero. Firestore security rules enforce that only the room state can be updated (existing pattern), with client-side enforcement for turn validation.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Firebase Firestore (compat) | 10.8.0 | Real-time sync, server timestamps | Already loaded via CDN in index.html |
| Web Crypto API | Built-in | SHA-256 PIN hashing | Already used for admin PIN and passphrases |
| Web Audio API | Built-in | Timer alert sound at 10s | No file needed -- synthesize tone with OscillatorNode |
| localStorage | Built-in | Player identity persistence | Already used for `mm4_me_{roomId}` pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `navigator.vibrate()` | Built-in | Haptic buzz on Android | DRFT-07: Android fallback path |
| `<input type="checkbox" switch>` | Safari 17.4+ | Haptic tap on iOS | DRFT-07: iOS haptic via hidden checkbox trick |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| OscillatorNode for beep | Audio file (mp3/wav) | File adds a network request + caching concern; OscillatorNode is zero-dependency and works offline |
| Client-side auto-pick | Cloud Function on timer | Cloud Function adds backend dependency + billing; client-side is sufficient for friend-group scale |
| localStorage identity | Firebase Anonymous Auth | Adds SDK weight + complexity; project explicitly excludes Firebase Auth (Out of Scope) |
| Hidden checkbox haptics | npm haptics library | Project is zero-dependency vanilla JS; the checkbox trick is ~10 lines of inline code |

## Architecture Patterns

### Existing Patterns to Follow

The codebase has a well-established architecture that Phase 2 must integrate with:

```
index.html (single-file SPA, ~3,500 lines)
  |-- Global state object: let S = { ... }
  |-- Firebase Firestore compat SDK via CDN
  |-- render() rebuilds DOM via template literals
  |-- saveState() -> localStorage + debounced Firestore write
  |-- connectToRoom() -> onSnapshot listener merges remote state
  |-- VIEW_LOCAL array separates local-only vs synced state keys
  |-- requireAdmin() gates all mutations behind admin PIN
  |-- getMyPlayerId() / setMyPlayerId() for player identity
```

### Pattern 1: Absolute Timestamp Timer Sync
**What:** Store `pickDeadline` (Firestore Timestamp) in the room document. Each client computes remaining time as `pickDeadline.toMillis() - Date.now()`. No decrementing counters.
**When to use:** Any time a countdown needs to stay synchronized across multiple clients and survive background tab throttling.
**Why absolute timestamps:** Browsers throttle `setInterval` to once per second (or slower) in background tabs. A decrementing counter would drift. An absolute deadline self-corrects every tick.

```javascript
// When starting a pick turn (in the draft state):
const durationMs = S.draftClock.duration * 1000; // e.g., 90000
const deadline = new Date(Date.now() + durationMs);

// Store in room state alongside draft state
S.ds.pickDeadline = firebase.firestore.Timestamp.fromDate(deadline);
// Save triggers Firestore write via existing _debouncedFirestoreWrite()

// On each render tick (1-second setInterval):
const remaining = Math.max(0, S.ds.pickDeadline.toMillis() - Date.now());
const seconds = Math.ceil(remaining / 1000);
```

### Pattern 2: Player Identity with PIN
**What:** Each player has `{ id, name, pinHash, teamIds }`. On first join, player enters name + 4-digit PIN. Identity stored in localStorage as `mm4_me_{roomId}`. PIN only needed to reclaim on new device.
**When to use:** The existing passphrase system is nearly identical -- this simplifies it to a 4-digit PIN and makes it mandatory (not optional).

```javascript
// Player object in S.players array:
{
  id: "uuid-string",        // crypto.randomUUID()
  name: "Joe",              // display name
  pinHash: "a1b2c3...",     // SHA-256 of 4-digit PIN (64 hex chars)
  teamIds: []               // drafted team IDs
}

// First join flow:
// 1. User opens ?room=CODE link
// 2. renderJoinScreen() shows "Enter your name and PIN"
// 3. User enters name + PIN -> hash PIN -> create player in S.players
// 4. setMyPlayerId(newPlayer.id) -> localStorage
// 5. saveState() -> Firestore sync

// Returning user (same device):
// 1. getMyPlayerId() returns stored ID
// 2. S.players.find(p => p.id === myId) -> recognized, skip join screen

// Reclaim on new device:
// 1. User sees player list, taps their name
// 2. Prompted for PIN
// 3. hashPin(entry) === player.pinHash -> setMyPlayerId(player.id)
```

### Pattern 3: Turn-Based Draft Enforcement
**What:** Only the current drafter can make picks. All other players see disabled pick buttons. Enforcement is client-side via `getMyPlayerId() === S.ds.order[S.ds.cp]`.
**When to use:** During the draft phase when `S.ds.started && !S.ds.complete`.

```javascript
// In renderDraft():
const myId = getMyPlayerId();
const isMyTurn = myId === S.ds.order[S.ds.cp];

// Pick buttons: disabled unless it's my turn
`<button class="pick-btn" onclick="pickTeam('${t.id}')"
  ${!isMyTurn || ds.complete ? 'disabled' : ''}>...</button>`

// pickTeam() no longer requires admin:
async function pickTeam(tid) {
  const myId = getMyPlayerId();
  if (myId !== S.ds.order[S.ds.cp]) {
    showToast("It's not your turn!");
    return;
  }
  // ... existing pick logic (minus requireAdmin() gate)
}
```

### Pattern 4: Audio Alert via Web Audio API
**What:** Synthesize a short beep tone using OscillatorNode. No audio file needed.
**When to use:** DRFT-06 -- play at 10 seconds remaining.

```javascript
// Create once, reuse:
let audioCtx = null;

function playTimerBeep() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880; // A5 note
  osc.type = 'sine';
  gain.gain.value = 0.3;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
  osc.stop(audioCtx.currentTime + 0.3);
}

// IMPORTANT: AudioContext must be created/resumed after user gesture.
// Initialize on first user interaction (tap/click) to satisfy autoplay policy.
```

### Anti-Patterns to Avoid

- **Decrementing counter for timer:** Background tabs throttle setInterval to 1s+. A counter that decrements `remaining--` will drift badly. Always compute from absolute deadline.
- **Storing timer state only in localStorage:** The timer must sync across all clients via Firestore. localStorage is for local identity only.
- **Using requireAdmin() for draft picks:** Currently all picks require admin PIN. Phase 2 replaces this with turn-based identity checks. The active drafter should be able to pick without being admin.
- **Creating new AudioContext on every beep:** Browsers limit AudioContext instances. Create once and reuse.
- **Firing auto-pick from all clients simultaneously:** Only one client should trigger auto-pick. Use the active drafter's client as primary, with a grace period before other clients attempt it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 hashing | Custom hash function | `crypto.subtle.digest('SHA-256', ...)` | Already used in codebase (`hashPin()`); secure, fast, built-in |
| UUID generation | Math.random ID | `crypto.randomUUID()` | Already used in codebase (`generateId()`); collision-free |
| Real-time sync | WebSocket server | Firestore `onSnapshot()` | Already the backbone of the app; handles offline, reconnect, multi-tab |
| Timer audio | Audio file loading | Web Audio API `OscillatorNode` | Zero-dependency; works offline; no CORS/caching issues |
| iOS haptics | npm library | Hidden `<input type="checkbox" switch>` toggle trick | ~10 lines; zero dependencies; matches project constraints |

**Key insight:** The entire app is zero-dependency vanilla JS with Firebase via CDN. Every solution must fit this constraint. All needed APIs (Web Crypto, Web Audio, Vibration) are built into browsers.

## Common Pitfalls

### Pitfall 1: Background Tab Timer Drift
**What goes wrong:** Using `setInterval` with a decrementing counter. When the tab is backgrounded, Chrome throttles timers to max 1/second (or slower after 5 min). Counter falls behind real time.
**Why it happens:** Browsers aggressively throttle timers in background tabs to save battery.
**How to avoid:** Store `pickDeadline` as absolute Firestore Timestamp. On each tick, compute `remaining = pickDeadline - Date.now()`. This self-corrects even after long background periods.
**Warning signs:** Timer shows more remaining time than other clients; timer "jumps" when returning to the tab.

### Pitfall 2: AudioContext Autoplay Policy
**What goes wrong:** Creating an `AudioContext` and playing sound without prior user interaction. Browser silently blocks audio.
**Why it happens:** Chrome 66+, Firefox 66+, and Safari all require a user gesture before `AudioContext` can produce sound.
**How to avoid:** Create or resume the `AudioContext` on the first user interaction (e.g., any button click in the app). The draft flow naturally involves clicks (joining, navigating), so warm up the AudioContext on any of these.
**Warning signs:** No sound plays at 10-second warning; console shows "AudioContext was not allowed to start."

### Pitfall 3: Race Condition on Auto-Pick
**What goes wrong:** Multiple clients detect timer expiry simultaneously and all try to auto-pick, causing duplicate picks or state corruption.
**Why it happens:** Firestore onSnapshot fires on all connected clients at roughly the same time.
**How to avoid:** Only the active drafter's client triggers auto-pick. Other clients wait a grace period (e.g., 3 seconds) before attempting auto-pick as a fallback. The `saveState()` debounce (800ms) and Firestore's last-write-wins model provide natural serialization.
**Warning signs:** Draft counter jumps by 2; a team appears on two rosters.

### Pitfall 4: Server Timestamp Null on Local Snapshot
**What goes wrong:** Writing `pickDeadline: firebase.firestore.FieldValue.serverTimestamp()` and immediately reading it back -- the local snapshot shows `null` for the timestamp field.
**Why it happens:** Server timestamps are resolved server-side. The local write completes before the server confirms.
**How to avoid:** Don't use `FieldValue.serverTimestamp()` for the deadline. Instead, compute deadline client-side: `Timestamp.fromDate(new Date(Date.now() + durationMs))`. This gives an immediate local value. The small clock skew between clients (typically < 1 second) is acceptable for a draft timer.
**Warning signs:** Timer shows NaN or starts from wrong value on the drafter's screen.

### Pitfall 5: Firestore Security Rules and Turn Enforcement
**What goes wrong:** Trying to enforce "only the current drafter can write" in Firestore security rules, but the room document stores ALL state as a single JSON string in the `state` field.
**Why it happens:** The existing architecture serializes the entire `S` object to `JSON.stringify(shared)` and stores it as a single `state` string field. Firestore rules cannot parse JSON strings.
**How to avoid:** Accept that server-side turn enforcement is not possible with the current architecture without major restructuring. Enforce turns client-side (AUTH-05 requirement says "enforced by Firestore security rules" but the architecture makes this impractical without breaking the single-document model). Document this as a known limitation: client-side enforcement is sufficient for friend-group trust model. Alternatively, store `currentDrafterId` as a top-level field on the room document for rule validation, but this adds complexity.
**Warning signs:** Attempting to restructure the room document model to enable per-field security rules, which would be a massive scope expansion.

### Pitfall 6: iOS Haptic Compatibility
**What goes wrong:** Assuming `navigator.vibrate()` works on iOS Safari. It does not.
**Why it happens:** Safari/WebKit has never implemented the W3C Vibration API.
**How to avoid:** Use the `<input type="checkbox" switch>` hidden toggle trick for iOS (Safari 17.4+). Feature-detect and fall back to `navigator.vibrate()` for Android. If neither is available, silently degrade (DRFT-07 says "drop entirely if iOS unsupported").
**Warning signs:** Haptics work on Android but not iOS; error in console about vibrate not being a function.

## Code Examples

### Draft Clock Countdown Rendering
```javascript
// Timer state added to S.ds:
// S.ds.pickDeadline: Firestore Timestamp or null
// S.ds.timerDuration: number (seconds, e.g. 90)
// S.ds.timerPaused: boolean
// S.ds.pausedRemaining: number (ms remaining when paused)

let clockInterval = null;

function startDraftClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(updateDraftClock, 250); // 4Hz for smooth display
}

function stopDraftClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
}

function updateDraftClock() {
  if (!S.ds.pickDeadline || S.ds.timerPaused) return;
  const deadline = S.ds.pickDeadline.toMillis
    ? S.ds.pickDeadline.toMillis()
    : S.ds.pickDeadline; // handle both Timestamp and number
  const remaining = Math.max(0, deadline - Date.now());
  const seconds = Math.ceil(remaining / 1000);

  // Update display (without full re-render)
  const el = document.getElementById('draft-timer');
  if (el) {
    el.textContent = seconds + 's';
    el.className = seconds > 30 ? 'timer-green'
                 : seconds > 10 ? 'timer-yellow'
                 : 'timer-red';
  }

  // Audio alert at 10 seconds
  if (seconds === 10 && !el?._beeped) {
    playTimerBeep();
    triggerHaptic();
    el._beeped = true;
  }

  // Auto-pick on expiry (only active drafter triggers)
  if (remaining === 0) {
    const myId = getMyPlayerId();
    if (myId === S.ds.order[S.ds.cp]) {
      autoPickHighestSeed();
    }
  }
}
```

### Haptic Feedback (Cross-Platform)
```javascript
// DRFT-07: Haptic feedback with iOS checkbox trick + Android vibrate fallback
let _hapticCheckbox = null;

function triggerHaptic() {
  // Android: standard Vibration API
  if (navigator.vibrate) {
    navigator.vibrate(50);
    return;
  }

  // iOS Safari 17.4+: hidden checkbox switch trick
  try {
    if (!_hapticCheckbox) {
      _hapticCheckbox = document.createElement('input');
      _hapticCheckbox.type = 'checkbox';
      _hapticCheckbox.setAttribute('switch', '');
      _hapticCheckbox.style.cssText = 'position:fixed;top:-100px;opacity:0;pointer-events:none';
      const label = document.createElement('label');
      label.style.cssText = 'position:fixed;top:-100px;opacity:0;pointer-events:none';
      const id = 'haptic-' + Date.now();
      _hapticCheckbox.id = id;
      label.htmlFor = id;
      _hapticCheckbox._label = label;
      document.body.appendChild(_hapticCheckbox);
      document.body.appendChild(label);
    }
    _hapticCheckbox._label.click();
  } catch (e) {
    // Silently degrade -- haptics are optional
  }
}
```

### Self-Registering Player Join Flow
```javascript
// New flow: player opens room link, registers themselves
async function selfRegister() {
  const name = document.getElementById('join-name').value.trim();
  const pin = document.getElementById('join-pin').value.trim();
  if (!name) { showToast('Enter your name'); return; }
  if (!/^\d{4}$/.test(pin)) { showToast('PIN must be 4 digits'); return; }

  // Check for name collision
  if (S.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    showToast('That name is taken. Try another or reclaim your player.');
    return;
  }

  const pinHash = await hashPin(pin);
  const player = { id: generateId(), name, pinHash, teamIds: [] };
  S.players.push(player);
  setMyPlayerId(player.id);
  saveState(); // Syncs to Firestore
  render();
}

// Reclaim existing player on new device
async function reclaimPlayer(playerId) {
  const player = S.players.find(p => p.id === playerId);
  if (!player) return;
  const pin = await appPrompt('Enter your 4-digit PIN:', { title: 'Verify Identity' });
  if (!pin) return;
  const hash = await hashPin(pin.trim());
  if (hash !== player.pinHash) {
    await appAlert('Incorrect PIN.');
    return;
  }
  setMyPlayerId(player.id);
  render();
}
```

### Commissioner Clock Controls
```javascript
// DRFT-05: Pause/resume
function pauseDraftClock() {
  if (!S.ds.pickDeadline) return;
  const remaining = Math.max(0, S.ds.pickDeadline.toMillis() - Date.now());
  S.ds.timerPaused = true;
  S.ds.pausedRemaining = remaining;
  S.ds.pickDeadline = null;
  saveState();
  render();
}

function resumeDraftClock() {
  if (!S.ds.timerPaused) return;
  const deadline = new Date(Date.now() + S.ds.pausedRemaining);
  S.ds.pickDeadline = firebase.firestore.Timestamp.fromDate(deadline);
  S.ds.timerPaused = false;
  S.ds.pausedRemaining = null;
  saveState();
  render();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Decrementing counters for timers | Absolute deadline timestamps | Standard practice ~2020+ | Immune to background tab throttling |
| `navigator.vibrate()` for iOS | Hidden `<input switch>` checkbox trick | Safari 17.4 (Mar 2024) | First reliable iOS web haptic method |
| `webkitAudioContext` prefix | `AudioContext` (unprefixed) | Chrome 66+ / Safari 14.1+ | Can still use `window.AudioContext \|\| window.webkitAudioContext` for safety |
| Admin-gated all mutations | Turn-based player identity | This phase | Enables multiplayer draft without admin babysitting |

**Deprecated/outdated:**
- `webkitAudioContext`: Still works but `AudioContext` is standard everywhere. Use fallback pattern.
- Optional passphrases for players: The current `passphraseHash` field (optional) is being replaced by mandatory `pinHash` (4-digit PIN).

## Open Questions

1. **Firestore Security Rules for Turn Enforcement (AUTH-05)**
   - What we know: AUTH-05 says "enforced by Firestore security rules." The current architecture stores all state as a single JSON string (`state` field). Firestore rules cannot parse JSON strings.
   - What's unclear: Whether AUTH-05 strictly requires server-side enforcement or if client-side enforcement is acceptable given the friend-group trust model.
   - Recommendation: Implement client-side enforcement (sufficient for the use case). Optionally store `currentDrafterId` as a top-level room document field alongside `state` for future rule validation. Do not restructure the room document model -- that would be scope creep.

2. **Auto-Pick Coordination**
   - What we know: When the timer expires, the highest available seed should be auto-picked. Multiple clients will detect expiry simultaneously.
   - What's unclear: Whether Firestore's last-write-wins model is sufficient or if we need an explicit lock mechanism.
   - Recommendation: Active drafter's client triggers auto-pick immediately on expiry. Other clients wait 3 seconds before fallback attempt. Firestore's debounced write pattern (800ms) + last-write-wins is sufficient at friend-group scale (10-20 concurrent rooms).

3. **DRFT-07: Haptic Support Decision**
   - What we know: The requirement says "conditional -- drop entirely if iOS unsupported." The hidden checkbox switch trick (Safari 17.4+, iOS 17.4+) provides iOS haptics. `navigator.vibrate()` covers Android.
   - What's unclear: Whether iOS 17.4+ coverage is sufficient for the user base (most iPhone users on iOS 17+ by March 2026).
   - Recommendation: Implement with feature detection. The code is ~15 lines. If it works, great. If not, it silently degrades. No risk.

4. **Self-Registration vs Admin-Creates-Players**
   - What we know: Currently the admin adds players manually in the Setup tab. The requirements (AUTH-02) say "New players enter display name + 4-digit PIN on first join via the link."
   - What's unclear: Whether players should self-register (creating their own player entry) or if the admin pre-creates player slots and players claim them.
   - Recommendation: Support both flows. Admin can still pre-create players (existing flow). Players can also self-register via the join screen. This preserves backward compatibility while enabling the new flow.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual browser testing (no automated test framework in project) |
| Config file | None -- zero-dependency vanilla JS project |
| Quick run command | Open `index.html?room=TEST` in browser |
| Full suite command | Manual test matrix across Chrome, Safari, Chrome Android, iOS Safari |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Shared room link opens directly to room | manual | Open `?room=CODE` link in new browser | N/A |
| AUTH-02 | New player enters name + PIN on first join | manual | Open room link in incognito, fill form | N/A |
| AUTH-03 | Identity persists via localStorage | manual | Join room, close tab, reopen same URL | N/A |
| AUTH-04 | PIN reclaim on new device | manual | Clear localStorage, reopen room, tap name, enter PIN | N/A |
| AUTH-05 | Only current drafter can pick | manual | Open two browser windows as different players | N/A |
| AUTH-06 | Non-active drafters see disabled controls | manual | Check pick buttons while not your turn | N/A |
| DRFT-01 | Configurable timer duration (60/90/120/none) | manual | Create room, set timer in setup | N/A |
| DRFT-02 | Color thresholds (green/yellow/red) | manual | Watch timer count down through thresholds | N/A |
| DRFT-03 | Timer syncs via Firestore server timestamps | manual | Open room in two browsers, compare timers | N/A |
| DRFT-04 | Auto-pick highest seed on expiry | manual | Let timer expire, verify correct team picked | N/A |
| DRFT-05 | Commissioner pause/resume clock | manual | Admin pauses mid-timer, resumes, verify continuity | N/A |
| DRFT-06 | Audio alert at 10 seconds | manual | Let timer reach 10s, listen for beep | N/A |
| DRFT-07 | Haptic alert (conditional) | manual | Test on iOS Safari + Android Chrome | N/A |

### Sampling Rate
- **Per task commit:** Reload `index.html?room=TEST` in browser, walk through modified flow
- **Per wave merge:** Full manual test: create room -> add players -> start draft -> timer -> auto-pick -> verify across 2 browsers
- **Phase gate:** Cross-browser test matrix (Chrome desktop, Chrome Android, iOS Safari) before `/gsd:verify-work`

### Wave 0 Gaps
- None -- no automated test infrastructure exists in this project. All testing is manual browser-based. This is appropriate for a zero-dependency vanilla JS SPA at friend-group scale.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- Direct reading of `index.html` (3,605 lines), `firestore.rules`, `sw.js`, `manifest.json`
- [Firebase SnapshotOptions reference](https://firebase.google.com/docs/reference/node/firebase.firestore.SnapshotOptions) -- serverTimestamps "estimate" option
- [Firebase Firestore real-time listeners](https://firebase.google.com/docs/firestore/query-data/listen) -- onSnapshot, hasPendingWrites
- [Firebase security rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions) -- request.resource.data validation
- [Web Audio API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API) -- OscillatorNode, AudioContext, autoplay policy
- [Chrome timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) -- background tab throttling behavior

### Secondary (MEDIUM confidence)
- [ios-haptics library (GitHub)](https://github.com/tijnjh/ios-haptics) -- checkbox switch trick implementation reference
- [Ionic framework haptic feedback PR](https://github.com/ionic-team/ionic-framework/issues/29942) -- iOS 18+ haptic via switch input
- [WebKit Safari 18.0 features](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/) -- switch control haptic feedback confirmation
- [Browser timer throttling explainer](https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/) -- deep dive on throttling behavior

### Tertiary (LOW confidence)
- Haptic feedback in PWA standalone mode on iOS -- not definitively confirmed whether the checkbox trick works in standalone (non-browser) mode. Feature detection handles this gracefully.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All APIs are built-in browser features already used in the codebase (Firestore, Web Crypto, localStorage). No new dependencies needed.
- Architecture: HIGH -- The existing patterns (single state object, Firestore sync, localStorage identity) directly support the new features. Timer sync via absolute timestamps is well-established.
- Pitfalls: HIGH -- Background tab throttling, AudioContext autoplay policy, and iOS vibration limitations are well-documented browser behaviors with known workarounds.
- Haptics (DRFT-07): MEDIUM -- The iOS checkbox trick is relatively new (Safari 17.4+) and PWA standalone behavior is not definitively confirmed. Feature detection makes this safe regardless.

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (30 days -- stable browser APIs, no fast-moving dependencies)

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | Creator can share a join link that opens directly to the room | Existing `?room=CODE` URL parameter already routes to room. Sharing implemented in Phase 1 (SHAR-01). Join flow just needs the identity gate. |
| AUTH-02 | New players enter display name + 4-digit PIN on first join via the link | Self-registration pattern documented in Code Examples section. Replaces current passphrase with mandatory 4-digit PIN. Uses existing `hashPin()` and `generateId()`. |
| AUTH-03 | Identity persists via localStorage -- no re-entry needed after first login | Existing `getMyPlayerId()`/`setMyPlayerId()` pattern using `mm4_me_{roomId}` localStorage key. Already works; just needs to be the primary gate in `render()`. |
| AUTH-04 | PIN only needed to reclaim identity on new device or cleared browser | Reclaim flow documented in Code Examples: user taps name from player list, enters PIN, hash compared to stored `pinHash`. Matches existing `claimPlayer()` pattern. |
| AUTH-05 | Only the current drafter can make a pick, enforced by Firestore security rules | Client-side enforcement pattern documented. Server-side enforcement limited by single-JSON-string architecture (see Open Questions #1). Client-side is sufficient for friend-group trust model. |
| AUTH-06 | UI disables pick controls for non-active drafters | Turn-based enforcement pattern documented: compare `getMyPlayerId()` against `S.ds.order[S.ds.cp]`, disable pick buttons for non-active players. |
| DRFT-01 | Configurable timer duration per room (60s, 90s, 120s, no limit) | Add `timerDuration` to draft state. Selectable in Setup/Settings. "No limit" means `pickDeadline` is null. |
| DRFT-02 | Visual countdown with color thresholds (green > yellow > red) | Timer rendering pattern documented: green > 30s, yellow > 10s, red <= 10s. CSS classes for color transitions. |
| DRFT-03 | Timer syncs across all players via Firestore server timestamps (pickDeadline) | Absolute timestamp pattern documented. Store `pickDeadline` as Firestore Timestamp. Client computes remaining from `deadline - now`. Self-corrects on background tab return. |
| DRFT-04 | Auto-pick highest available seed when timer expires | Active drafter's client triggers auto-pick. Sort available teams by seed ascending, pick first. Race condition mitigation documented (3-second grace period for fallback clients). |
| DRFT-05 | Commissioner can pause and resume the clock | Pause stores `pausedRemaining`, clears `pickDeadline`. Resume computes new deadline from `now + pausedRemaining`. Commissioner = admin (requireAdmin check). |
| DRFT-06 | Audio alert at 10 seconds remaining | Web Audio API OscillatorNode pattern documented. 880Hz sine wave, 300ms duration. Must warm up AudioContext on user gesture to satisfy autoplay policy. |
| DRFT-07 | Haptic alert on timer events (conditional -- drop if iOS unsupported) | Cross-platform haptic pattern documented: `navigator.vibrate()` for Android, hidden checkbox switch trick for iOS Safari 17.4+. Feature detection with silent degradation. |
</phase_requirements>
