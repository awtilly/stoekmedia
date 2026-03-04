# Testing Patterns

**Analysis Date:** 2026-03-04

## Test Framework

**Runner:**
- No test runner detected
- No test configuration files found (no `jest.config.js`, `vitest.config.js`, `karma.conf.js`, etc.)
- No test files in codebase (no `*.test.js` or `*.spec.js` files)

**Assertion Library:**
- None detected; no testing framework installed

**Current State:**
- **Manual testing only** — No automated test suite
- All testing done by running HTML pages in browser
- Requires Firebase project and credentials to test (integration test only)

## Test File Organization

**Location:**
- No dedicated test directory
- No test files present in codebase

**Naming:**
- Not applicable; no tests exist

**Structure:**
- Not applicable; no tests exist

## Test Structure

**Manual Testing Approach:**
- Load HTML file in browser with proper Firebase config
- Use browser DevTools console to verify behavior
- Click through UI to test features
- Check browser Network tab for API calls and Firebase operations

**Entry Points for Testing:**
- `app/login.html` — Test authentication flow
- `app/dashboard.html` — Test data loading and UI rendering
- `app/clients.html` — Test client CRUD operations
- `app/listings.html` — Test listing matching and filtering
- `app/client-detail.html` — Test complex client workflows

## Key Areas Difficult to Test

**Authentication:**
- Firebase auth state requires real Firebase project
- `onAuthStateChanged()` listener fires async
- Redirect logic makes unit testing impractical

**Database Operations:**
- All Firestore queries require live database
- No mocking layer exists
- Data mutations affect shared state

**Async Operations:**
- Many operations wrapped in `try-catch` with `console.error()`
- No promise tracking or timeout handling
- Silent failures in non-critical paths

**DOM Rendering:**
- HTML generation happens in template literals
- No virtual DOM or component abstraction
- Direct DOM manipulation makes assertions difficult

## What Could Be Tested

**Utility Functions (if isolated):**
```javascript
// From auth.js — these COULD be unit tested
calculateMatchScore(listing, prefs)  // Pure function
formatCurrency(num)                   // Pure function
formatDate(ts)                        // Pure function
timeAgo(ts)                           // Pure function
escapeHtml(str)                       // Pure function
sanitizeUrl(url)                      // Pure function
statusLabel(status)                   // Pure function
matchScoreColor(score)                // Pure function
matchScoreLabel(score)                // Pure function
```

**Example Test Pattern (if Jest were added):**
```javascript
describe("match-engine.js", () => {
  test("calculateMatchScore returns high score for perfect match", () => {
    const listing = { listingPrice: 500000, bedrooms: 3, bathrooms: 2 };
    const client = { budgetMin: 400000, budgetMax: 600000, bedsMin: 3, bedsMax: 4, bathsMin: 2, bathsMax: 3 };
    const result = calculateMatchScore(listing, client);
    expect(result.score).toBeGreaterThan(80);
  });

  test("escapeHtml prevents XSS", () => {
    const input = '<script>alert("xss")</script>';
    expect(escapeHtml(input)).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test("formatCurrency formats numbers correctly", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000");
    expect(formatCurrency(null)).toBe("—");
  });
});
```

## Mocking

**Framework:**
- Not used; no test framework installed

**What Would Need Mocking (if tests added):**
- `firebase-config.js` exports: `auth`, `db`, `storage`, `functions`
- `onAuthStateChanged()` callback
- `httpsCallable()` responses
- `Timestamp.now()` for time-dependent tests

**Current Approach:**
- No mocks; Firebase integration required
- Real database changes during manual testing

## Coverage

**Requirements:**
- No coverage requirements or tooling
- Not measured

**Current Coverage:**
- Estimated 0% (no automated tests)

**Critical Gaps:**
- Authentication flows not tested
- Database operations not tested
- Complex filtering/matching logic untested
- Error handling branches untested
- UI rendering untested

## Test Types

**Unit Tests:**
- Not implemented
- Would focus on: `match-engine.js` utilities, `auth.js` formatting functions
- Scope: Single functions with pure inputs/outputs

**Integration Tests:**
- Implicit in manual browser testing
- Covers: Auth → Firebase → UI rendering pipeline
- Requires: Real Firebase project, real user flows

**E2E Tests:**
- Not implemented
- Would benefit most from: Cypress, Playwright, or Selenium
- Critical paths: Login → Add Client → Create Listing → Match → Email

## Patterns for Manual Testing

**Quick Verification (Console):**
```javascript
// Test calculateMatchScore directly
import { calculateMatchScore } from "./match-engine.js";
const listing = { listingPrice: 500000, bedrooms: 3 };
const client = { budgetMin: 400000, budgetMax: 600000, bedsMin: 3 };
calculateMatchScore(listing, client);  // Check result in console

// Test formatting
import { formatCurrency } from "./auth.js";
formatCurrency(1500000);  // "$1,500,000"
```

**Browser Testing Checklist:**

**Auth Flow:**
- [ ] Login with valid credentials → redirect to dashboard
- [ ] Login with invalid email → error message
- [ ] Login with wrong password → error message
- [ ] Too many login attempts → rate limit message
- [ ] Forgot password → email sent message
- [ ] Logout → redirect to login

**Client Management:**
- [ ] Load clients list → displays all clients
- [ ] Search clients → filters by name/email/phone
- [ ] Filter by status → shows only selected status
- [ ] Add new client → modal opens, can save
- [ ] View client detail → all info populated
- [ ] Edit client → updates persist
- [ ] Delete client → confirms before deleting

**Listings:**
- [ ] Load listings → displays grid and list views
- [ ] Toggle view → switches grid ↔ list
- [ ] Search by address → filters correctly
- [ ] Filter by price range → boundaries respected
- [ ] Filter by beds/baths → numeric filtering works
- [ ] Add listing → modal opens, photos upload
- [ ] Quick match → calculates scores correctly
- [ ] Match listing to client → creates association

**Match Engine:**
- [ ] High budget match → returns high score
- [ ] Low budget match → returns low score
- [ ] Wrong location → returns low score
- [ ] All preferences match → returns 90%+ score
- [ ] Deal breaker matches → noted in results

## Browser DevTools Testing

**Console Checks:**
```javascript
// Verify auth state
import { getCurrentUser } from "./auth.js";
const user = await getCurrentUser();
console.log(user);  // Should show { uid, email, fullName, role }

// Check cached data
import { allClients } from "./clients.js";  // Not exported, but check window if added
console.log(allClients);  // Verify populated

// Test error handling
// Trigger network error manually in DevTools Network tab → offline
// Verify showToast("Failed...") appears
```

**Network Tab Checks:**
- Firestore queries return expected data shapes
- Cloud Function calls receive correct parameters
- Upload operations send files correctly
- No 4xx/5xx errors on successful operations

**Performance Notes:**
- Large client lists (100+) render slowly
- Match calculation is synchronous and blocking
- No virtual scrolling or pagination
- Dashboard loads in ~1-2 seconds on fast network

## Adding Tests (Recommended Path)

**Phase 1: Install Jest**
```bash
npm install --save-dev jest @babel/preset-env babel-jest
```

**Phase 2: Test Pure Functions**
- Start with `match-engine.js` (no dependencies)
- Add `auth.js` formatting functions
- Cover edge cases (null, undefined, invalid input)

**Phase 3: Mock Firebase**
```javascript
jest.mock('./firebase-config.js', () => ({
  auth: {},
  db: {},
  httpsCallable: jest.fn()
}));
```

**Phase 4: Integration Tests**
- Use Firebase Emulator Suite
- Test full workflows (client CRUD, listing matching)

**Phase 5: E2E Tests (Optional)**
- Use Playwright for critical user journeys
- Test across browsers (Chrome, Safari, Firefox)

---

*Testing analysis: 2026-03-04*
