# Codebase Concerns

**Analysis Date:** 2026-03-04

## Tech Debt

**Monolithic Single-Page Module (client-detail.js):**
- Issue: `client-detail.js` is 2,345 lines with 42+ module-level variables (clientData, allMatches, allFiles, allShowings, allFollowUps, etc.), making state management fragile and difficult to debug
- Files: `/Users/joestoehner/Desktop/github/stoekmedia/greendoor/js/client-detail.js`
- Impact: Changes to one feature risk breaking unrelated features; difficult to test; high risk of state pollution and race conditions
- Fix approach: Extract feature-specific logic into smaller modules (e.g., `matching.js`, `signatures.js`, `showings.js`) with isolated state; use a state management pattern or event-driven architecture to decouple features

**Global Window Function Exposure (72+ functions):**
- Issue: Extensive use of `window.functionName` throughout all modules exposes internal logic globally, creating a large API surface and risk of naming collisions
- Files: `client-detail.js` (72 window functions), `admin.js`, `listings.js`, `calendar.js`, others
- Impact: Difficult to refactor; potential for accidental overwrites; no namespace isolation; hard to track dependencies
- Fix approach: Implement a module pattern or class-based approach with proper encapsulation; use ES modules exclusively without window global exposure

**Module-Level State Variables:**
- Issue: Global `let` variables in all modules (`allMatches`, `allClients`, `filteredListings`, `allCalEvents`, etc.) are shared across function calls with no cleanup or reset mechanism
- Files: `/js/client-detail.js`, `/js/listings.js`, `/js/admin.js`, `/js/calendar.js`, `/js/clients.js`
- Impact: Memory leaks on navigation; unpredictable state when re-entering pages; race conditions if concurrent operations occur
- Fix approach: Use closures or classes to scope state per page instance; implement state reset on page unload

**Bare `innerHTML` Usage (43+ occurrences):**
- Issue: Direct `innerHTML` assignments used extensively without consistent HTML escaping in many places (e.g., client-detail.js:1507, listings.js:77, calendar.js:100, admin.js table rendering)
- Files: `/js/client-detail.js`, `/js/listings.js`, `/js/admin.js`, `/js/calendar.js`
- Impact: Although `escapeHtml()` helper exists and is used in some places, it's not always applied consistently; XSS vulnerability risk if user input is used
- Fix approach: Use a template engine or sanitization library (e.g., DOMPurify); enforce linting rules to flag bare `innerHTML`; always sanitize user data before insertion

## Security Considerations

**Firebase API Key Exposed in Client Code:**
- Risk: Firebase API key `AIzaSyDEPiHPEURzn_gtiTaR-rbCGg06JYUSlQY` visible in both `/js/firebase-config.js` and `/index.html` (line 592); also exposed in browser source code
- Files: `/js/firebase-config.js:8`, `/index.html:592-594`
- Current mitigation: Firebase Security Rules should restrict unauthorized access; API key restrictions may be set in Firebase Console
- Recommendations: Verify Firebase Security Rules are properly enforced (cannot read arbitrary user data, files, etc.); use API key restrictions in Firebase Console to limit access to necessary APIs; consider moving initialization to a backend proxy if data sensitivity increases; monitor usage patterns for unauthorized access

**Unvalidated Email Template Insertion:**
- Risk: AI-generated email drafts inserted into form fields without sanitization; user-controlled rich text could lead to injection if form is later processed unsafely
- Files: `/js/client-detail.js:2077-2092` (AI email draft event handler)
- Current mitigation: `escapeHtml()` is used when rendering UI, but draft content is inserted into textarea
- Recommendations: Validate AI-generated content before insertion; use `textContent` instead of `innerHTML` for user-facing email bodies; sanitize all external API responses

**No Input Validation on Numeric Fields:**
- Risk: Price, bedrooms, bathrooms fields accept user input without type validation; match-engine.js performs calculations without null checks in some places
- Files: `/js/listings.js:97-99`, `/js/match-engine.js:34-50` (price calculation)
- Current mitigation: Some defensive checks exist (e.g., `price && (prefs.budgetMin || prefs.budgetMax)`)
- Recommendations: Add strict input validation; validate budget/price ranges before database writes; add bounds checking in match-engine calculations

**Admin Role Bypass Risk:**
- Risk: Admin redirect happens in browser code; no server-side validation that user actually has admin role before loading admin data
- Files: `/js/admin.js:23-30`
- Current mitigation: Firestore Security Rules should enforce server-side authorization
- Recommendations: Verify Firestore rules check `request.auth.token.role == 'admin'` before granting access to admin collections; never rely solely on client-side role checks

## Known Bugs

**Signature Polling Memory Leak:**
- Symptoms: `embedPollInterval` set on line 1010 (15-second poll) continues running until modal closes; if modal never properly closes, interval continues indefinitely
- Files: `/js/client-detail.js:1010, 1018-1019`
- Trigger: Open BoldSign embed modal, then close incorrectly or navigate away without using close button
- Workaround: Always use close button; manually clear intervals on page unload

**Match Score Recalculation on Every Load:**
- Symptoms: `loadMatches()` recalculates all match scores every time (line 1137-1143), even if listing/client data hasn't changed; inefficient and could cause display flicker
- Files: `/js/client-detail.js:1135-1143`
- Trigger: Every time client detail page loads or matches are refreshed
- Workaround: Cache calculated scores in Firestore; only recalculate on explicit user request

**Race Condition in Copy-to-Client:**
- Symptoms: `executeCopyToClient()` fetches existing matches but no lock prevents duplicate insertions if user clicks button multiple times rapidly
- Files: `/js/client-detail.js:1527-1587`
- Trigger: Rapid button clicks during copy operation
- Workaround: Disable button during operation; however, code already attempts this (line 1534)

**Promise.all() Without Error Handling in Calendar:**
- Symptoms: `Promise.all()` in calendar.js:46-50 catches individual errors in `.catch()` chains but if one collection fails completely, partial data renders
- Files: `/js/calendar.js:46-50`
- Trigger: Network failure while loading one collection type
- Workaround: Page still renders with partial data; user won't see all events but no crash

## Performance Bottlenecks

**N+1 Query Problem in Match Loading:**
- Problem: `loadMatches()` fetches all matches (1 query), then loops through to fetch each listing individually (line 1119-1128: `for (const m of rawMatches) { getDoc(...) }`)
- Files: `/js/client-detail.js:1119-1128`
- Cause: No batch loading; one query per listing
- Improvement path: Use Firestore batch reads or restructure data to denormalize listing data into match records; cache all listings upfront (already done on line 1131-1133)

**All Listings Cache Loaded on Every Client Detail:**
- Problem: `loadMatches()` always loads ALL listings globally (line 1131-1133) even if user only cares about matched listings
- Files: `/js/client-detail.js:1131-1133`
- Cause: Used for "match-a-listing" panel modal
- Improvement path: Lazy-load listings only when modal opens; implement pagination for large listing sets

**Synchronous Client Lookup in Calendar:**
- Problem: Calendar uses object lookup `allClients[d.id]` (line 40, 99) after loading; if many clients, could slow initial render
- Files: `/js/calendar.js:40, 99`
- Cause: All clients loaded into memory object
- Improvement path: Use Firestore in-memory cache or index; pagination; lazy-load client names only when needed

**No Pagination on Long Lists:**
- Problem: Clients list, listings list, admin audit log all load all records at once into arrays without pagination
- Files: `/js/clients.js:25`, `/js/listings.js:57-59`, `/js/admin.js:651-658` (audit log)
- Cause: `getDocs(query(...))` without limit or pagination
- Improvement path: Add `limit()` + cursor-based pagination; implement virtual scrolling for large tables

## Fragile Areas

**Calendar Event Rendering Without Type Safety:**
- Files: `/js/calendar.js:58-96`
- Why fragile: Events from three different collections (showings, followUps, events) merged into single array with varying properties; `showingDate`, `dueDate`, `startDate` properties named differently but treated as `start`; code assumes `.toDate()` exists but doesn't always check type
- Safe modification: Add TypeScript or JSDoc type definitions; add defensive property checks before accessing `.toDate()`
- Test coverage: No unit tests visible; rendering logic not isolated

**Email Template Variable Substitution:**
- Files: `/js/client-detail.js` (email sending, template variables)
- Why fragile: Template system uses simple string replacement; if variable naming inconsistent, substitution fails silently; no validation that all required variables exist
- Safe modification: Extract template engine logic; validate template before sending; add error reporting if variable missing
- Test coverage: No visible tests for template rendering

**Match Score Calculation Edge Cases:**
- Files: `/js/match-engine.js:22-162`
- Why fragile: Assumes listing and preference objects have expected properties; falls back to neutral scores (50) if missing, which masks data quality issues; `dealBreakers` treated as case-insensitive substring match (line 153) which could have false positives (e.g., "pool" matches "carpool")
- Safe modification: Add strict validation of input objects; throw errors on missing required fields; improve deal-breaker matching logic
- Test coverage: No unit tests visible for match-engine

**Client Detail Page Missing Null Checks:**
- Files: `/js/client-detail.js:88-90` (lastActivityDate conversion), `/js/client-detail.js:1639` (showingDate conversion)
- Why fragile: Code checks `.toDate()` method exists but assumes Firestore Timestamp conversion works; if data is malformed, could throw
- Safe modification: Add explicit type guards; wrap conversions in try-catch; add logging for conversion failures
- Test coverage: No visible tests for data loading

## Scaling Limits

**Current Capacity:**
- Client list loads all clients into memory (no pagination)
- Listings page loads all listings into memory (no pagination)
- Match loading performs N+1 queries (scales poorly with matches)
- Calendar loads all events for realtor at once

**Limit:**
- Client/listings tables will become slow with 1000+ records
- Match loading could hit rate limits or timeout with 100+ matches
- Calendar rendering with 1000+ events will be sluggish

**Scaling Path:**
- Implement pagination with limits (e.g., 50 records per page)
- Use cursor-based pagination for infinite scroll
- Denormalize data to avoid N+1 queries
- Implement server-side filtering/sorting instead of client-side
- Consider Full-Text Search (Algolia, Meilisearch) for address/client search

## Dependencies at Risk

**Reliance on Google Maps Places API:**
- Risk: Address autocomplete (address-autocomplete.js) fails silently if Google Maps API not loaded; feature degradation without user awareness
- Files: `/js/address-autocomplete.js:17-19`
- Impact: Users can't use address autocomplete; must manually enter addresses
- Migration plan: Add fallback to manual entry with validation; or use alternative geocoding service (Mapbox, OpenCage); consider caching previously used addresses

**Firebase Cloud Functions Heavy Lifting:**
- Risk: Signature generation, email sending, AI assistant all rely on Cloud Functions; timeout or quota issues will break features silently
- Files: `/js/client-detail.js:49-54` (Cloud Function references)
- Impact: Users won't know if email was actually sent or signature request failed to queue
- Migration plan: Add request/response logging; implement retry logic with exponential backoff; add explicit timeout handling; monitor function execution times

**Direct CDN Import of Firebase SDK:**
- Risk: Firebase SDK loaded from `gstatic.com` CDN; if CDN unavailable or slow, app won't initialize
- Files: All `/js` files import from `https://www.gstatic.com/firebasejs/10.8.0/*`
- Impact: App entirely broken if CDN unreachable
- Migration plan: Bundle Firebase SDK into app; implement offline-first architecture

## Test Coverage Gaps

**No Unit Tests Visible:**
- What's not tested: Match engine calculation logic, email template rendering, address parsing, calendar event merging
- Files: `/js/match-engine.js`, `/js/client-detail.js` (email templates), `/js/address-autocomplete.js`, `/js/calendar.js`
- Risk: Regressions in match scoring, miscalculated client preferences, calendar rendering bugs will go unnoticed
- Priority: High — match engine is core business logic

**No Integration Tests:**
- What's not tested: Client-detail page workflows (add activity, send email, complete showing, create match)
- Files: `/js/client-detail.js`
- Risk: Breaking changes in UI interactions or Firebase operations won't be caught
- Priority: High — most complex page in app

**No E2E Tests:**
- What's not tested: Full user flows (login → create client → add listing → match → send for signature)
- Files: All pages
- Risk: Data corruption, auth failures, or cross-page bugs won't be detected until production
- Priority: Medium — would require test infrastructure setup

---

*Concerns audit: 2026-03-04*
