# Phase 1: Foundation & Client-Side Enhancements - Research

**Researched:** 2026-03-11
**Domain:** PWA APIs (Service Worker caching, Web App Manifest, Web Share API, Screen Wake Lock API)
**Confidence:** HIGH

## Summary

Phase 1 addresses the foundational PWA layer: fixing a cache-first service worker that prevents updates from reaching installed PWAs, polishing the manifest for a native install experience with app shortcuts, adding native sharing via the Web Share API, and keeping the screen awake during live score viewing via the Screen Wake Lock API.

The existing codebase is a single-file vanilla JS PWA (`index.html` at ~3,500 lines) with a minimal `sw.js` (48 lines, cache-first strategy) and a basic `manifest.json`. All tab navigation is internal (`S.phase` state variable, rendered into a single page). Room context is carried via `?room=XXXX` query parameter. There is no build step, no package.json, and no test framework.

**Primary recommendation:** Rewrite `sw.js` to use network-first for the HTML document (fixing the stale-cache problem), enhance `manifest.json` with shortcuts and branding, add share utility functions with Web Share API + clipboard fallback, and implement Screen Wake Lock with automatic re-acquisition on visibility change.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FNDN-01 | Service worker uses network-first strategy for index.html so updates reach installed PWAs | Network-first pattern documented below with full code; current cache-first pattern identified as root cause of stale installs |
| FNDN-02 | Manifest updated with enhanced splash screen branding (background_color, theme_color, larger icons, display_override) | Manifest spec for display_override, icon sizing, and theme branding researched; current manifest has white background and minimal icons |
| FNDN-03 | App shortcuts in manifest for Live Scores, Bracket, and Leaderboard tabs | Shortcuts spec documented; URL structure uses query params (`?tab=live`) since app is SPA; app must read `tab` param at boot to auto-navigate |
| SHAR-01 | Native share via Web Share API with clipboard fallback for room links | Web Share API fully documented with feature detection, user-activation requirement, and clipboard fallback pattern |
| SHAR-02 | Share room code/link via OS share sheet (Messages, WhatsApp, etc.) | Same as SHAR-01 -- the Web Share API invokes the OS share sheet which includes Messages, WhatsApp, etc. |
| SHAR-03 | Share leaderboard standings as formatted text | `scores()` function returns sorted player data; research includes pattern for formatting standings as plain text and sharing via Web Share API |
| LIVE-01 | Screen wake lock keeps display active on Live Scores tab | Screen Wake Lock API documented with `navigator.wakeLock.request("screen")` pattern; 94.6% global browser support including iOS 16.4+ |
| LIVE-02 | Wake lock re-acquires automatically on tab visibility change | `visibilitychange` event pattern documented; must re-request lock when document becomes visible again after being hidden |
</phase_requirements>

## Standard Stack

### Core

This project uses **no npm packages** -- it is vanilla HTML/CSS/JS served from GitHub Pages with Firebase as the backend. All Phase 1 APIs are browser-native.

| API | Spec Status | Purpose | Browser Support |
|-----|-------------|---------|-----------------|
| Service Worker API | W3C Standard | Cache management, offline support | 97%+ global |
| Web App Manifest | W3C Standard | Install experience, shortcuts, branding | 96%+ global |
| Web Share API | W3C Standard | Native OS sharing | 92.9% global (no Firefox desktop) |
| Screen Wake Lock API | W3C CR | Prevent screen dimming | 94.6% global (Safari 16.4+, iOS PWA fixed in 18.4) |
| Clipboard API | W3C Standard | Fallback for Web Share | 95%+ global |

### Supporting

| API | Purpose | When to Use |
|-----|---------|-------------|
| `navigator.canShare()` | Pre-check share support | Before calling `navigator.share()` |
| `document.visibilityState` | Detect tab visibility | Re-acquire wake lock on tab return |
| `navigator.clipboard.writeText()` | Copy to clipboard | Fallback when Web Share API unavailable |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled network-first SW | Workbox library | Workbox is standard for complex apps, but adds a build step; this app has no build tooling and the SW logic is simple enough (~50 lines) to hand-roll |
| `navigator.share()` | Third-party share libraries | Unnecessary; the native API is well-supported and the clipboard fallback covers the gap |

## Architecture Patterns

### Current Project Structure (unchanged by Phase 1)
```
madness/
  index.html        # Single-file app (~3,500 lines: HTML + CSS + JS)
  sw.js             # Service worker (rewritten in this phase)
  manifest.json     # Web app manifest (enhanced in this phase)
  firestore.rules   # Firestore security rules
  icons/            # App icons (may need additions for shortcuts)
    icon-192.png
    icon-512.png
    apple-touch-icon.png
    icon.png         # Source icon (738KB)
```

### Pattern 1: Network-First for HTML, Cache-First for Static Assets
**What:** Use different caching strategies based on request type. HTML documents get network-first (freshness matters), while external libraries (Firebase SDK CDN) get cache-first (versioned, rarely change).
**When to use:** Always -- this is the correct default for a PWA that updates frequently.
**Example:**
```javascript
// Source: MDN Caching Guide + Chrome DevDocs
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Pass through Firestore API calls (no caching)
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebaseio.com')) {
    return;
  }

  // Network-first for navigation requests (HTML)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const cache = caches.open(CACHE_NAME);
          cache.then(c => c.put(event.request, response.clone()));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for static assets (CDN scripts, icons)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
```

### Pattern 2: Web Share with Clipboard Fallback
**What:** Try `navigator.share()` first; if unavailable or rejected, fall back to `navigator.clipboard.writeText()`.
**When to use:** Any share button in the app.
**Example:**
```javascript
// Source: MDN Navigator.share() docs
async function shareContent({ title, text, url }) {
  const shareData = { title, text, url };

  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User cancelled, not an error
      // Fall through to clipboard
    }
  }

  // Clipboard fallback
  const fallbackText = url || text || '';
  try {
    await navigator.clipboard.writeText(fallbackText);
    showToast('Copied to clipboard!');
  } catch {
    showToast('Link: ' + fallbackText);
  }
}
```

### Pattern 3: Wake Lock with Visibility Re-acquisition
**What:** Request a screen wake lock when entering the Live Scores tab, release when leaving, and re-acquire when the tab becomes visible again.
**When to use:** Only on the Live Scores tab.
**Example:**
```javascript
// Source: MDN Screen Wake Lock API docs
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    console.warn('Wake Lock request failed:', err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Re-acquire on tab visibility change
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.phase === 'live') {
    requestWakeLock();
  }
});
```

### Pattern 4: Manifest Shortcuts for SPA Tab Navigation
**What:** Define shortcuts in manifest.json that link to specific tabs using query parameters. The app reads the `tab` param on boot and auto-navigates.
**When to use:** Shortcuts to Live Scores, Bracket, Leaderboard.
**Example (manifest.json):**
```json
{
  "shortcuts": [
    {
      "name": "Live Scores",
      "short_name": "Live",
      "url": "./?tab=live",
      "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192" }]
    },
    {
      "name": "Bracket",
      "short_name": "Bracket",
      "url": "./?tab=bracket",
      "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192" }]
    },
    {
      "name": "Leaderboard",
      "short_name": "Board",
      "url": "./?tab=leaderboard",
      "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192" }]
    }
  ]
}
```
**Boot handler addition in index.html:**
```javascript
const tabParam = params.get("tab");
if (tabParam && ['live','bracket','leaderboard','draft','setup'].includes(tabParam)) {
  S.phase = tabParam;
}
```

### Anti-Patterns to Avoid
- **Cache-first for HTML:** The current `sw.js` uses cache-first for everything including `index.html`. This means installed PWAs never get updates unless the SW itself changes. This is the root cause of stale installs.
- **Bumping CACHE_NAME for updates:** Changing `CACHE_NAME` from `mm-draft-v3` to `v4` would bust the cache, but only when the SW file changes AND the browser checks for SW updates. Network-first for HTML is the proper fix.
- **Calling `navigator.share()` without user gesture:** The API requires transient user activation (a click). Calling it from a timer or lifecycle event will throw `NotAllowedError`.
- **Requesting wake lock on page load:** Only request when the user navigates to Live Scores, not globally. Unnecessary wake locks drain battery.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Share sheet | Custom share modal with platform icons | `navigator.share()` | Native share sheet knows installed apps, handles intents, respects user preferences |
| Clipboard copy | Manual `document.execCommand('copy')` | `navigator.clipboard.writeText()` | execCommand is deprecated; Clipboard API is the standard replacement |
| Screen keep-awake | NoSleep.js or hidden video hack | `navigator.wakeLock.request('screen')` | Native API is battery-efficient, OS-integrated, and supported everywhere now |
| SW caching library | N/A | Hand-rolled is fine here | Workbox would be overkill -- the entire SW is ~50 lines. No build step exists. |

**Key insight:** All Phase 1 features use well-supported browser-native APIs. There are zero npm dependencies required.

## Common Pitfalls

### Pitfall 1: Service Worker Update Never Reaches Installed PWA
**What goes wrong:** User installs the PWA, developer deploys updates, but the user keeps seeing the old version indefinitely.
**Why it happens:** Cache-first strategy serves `index.html` from cache before checking the network. The SW only updates when the browser's 24-hour byte-check finds a changed `sw.js` file AND the new SW activates. With cache-first, even if the SW updates, the cached HTML is still stale.
**How to avoid:** Network-first for navigation requests. The HTML is always fetched fresh when online, cached copy only used when offline.
**Warning signs:** Users report "I don't see the new feature" after deploy.

### Pitfall 2: Wake Lock Lost on Tab Switch, Never Re-acquired
**What goes wrong:** User switches to another app (or tab), comes back to Live Scores, and the screen starts dimming again.
**Why it happens:** The browser automatically releases wake locks when the document becomes hidden. If you don't listen for `visibilitychange` and re-acquire, the lock stays released.
**How to avoid:** Add a `visibilitychange` listener that re-requests the wake lock when `document.visibilityState === 'visible'` and the user is on the Live Scores tab.
**Warning signs:** Screen dims after alt-tabbing back to the app.

### Pitfall 3: Wake Lock Fails Silently in Installed PWA on iOS < 18.4
**What goes wrong:** Wake lock appears to work in Safari browser but fails silently in the installed PWA.
**Why it happens:** WebKit bug 254545 -- wake lock was broken in home-screen web apps until iOS 18.4 (released March 2025).
**How to avoid:** Feature-detect and handle gracefully. Most users on iOS 18+ by tournament time (March 2026). No workaround for older iOS -- just don't break.
**Warning signs:** Test on an actual installed iOS PWA, not just Safari browser.

### Pitfall 4: Web Share Throws on Desktop Firefox
**What goes wrong:** Calling `navigator.share()` throws because Firefox desktop doesn't support it.
**Why it happens:** Firefox desktop has never shipped Web Share API support.
**How to avoid:** Always feature-detect with `if (navigator.share && navigator.canShare)` before calling. Fall back to clipboard.
**Warning signs:** JavaScript errors on Firefox desktop.

### Pitfall 5: Manifest Shortcuts Require App Re-install
**What goes wrong:** Adding shortcuts to manifest.json doesn't appear for users who already installed the PWA.
**Why it happens:** Chrome re-reads the manifest periodically but shortcuts may not update until the next install or browser update cycle.
**How to avoid:** Not much you can do -- this is a browser limitation. For the 2026 tournament, most users will be fresh installs anyway. Document this as a known limitation.
**Warning signs:** Existing PWA installs don't show new shortcuts.

### Pitfall 6: Shortcuts URL Must Be Within Manifest Scope
**What goes wrong:** Shortcut URLs that are outside the manifest's scope are silently ignored.
**Why it happens:** The manifest scope defaults to the start_url directory. Shortcuts must resolve within it.
**How to avoid:** Use relative URLs like `./?tab=live` which resolve within the same directory as the manifest.
**Warning signs:** Shortcuts don't appear in the long-press context menu.

## Code Examples

### Service Worker: Network-First for HTML (FNDN-01)
```javascript
// Source: MDN Caching Guide, Chrome DevDocs Caching Strategies
const CACHE_NAME = 'mm-draft-v4';
const PRECACHE_URLS = [
  './',
  './index.html',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Pass through Firestore/Firebase API calls
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      (url.hostname.includes('firebase') && url.pathname.includes('/documents/'))) {
    return;
  }

  // Network-first for navigation requests (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for everything else (CDN scripts, icons, images)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
```

### Enhanced Manifest (FNDN-02, FNDN-03)
```json
{
  "name": "March Madness Draft",
  "short_name": "MM Draft",
  "description": "March Madness bracket pool with snake draft",
  "start_url": ".",
  "display": "standalone",
  "display_override": ["standalone"],
  "orientation": "any",
  "background_color": "#1a1a1a",
  "theme_color": "#C5991A",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "shortcuts": [
    {
      "name": "Live Scores",
      "short_name": "Live",
      "url": "./?tab=live",
      "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" }]
    },
    {
      "name": "Bracket",
      "short_name": "Bracket",
      "url": "./?tab=bracket",
      "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" }]
    },
    {
      "name": "Leaderboard",
      "short_name": "Board",
      "url": "./?tab=leaderboard",
      "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" }]
    }
  ]
}
```

### Share Room Link (SHAR-01, SHAR-02)
```javascript
// Source: MDN Navigator.share() + Navigator.clipboard.writeText()
async function shareRoomLink() {
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  const shareUrl = url.toString();

  const shareData = {
    title: 'March Madness Draft',
    text: `Join my March Madness bracket pool! Room: ${roomId}`,
    url: shareUrl
  };

  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  // Clipboard fallback
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Room link copied!');
  } catch {
    showToast('Link: ' + shareUrl);
  }
}
```

### Share Leaderboard (SHAR-03)
```javascript
// Source: MDN Navigator.share()
async function shareLeaderboard() {
  const sc = scores();
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  let text = `March Madness Draft ${S.year} - Leaderboard\n\n`;
  sc.forEach((s, i) => {
    const prefix = medals[i] || `${i + 1}.`;
    text += `${prefix} ${s.name} - ${s.tot} pts\n`;
  });

  const shareData = { title: 'March Madness Leaderboard', text };

  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Leaderboard copied!');
  } catch {
    showToast(text);
  }
}
```

### Wake Lock for Live Scores (LIVE-01, LIVE-02)
```javascript
// Source: MDN Screen Wake Lock API
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    // Battery saver mode, permission denied, etc.
    console.warn('Wake Lock failed:', err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Re-acquire on visibility change (browser releases lock when tab hidden)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.phase === 'live') {
    requestWakeLock();
  }
});

// Integration points in existing navigate() function:
// - Call requestWakeLock() when navigating TO 'live'
// - Call releaseWakeLock() when navigating AWAY from 'live'
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cache-first for all resources | Network-first for HTML, cache-first for static assets | Best practice since ~2020 | Installed PWAs always get latest HTML when online |
| `document.execCommand('copy')` | `navigator.clipboard.writeText()` | Deprecated ~2021 | Old API still works but Clipboard API is the standard |
| NoSleep.js (hidden video hack) | `navigator.wakeLock.request('screen')` | Baseline Dec 2024 | Native API, no hacks, battery-efficient |
| Custom share modals | `navigator.share()` | Widely supported since 2023 | Native OS integration, knows installed apps |

**Deprecated/outdated:**
- `document.execCommand('copy')`: Deprecated. Use Clipboard API instead.
- NoSleep.js: Unnecessary now that Wake Lock API has universal browser support.
- Cache-first for HTML in PWAs: Not deprecated, but recognized as an anti-pattern for apps that update frequently.

## Haptics Note

The Phase 1 roadmap description mentions "haptics" but the actual Phase 1 requirement IDs do not include haptics. DRFT-07 (haptic alerts on timer events) is mapped to Phase 2. The Vibration API (`navigator.vibrate()`) is NOT supported on iOS Safari (all versions through 18.7) and has only 78% global support. This is correctly deferred to Phase 2 where DRFT-07 is marked "conditional -- drop entirely if iOS unsupported."

## Open Questions

1. **Maskable icon quality**
   - What we know: The existing `icon-512.png` may not have sufficient safe-zone padding for maskable use
   - What's unclear: Whether the source `icon.png` (738KB) has enough padding to be used as maskable
   - Recommendation: Visually inspect `icon-512.png`; if it has tight margins, generate a maskable variant with 40% safe zone padding from the source icon. Use https://maskable.app/ to validate.

2. **Shortcut-specific icons**
   - What we know: The manifest spec supports per-shortcut icons
   - What's unclear: Whether distinct shortcut icons (live scores icon, bracket icon, leaderboard icon) are desired vs. reusing the app icon
   - Recommendation: Reuse `icon-192.png` for all shortcuts initially. Custom icons are a nice-to-have that can be added later.

3. **Tab parameter and room parameter interaction**
   - What we know: Shortcuts use `?tab=live`, rooms use `?room=XXXX`, and these could co-exist (`?room=XXXX&tab=live`)
   - What's unclear: Should shortcuts assume the user has a room open, or should they work from the lobby?
   - Recommendation: Handle both cases. If `tab` param exists and user has a room, navigate to that tab. If no room, show lobby (tab param is ignored since those tabs require a room context for bracket/leaderboard, but live works without one).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None -- no test infrastructure exists |
| Config file | None -- no package.json, no build tooling |
| Quick run command | Manual browser testing |
| Full suite command | Manual browser testing |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FNDN-01 | Network-first SW serves fresh HTML | manual-only | Open installed PWA after deploy, verify new content visible | N/A |
| FNDN-02 | Manifest has enhanced branding | manual-only | Chrome DevTools > Application > Manifest panel inspection | N/A |
| FNDN-03 | Long-press shows 3 shortcuts | manual-only | Long-press PWA icon on Android, verify shortcuts appear | N/A |
| SHAR-01 | Share button invokes OS share sheet | manual-only | Tap share button on mobile, verify share sheet appears | N/A |
| SHAR-02 | Room link shared via OS share sheet | manual-only | Same as SHAR-01, verify room link is in shared content | N/A |
| SHAR-03 | Leaderboard shared as formatted text | manual-only | Tap leaderboard share button, verify formatted text in share sheet | N/A |
| LIVE-01 | Screen stays on during Live Scores | manual-only | Navigate to Live Scores, wait 2+ minutes, verify screen stays on | N/A |
| LIVE-02 | Wake lock re-acquires on tab return | manual-only | Switch away from app, return, verify screen stays on | N/A |

**Justification for manual-only:** All 8 requirements depend on browser-native APIs (Service Worker, Wake Lock, Web Share, Manifest) that cannot be tested without a real browser context. The project has no build tooling, no Node.js dependencies, and no test framework. Given that this is a vanilla JS project with no build step, setting up a test framework (Jest + JSDOM, or Playwright) would be disproportionate to the scope. The APIs involved either require real device interaction (wake lock, share sheet, long-press shortcuts) or require serving from HTTPS (service worker). Chrome DevTools Application panel provides the best verification path.

### Sampling Rate
- **Per task commit:** Visual inspection in Chrome DevTools Application panel
- **Per wave merge:** Test on real Android device (installed PWA)
- **Phase gate:** Verify all 5 success criteria on real device before marking complete

### Wave 0 Gaps
None -- manual testing only. No test infrastructure to set up.

## Sources

### Primary (HIGH confidence)
- [MDN - Manifest shortcuts](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts) - Shortcut spec, required/optional properties, URL scope rules
- [MDN - Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) - Full API: request, release, visibilitychange re-acquisition
- [MDN - Navigator.share()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share) - Parameters, security (HTTPS + user gesture), error handling
- [MDN - Caching strategies](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching) - Network-first pattern code
- [MDN - display_override](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display_override) - Fallback chain specification
- [Chrome DevDocs - Caching Strategies](https://developer.chrome.com/docs/workbox/caching-strategies-overview) - Network-first vs cache-first patterns

### Secondary (MEDIUM confidence)
- [Can I Use - Web Share API](https://caniuse.com/web-share) - 92.9% global support, no Firefox desktop
- [Can I Use - Wake Lock](https://caniuse.com/wake-lock) - 94.6% global, Safari 16.4+, iOS PWA fix in 18.4
- [Can I Use - Vibration API](https://caniuse.com/vibration) - 78% global, NOT supported on any Safari/iOS version
- [WebKit Bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545) - Wake lock broken in iOS installed PWAs until 18.4
- [web.dev - Wake Lock supported in all browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers) - Baseline confirmation

### Tertiary (LOW confidence)
- [GitHub mdn/browser-compat-data #29166](https://github.com/mdn/browser-compat-data/issues/29166) - navigator.vibrate() iOS claim debunked (it's a CSS checkbox hack, not real API support)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All APIs are W3C standards with MDN documentation
- Architecture: HIGH - Patterns are well-established, code examples from official sources
- Pitfalls: HIGH - Common issues well-documented across MDN, web.dev, and Can I Use

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (APIs are stable W3C standards; no expected breaking changes)
