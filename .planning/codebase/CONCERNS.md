# Codebase Concerns

**Analysis Date:** 2026-03-04

## Tech Debt

**Global Auth State Management via Cached Variable:**
- Issue: `cachedProfile` singleton in `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js` (line 15) creates a mutable global cache that can become stale. The cache is set once but never invalidated on profile changes from other tabs or sessions.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`
- Impact: Users may see outdated profile data after updates in other browser tabs. Permission changes (role updates) won't reflect until page reload.
- Fix approach: Replace global cache with reactive pattern (Firestore listener per user profile) or implement cross-tab synchronization via BroadcastChannel API.

**Monolithic Client Detail Component:**
- Issue: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/client-detail.js` is 2,345 lines — handles data display, editing, match engine, file uploads, email drafting, all in one file.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/client-detail.js`
- Impact: Difficult to test, modify, or reuse individual features. High cognitive load. Changes to one feature risk breaking others.
- Fix approach: Extract into focused modules: `client-editor.js`, `client-matcher.js`, `client-files.js`, `client-emails.js`. Use event bus or module exports for communication.

**Unstructured Error Handling:**
- Issue: Generic try-catch blocks throughout codebase (e.g., `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js` line 48-50) log errors to console but don't distinguish between user-facing vs system errors. No retry logic, no exponential backoff.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`, `/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/index.js`
- Impact: Silent failures in production. Users see generic error messages. Firestore quota issues or network timeouts don't retry, causing permanent failures.
- Fix approach: Create centralized error handler. Separate UserError (show message) from SystemError (log + retry). Implement exponential backoff for transient failures.

**String-Based Role Authorization:**
- Issue: Role checks hardcoded as strings (`role === "admin"`) scattered across frontend and backend. No central role definition, no permission model.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js` (line 66), `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules` (line 14), `/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/index.js`
- Impact: Adding new roles or permissions requires changes across multiple files. Easy to miss a check and create privilege escalation. No audit trail of role changes.
- Fix approach: Create role/permission constants in shared module. Implement middleware/guards for all mutations. Add audit logging to Firebase.

**Type Safety Missing:**
- Issue: Frontend uses ES6 modules with no type checking. Firestore operations use untyped data (objects cast to generic types). Schema validation is absent.
- Files: All `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/*.js` files
- Impact: Typos in field names silently create nulls. API responses don't validate shape. Runtime errors only caught in QA or production.
- Fix approach: Migrate to TypeScript or add JSDoc type annotations. Create Zod/Yup schemas for all Firestore collections. Run tsc type check in CI.

## Known Bugs

**Auth State Sync Across Tabs:**
- Symptoms: User logs out in one browser tab, but other tabs still show logged-in state until page refresh.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`
- Trigger: Open app in multiple tabs, log out in one tab, check another tab.
- Workaround: Manual page refresh.

**Password Reset Token Handling:**
- Issue: Password reset email (line 115-118 in `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`) uses `handleCodeInApp: false` but sets redirect to `/greendoor/app/set-password`. If user clicks email link, Firebase may redirect differently than expected.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`, `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/app/set-password.html`
- Trigger: User initiates password reset, clicks email link.
- Risk: Users might land on wrong page or have token validation fail.

**Match Engine Price Calculation Edge Cases:**
- Issue: In `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/match-engine.js` (lines 40-45), price delta is multiplied by 200 with no cap. A listing 50% over budget scores 0; one 200%+ over scores negative (clamped to 0 but illogical).
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/match-engine.js`
- Impact: Extreme price mismatches don't penalize proportionally. Scoring model unpredictable at extremes.
- Fix approach: Cap delta multiplier or use logarithmic scale.

## Security Considerations

**Firestore Rules Allow Bulk Reads by Authenticated Users:**
- Risk: Any authenticated user can read all listings (`allow read: if isAuthenticated()` on line 114 of `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules`). No tenant isolation. Realtors can enumerate all colleagues' clients via unindexed queries.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules`
- Current mitigation: Frontend UI hides other users' data, but nothing prevents direct Firestore API calls.
- Recommendations: Add rate limits (use `/rateLimits` collection). Restrict reads to owner+admin only. Index and paginate all queries.

**Admin Check Queries Firestore on Every Request:**
- Risk: `isAdmin()` function (line 14 of `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules`) performs blocking read to user doc on every Firestore operation. DoS vector: attacker can exhaust read quota by making many requests.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules`
- Current mitigation: Firebase quota limits, but no per-user rate limiting.
- Recommendations: Cache admin status in custom claims (Firebase Auth) instead of reading user doc. Update claims only when role changes.

**Client-Side Validation Only:**
- Risk: Listing URL validation (lines 118-120, 125-127 in `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules`) is regex on client first, then firestore rules. Attacker can bypass client regex with direct API.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules`, client-side validators
- Current mitigation: Firestore rules enforce regex, but no canonical list of allowed URL patterns.
- Recommendations: Add allowlist for MLS/listing sites. Consider URL shortening to prevent phishing.

**No Input Sanitization in HTML Rendering:**
- Risk: `escapeHtml()` function exists (line 225-233 in `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`) but adoption across codebase unknown. Client names, notes, addresses may be rendered without escaping.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/*.js`
- Impact: Stored XSS if user notes contain `<img src=x onerror="...">`.
- Recommendations: Audit all `innerHTML` usage. Replace with `textContent` where possible. Use DOMPurify library for rich text. Add CSP header.

**Environment Variables Not Validated:**
- Risk: Cloud Functions use `ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `BOLDSIGN_API_KEY` (line 12-15 in `/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/index.js`) but no runtime checks that they exist before function execution.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/index.js`
- Impact: Functions fail at runtime with unclear error if secret is missing. Credentials might be exposed in error logs.
- Recommendations: Validate secrets exist at function initialization, fail fast. Never log secret values.

## Performance Bottlenecks

**Client Detail Page Loads All Related Data Synchronously:**
- Problem: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/client-detail.js` (2,345 lines) likely queries clients, activities, files, matches, emails all on page load without pagination or lazy loading.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/client-detail.js`
- Cause: Monolithic architecture; no separation of initial load vs detail loads. Firestore queries likely unindexed or missing pagination cursors.
- Improvement path: Implement progressive loading — load client card first, then activities, then match engine. Add pagination (first 20 activities, then load on scroll). Add indexes to `firestore.indexes.json`.

**Match Engine Recalculates on Every Filter Change:**
- Problem: Client page with preference editor likely re-runs `calculateMatchScore()` (line 22 in `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/match-engine.js`) for every listing on every keystroke.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/match-engine.js`, `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/client-detail.js`
- Cause: No debouncing, no result caching.
- Improvement path: Debounce preference changes (500ms). Memoize `calculateMatchScore()` by listing ID + preference hash. Consider moving to Cloud Function if 100+ listings.

**Auth State Listener Runs on Every CRM Page:**
- Problem: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js` (line 18) sets up `onAuthStateChanged()` listener globally, runs on every page load, fetches user doc from Firestore every time.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`
- Cause: No listener cleanup. Each page load adds a new listener.
- Improvement path: Create single global listener, reuse on all pages. Unsubscribe on logout. Use Firebase custom claims to avoid user doc reads.

## Fragile Areas

**Hardcoded Redirect URLs:**
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js` (lines 35, 39, 45, 54)
- Why fragile: Redirect paths (e.g., `/greendoor/app/dashboard`, `/greendoor/app/login`) are hardcoded strings. If routing changes, must update multiple places.
- Safe modification: Extract to config object at top of file: `const ROUTES = { DASHBOARD: "/greendoor/app/dashboard", ... }`.
- Test coverage: No automated tests for redirect logic. Easy to break with typo.

**Firestore Rules Have High Duplication:**
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules` (collections `clients`, `activities`, `files`, `templateFiles`, `bookmarkedProperties`, `envelopes`, `showings`, `followUps`, `events` all follow identical pattern)
- Why fragile: Same auth rules repeated 9+ times. Change to one rule (e.g., add new field to unchanged check) requires edits to 9 places. Easy to miss one.
- Safe modification: Extract to reusable function: `function hasOwnerOrAdmin(field) { return isOwner(resource.data[field]) || isAdmin(); }`. Use macro-like approach.
- Test coverage: No automated Firestore rules tests. Manual testing only.

**Match Engine Weights Are Hardcoded:**
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/match-engine.js` (lines 6-14)
- Why fragile: Weights (price: 30, location: 25, etc.) are constants in code. Changing model requires code change + deploy. No A/B testing, no dynamic tuning.
- Safe modification: Move weights to Firestore `platformSettings` collection, fetch at runtime. Add version field to handle migrations.
- Test coverage: No unit tests for match engine. Edge cases (price 200% over budget, missing beds field) untested.

**AI System Prompt in Cloud Function:**
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/index.js` (lines 21-44)
- Why fragile: Long system prompt for Anthropic API embedded in code. Updating behavior requires function redeploy. Easy to introduce syntax errors.
- Safe modification: Move to Firestore `platformSettings` document or external file. Version the prompt. Log which version was used for debugging.
- Test coverage: No mock tests for AI tool calling. Hard to test locally without real API key.

## Scaling Limits

**Single Global Auth Listener:**
- Current capacity: Works for single app instance, but listener added again on every page load without cleanup.
- Limit: Memory leak in SPAs with page transitions. If user navigates 10 pages, 10 listeners accumulate.
- Scaling path: Implement listener lifecycle management. Create singleton pattern or use Framework (React, Vue) lifecycle hooks to subscribe once and unsubscribe on unmount.

**Firestore Rules Admin Check Query:**
- Current capacity: Works for <1000 active users. Admin checks query user doc on every operation.
- Limit: At >1000 concurrent users, read quota exhausted on admin checks alone. Cost scales linearly with traffic.
- Scaling path: Move admin status to Firebase Auth custom claims. Update claims only on role change (rare). Custom claims available in token without read operation.

**Match Engine on Large Listing Sets:**
- Current capacity: Scoring works for <500 listings (local calculation).
- Limit: At >500 listings, per-keystroke recalculation becomes slow (>1s delay on preference change).
- Scaling path: Move to Cloud Function. Cache results. Use Algolia or similar for vector search if semantic matching needed.

**Monolithic Frontend Without Code Splitting:**
- Current capacity: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/client-detail.js` (2,345 lines) loads for every client detail page view.
- Limit: Page load time degrades as features added. No tree-shaking, no lazy loading.
- Scaling path: Implement module bundler (esbuild, webpack) with code splitting. Load client-matcher.js only when preferences panel opened. Load file upload module only when needed.

## Dependencies at Risk

**Firebase Admin SDK Version Management:**
- Risk: `functions/index.js` imports from `firebase-admin` without pinned version in package.json. Major version updates may introduce breaking changes.
- Impact: Unintended version bump in `npm install` could break Cloud Functions.
- Migration plan: Pin to specific version (e.g., `firebase-admin@12.0.0`). Test upgrades in staging before deploying.

**Anthropic API Dependency:**
- Risk: AI Assistant relies on Anthropic Claude API (line 12 in `functions/index.js`). No fallback if API is down or changes endpoint.
- Impact: Chatbot feature fully unavailable if Anthropic has outage.
- Migration plan: Add graceful degradation — fall back to simple keyword matching if API call fails. Cache common responses. Consider local model as backup.

## Missing Critical Features

**No Audit Logging for Data Changes:**
- Problem: Who changed a client's status? When was a note added? No audit trail except Firestore timestamps.
- Blocks: Compliance (GDPR, CCPA require change history). Debugging issues. Detecting unauthorized access.
- Files involved: All write operations in `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/*.js` and `/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/index.js`
- Fix approach: Add Cloud Function trigger on every write (clients, activities, files). Log `{userId, action, before, after, timestamp}` to `adminAuditLog` collection.

**No Rate Limiting on API Calls:**
- Problem: Users or bots can spam Cloud Functions (create 1000 clients per second).
- Blocks: DoS attacks. Runaway costs (Firestore quota exhaustion).
- Current mitigation: `/rateLimits` collection exists (line 156 in `firestore.rules`) but not used in Cloud Functions.
- Fix approach: Implement token bucket rate limiter in Cloud Function middleware. Check `rateLimits/{userId}` before processing request.

**No Offsite Backups:**
- Problem: All data in Firestore. No export scheduled. Single point of failure.
- Blocks: Disaster recovery. Legal holds. Data migration.
- Fix approach: Enable Firestore automated backups. Export to Cloud Storage monthly. Test restore procedure.

## Test Coverage Gaps

**No Tests for Auth State Management:**
- What's not tested: User profile caching, cache invalidation, redirect logic, token expiry handling.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/auth.js`
- Risk: Broken auth logic shipped to production. Users locked out mid-session.
- Priority: High — auth is critical path.

**No Tests for Match Engine:**
- What's not tested: All match scoring logic, edge cases (missing fields, negative prices, extreme budget differences), deal breaker logic.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/greendoor/js/match-engine.js`
- Risk: Match algorithm changes silently break client suggestions. Users see wrong listings.
- Priority: High — core feature.

**No Tests for Firestore Rules:**
- What's not tested: Permission model, role-based access control, data validation.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/firestore.rules`
- Risk: Privilege escalation. Data leaks. Unauthorized mutations.
- Priority: Critical — security-critical.

**No Tests for Cloud Functions:**
- What's not tested: API tool calling, email sending, file processing, error handling.
- Files: `/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/index.js`
- Risk: Silent failures in production. Incomplete operations (email sent but database not updated).
- Priority: High — backend is single source of truth.

**No Integration Tests:**
- What's not tested: End-to-end workflows (create client → match listings → send email), data flow between client and Cloud Functions.
- Risk: Works locally, broken in production due to API changes, timing issues, or state inconsistencies.
- Priority: Medium — would catch cross-layer issues.

---

*Concerns audit: 2026-03-04*
