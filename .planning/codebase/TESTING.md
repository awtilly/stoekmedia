# Testing Patterns

**Analysis Date:** 2026-03-04

## Test Framework

**Status:** No testing framework detected

- No Jest, Vitest, Mocha, or other test runner configured
- No test scripts in `package.json`
- No test files (*.test.js or *.spec.js) in project source code
- Firebase Functions deployed without automated test coverage

**Current Approach:**
- Manual testing via Firebase Cloud Function deployment
- Integration tests via live Firebase project only

## Package Dependencies

**Testing-Related:**
- None installed

**Current Dependencies** (`/Users/joestoehner/Desktop/GitHub/stoekmedia/functions/package.json`):
- `@anthropic-ai/sdk` - Claude AI integration
- `@sendgrid/mail` - Email service
- `firebase-admin` - Backend SDK
- `firebase-functions` - Cloud Functions framework
- `form-data` - HTTP form encoding
- `node-fetch` - HTTP client

## Test Types Currently Missing

**Unit Tests:**
- No unit tests for individual handler functions:
  - `handleCreateClient()`
  - `handleUpdateClient()`
  - `handleCreateShowing()`
  - `handleCreateFollowUp()`
  - etc.

**Integration Tests:**
- No integration tests for Firestore interactions
- No tests for AI tool execution pipeline
- No tests for email/SendGrid integration

**Error Handling Tests:**
- No tests for `HttpsError` scenarios:
  - Unauthenticated requests
  - Invalid arguments
  - Missing resources
  - Permission denied
- No tests for malformed inputs to tool handlers
- No tests for Firestore access denied conditions

**Authentication Tests:**
- No tests for Firebase Auth context validation
- No tests for user ID validation
- No tests for access control (e.g., users can only access their own clients)

**E2E Tests:**
- Not implemented
- Would need Firebase Emulator Suite

## Key Testable Areas

**AI Integration (`askAI` function):**
- Tool call parsing from Claude response
- Context window building (client/showing details)
- Daily rate limiting (50 requests/day)
- Error handling for Anthropic API failures

**CRUD Operations:**
- Client creation with schema validation
- Client updates with allowlist enforcement (`UPDATE_CLIENT_ALLOWLIST`)
- Showing creation with date parsing
- Follow-up and event creation with relative date resolution

**Business Logic:**
- Client-to-listing matching algorithm
- Fuzzy name matching for client search
- Date resolution ("Thursday", "next Monday", "tomorrow")
- Listing auto-import from showing creation

**Data Validation:**
- Email format validation
- Phone number format validation
- Budget range validation (min <= max)
- Date string parsing and validation

## Recommendations for Test Implementation

### Phase 1: Unit Tests

Set up Jest and test individual handler functions:

```javascript
// Example structure (not in codebase yet)
describe('handleCreateClient', () => {
  it('should create client with required fields', async () => {
    const input = { fullName: 'John Smith' };
    const result = await handleCreateClient(input, 'test-uid');
    expect(result.success).toBe(true);
  });

  it('should reject missing fullName', async () => {
    const input = { email: 'john@example.com' };
    const result = await handleCreateClient(input, 'test-uid');
    expect(result.success).toBe(false);
    expect(result.error).toContain('fullName');
  });
});
```

### Phase 2: Firestore Integration Tests

Use Firebase Emulator for local testing without hitting production database.

### Phase 3: AI Pipeline Tests

Mock Claude API and test tool call execution:

```javascript
// Pseudo-code structure
jest.mock('@anthropic-ai/sdk');
describe('AI tool pipeline', () => {
  it('should execute create_client tool when AI calls it', async () => {
    // Mock Claude response with tool_use block
    // Call askAI with matching input
    // Verify client created in Firestore
  });
});
```

## Test Coverage Gaps

**Critical (High Priority):**
- Error handling paths for all handler functions
- Firestore access control validation
- Date parsing edge cases ("Thursday" when today is Friday, "next week" boundaries)
- Client ID context handling in multi-client operations

**Important (Medium Priority):**
- Fuzzy name matching algorithm accuracy
- Tool input validation against JSON schemas
- Rate limiting logic
- Timestamp and timezone handling

**Nice to Have (Low Priority):**
- Success path logging
- API response formatting
- List pagination (limit: 10 in search results)

## Running Tests (When Implemented)

```bash
# Install test framework (not currently installed)
npm install --save-dev jest firebase-testing-library

# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

**Note:** Current `package.json` has no test scripts. Would need to add:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

---

*Testing analysis: 2026-03-04*
