# Coding Conventions

**Analysis Date:** 2026-03-04

## Naming Patterns

**Files:**
- Flat structure with single-word or camelCase naming: `index.js`
- No sub-directory organization within functions codebase

**Functions:**
- Async handler functions use `handle` prefix: `handleCreateClient()`, `handleUpdateClient()`, `handleLogActivity()`, `handleCreateShowing()`
- Internal utility functions use `camelCase`: `searchClients()`, `createFollowUp()`, `createEvent()`
- Exported functions use `camelCase`: `askAI()`, `matchClientToListing()`, `syncMlsListings()`

**Variables:**
- Use `camelCase` consistently: `clientId`, `showingDate`, `budgetMin`, `budgetMax`, `preferredLocations`
- Query result variables use abbreviations: `snap` for Firestore snapshots, `q` for queries, `ref` for document references
- Configuration/constant arrays use descriptive names: `UPDATE_CLIENT_ALLOWLIST`
- Temporary variables are concise: `d` for document, `l` for listing, `results` for arrays

**Types:**
- No TypeScript - JavaScript only
- Complex input objects passed to handlers use descriptive property names from Firebase tool schemas
- Return objects use `{ success: boolean, error?: string, data?: object }` pattern for consistency

**Constants:**
- All-caps for immutable constants: `SYSTEM_PROMPT`, `AI_TOOLS`, `UPDATE_CLIENT_ALLOWLIST`

## Code Style

**Formatting:**
- 2-space indentation throughout
- Single quotes for most strings, template literals for multi-line AI prompts
- Opening braces on same line (K&R style)

**Linting:**
- No ESLint or Prettier configuration detected
- Manual consistency through code review

**Comments:**
- Section headers use comment blocks with equals signs: `/* ===== SECTION NAME ===== */`
- Inline comments rare - code is generally self-documenting through function names

## Import Organization

**Order:**
1. Firebase SDK imports (`firebase-functions`, `firebase-admin`)
2. Standard Node modules (`crypto`)
3. External packages (`@anthropic-ai/sdk`, `@sendgrid/mail`)

**Pattern:**
```javascript
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");
```

**Destructuring:** Imports use destructuring to extract specific functions/classes

## Error Handling

**Patterns:**
- Firebase HTTPS functions use `HttpsError` with error code and message
- Tool handlers return `{ success: false, error: "message" }` objects
- Try-catch blocks used for non-critical operations (e.g., auto-import listing attempts)
- Errors logged with `console.warn()` for recoverable failures

**Error Types:**
```javascript
throw new HttpsError("unauthenticated", "You must be logged in.");
throw new HttpsError("invalid-argument", "A question is required.");
throw new HttpsError("resource-exhausted", "Daily AI limit reached (50 requests). Try again tomorrow.");
throw new HttpsError("permission-denied", "You do not have access to this client.");
throw new HttpsError("not-found", "Client not found.");
```

**Tool Handler Pattern:**
```javascript
if (!input.clientId) {
  return { success: false, error: "No client specified. Which client is this showing for?" };
}
const clientSnap = await db.doc(`clients/${clientId}`).get();
if (!clientSnap.exists) {
  return { success: false, error: "Client not found or access denied." };
}
```

## Logging

**Framework:** Console-based logging only

**Patterns:**
- `console.warn()` used for non-critical failures and warnings
- Limited use of logging - focus on returning structured error objects instead

## Data Access

**Firestore Patterns:**
- Collection names: lowercase (`clients`, `showings`, `followUps`, `events`, `listings`, `activities`, `clientListingMatches`)
- Document references use path notation: `db.doc('clients/${clientId}')`
- Collection queries use `db.collection('name')`
- Results iterated with `.forEach(doc => { const data = doc.data(); })`

**Field Updates:**
- Use `FieldValue.serverTimestamp()` for `updatedAt` fields
- Create update objects before applying: `const updates = {}; updates[field] = value;`

## Function Design

**Size:** Handlers range from 30-80 lines, keeping single responsibility

**Parameters:**
- Handlers receive `(input, uid, contextId?)` where input is parsed tool call, uid is user ID, contextId is optional client/showing context
- Tool definitions include full `input_schema` with type definitions and descriptions

**Return Values:**
- Tool handlers: `{ success: true/false, error?: string, [dataField]: value }`
- Firebase functions: throw `HttpsError` for client errors, return data for success

## Module Design

**Exports:**
- Single file exports multiple functions via `exports.functionName = onCall(...)`
- All business logic handlers are internal functions (`handleCreateClient`, etc.)
- Export wrapper adds authentication and context handling

**Patterns:**
```javascript
exports.askAI = onCall(
  { region: "us-central1", maxInstances: 10, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    // ... handler logic
  }
);
```

---

*Convention analysis: 2026-03-04*
