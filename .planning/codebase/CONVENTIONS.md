# Coding Conventions

**Analysis Date:** 2026-03-04

## Naming Patterns

**Files:**
- Lowercase with hyphens: `auth.js`, `match-engine.js`, `client-detail.js`, `firebase-config.js`
- One module per file
- Purpose-driven names reflecting primary responsibility

**Functions:**
- camelCase for exported functions: `calculateMatchScore()`, `getCurrentUser()`, `formatCurrency()`
- camelCase for internal functions: `renderClients()`, `loadClients()`, `applyFilters()`
- Window-attached functions: `window.handleLogin`, `window.saveClient`, `window.openAddModal`
- Functions prefixed with verb: `load*`, `render*`, `format*`, `show*`, `close*`, `save*`, `open*`

**Variables:**
- camelCase: `allClients`, `filteredListings`, `cachedProfile`, `currentDetailListing`
- All-caps for constants: `TOUR_PAGES`, `FEATURE_SUGGESTIONS`, `WEIGHTS`, `PAGE_URLS`, `TOUR_STEPS`
- Module-level state: `let allClients = [];`, `let editingListingId = null;`
- Prefix with "is" or "has" for booleans: `isLoginPage`, `onlyMatches`, `isEmpty`

**Types:**
- Classes/constructors: Not heavily used; Firebase objects used as-is
- Object property names: camelCase, descriptive: `fullName`, `listingPrice`, `preferredLocations`, `realtorId`

## Code Style

**Formatting:**
- No explicit formatter detected (no `.prettierrc` found)
- 2-space indentation observed
- Semicolons required at end of statements
- Single quotes for strings (where consistent): `"string"` (double quotes used in codebase)
- Arrow functions for callbacks: `(e) => { ... }`
- Template literals for HTML generation: `` `<div>${escapeHtml(name)}</div>` ``

**Linting:**
- No `.eslintrc` found; no linter rules enforced
- Code follows loose conventions but not enforced by tooling
- Some inconsistency in style across files (acceptable)

## Import Organization

**Order:**
1. Firebase imports from `firebase-config.js`
2. Firebase CDN imports (auth, firestore, storage, functions)
3. Utility imports from `auth.js` (helpers: `formatCurrency`, `escapeHtml`, etc.)
4. Domain-specific imports (`match-engine.js`, `tour.js`, `address-autocomplete.js`)
5. Function declarations if using httpsCallable

**Pattern:**
```javascript
import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast, formatCurrency } from "./auth.js";
import { calculateMatchScore } from "./match-engine.js";
```

**Path Aliases:**
- None used; relative imports only: `"./firebase-config.js"`, `"./auth.js"`

## Error Handling

**Try-Catch Blocks:**
- Used extensively for Firebase operations, network calls, and async functions
- Errors logged to console: `console.error("Operation name:", e);`
- User-facing errors via `showToast("Failed to...", "error")`
- Silent failures acceptable for non-critical operations (e.g., search logging)

**Pattern:**
```javascript
try {
  const snap = await getDocs(q);
  // process data
} catch (e) {
  console.error("Load clients error:", e);
  showToast("Failed to load clients.", "error");
}
```

**Error Messages:**
- User-friendly copy: "Failed to save client."
- Specific error codes handled for auth: `err.code === "auth/user-not-found"` → "Invalid email or password."
- Business logic errors checked before operations: `if (!email || !password) { showToast("...") }`

## Logging

**Framework:** `console` only

**Patterns:**
- `console.error()` for errors: `console.error("Context:", error)`
- `console.log()` rarely used; no debug logging in production code
- No custom logging service
- Silent failures in non-critical paths (e.g., `catch(() => {})` for optional updates)

**When to Log:**
- All catch blocks log errors with context
- Database operations that fail
- Network calls that error

## Comments

**When to Comment:**
- Section separators: `/* ===== SECTION NAME ===== */`
- State machine transitions and complex logic
- Sparse inline comments; code is generally self-documenting

**JSDoc/TSDoc:**
- Minimal use; found in `match-engine.js` for exported functions
- Pattern: `@param`, `@returns` for complex functions

**Example:**
```javascript
/**
 * Calculate a match score between a listing and client preferences.
 * @param {Object} listing — Firestore listing doc data
 * @param {Object} prefs  — Client preference fields from clients doc
 * @returns {{ score: number, breakdown: Object, dealBreakerHits: string[] }}
 */
export function calculateMatchScore(listing, prefs) { ... }
```

## Function Design

**Size:**
- Small functions preferred: 10-50 lines typical
- Larger functions acceptable for complex workflows (up to 100+ lines for client-detail.js)
- Functions split by responsibility: `loadClients()`, `renderClients()`, `applyFilters()`

**Parameters:**
- 1-3 parameters typical
- Objects passed rather than many positional args
- Optional parameters: use falsy checks (`id || null`)

**Return Values:**
- Explicit returns required
- Promises returned from async functions
- Object returns for complex results: `{ score, breakdown, dealBreakerHits }`

## Module Design

**Exports:**
- Named exports only: `export function`, `export { constant }`
- No default exports
- Mixed exports: functions + re-exports in main modules

**Pattern:**
```javascript
export function getCurrentUser() { ... }
export function showToast(message, type = "success") { ... }
export function formatCurrency(num) { ... }
```

**Barrel Files:**
- Not used; imports pull directly from source files
- `firebase-config.js` acts as central export for Firebase instances

**Module State:**
- Top-level `let` declarations for shared state: `let cachedProfile = null;`
- Global event listeners: `onAuthStateChanged()`, `addEventListener()`
- Lazy loading: data fetched on-demand in event handlers

## HTML Integration

**Script Tags:**
- Non-module scripts first (utilities): `<script src="/assets/js/main.js"></script>`
- Module scripts after: `<script type="module" src="/greendoor/js/auth.js"></script>`
- Multiple modules per page acceptable
- Load order: auth first, then specific page module

**HTML IDs:**
- Prefixed with context: `login-email`, `add-modal`, `filter-address`, `client-name`
- Kebab-case: `welcome-name`, `admin-tab`, `activity-feed`
- Abbreviated form inputs: `lst-address`, `ov-fullName` (lst=listing, ov=overview)

**DOM Queries:**
- `document.getElementById()` for direct access (fast)
- `document.querySelectorAll()` for filtering/iteration
- Simple selectors preferred over complex CSS selectors

## HTML/CSS Output

**HTML Escape:**
- User data escaped via `escapeHtml()` utility: `${escapeHtml(name)}`
- Used in all template literals that interpolate data
- Prevents XSS vulnerabilities

**URL Sanitization:**
- URLs validated via `sanitizeUrl()`: checks for `http://` or `https://` prefix
- Used before `href` attributes: `href="${sanitizeUrl(url)}"`

## API/Cloud Function Calls

**Pattern:**
```javascript
const askAssistant = httpsCallable(functions, "askAssistant");
const result = await askAssistant({ question, context });
const text = result.data.response;
```

**Data Shape:**
- Request: Plain objects `{ key: value }`
- Response: Nested data access `result.data.*`
- No error-specific handling; falls through to catch block

---

*Convention analysis: 2026-03-04*
