# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Multi-tier web application with serverless backend and static frontend. Real estate CRM (GreenDoor) built with Firebase backend, vanilla JavaScript frontend, and AI-powered assistant using Claude via Firebase Cloud Functions.

**Key Characteristics:**
- Client-server architecture with serverless functions handling business logic
- Event-driven AI assistant integrated throughout the UI
- Firestore document database with role-based access control
- Static HTML/CSS/JS frontend deployed via Firebase Hosting
- Real-time data synchronization via Firestore listeners

## Layers

**Frontend Layer:**
- Purpose: User interface for real estate professionals to manage clients, showings, calendar, and listings
- Location: `greendoor/app/` (HTML), `greendoor/js/` (JavaScript), `greendoor/css/` (Stylesheets)
- Contains: Page templates, module scripts, styles
- Depends on: Firebase SDK, Cloud Functions via httpsCallable
- Used by: End users (realtors)

**Backend/Functions Layer:**
- Purpose: Server-side business logic, AI assistant, integrations with external services
- Location: `functions/index.js`
- Contains: Cloud Functions, AI tool definitions, Firestore operations, email/SMS sending, document signing
- Depends on: Firebase Admin SDK, Anthropic Claude API, SendGrid, BoldSign
- Used by: Frontend via httpsCallable, webhooks from external services

**Data Layer:**
- Purpose: Persistent storage of user profiles, clients, showings, events, listings, activities
- Location: Firestore database (cloud-hosted)
- Contains: Collections for users, clients, showings, calendar_events, listings, activities, email_templates, etc.
- Depends on: Firebase Admin SDK
- Used by: Cloud Functions, frontend via Firestore listeners

**Authentication Layer:**
- Purpose: User identity and access control
- Location: `greendoor/js/auth.js`, Firebase Authentication
- Contains: Login/logout, password reset, role-based nav visibility, session management
- Depends on: Firebase Authentication, Firestore user documents
- Used by: All other layers via onAuthStateChanged listener

## Data Flow

**User Login Flow:**

1. User visits `/greendoor/app/login` and submits email/password
2. `auth.js` calls `signInWithEmailAndPassword()` (Firebase Authentication)
3. `onAuthStateChanged` listener triggers automatically
4. Fetches user document from Firestore `users` collection
5. Loads `cachedProfile` with user's role, settings, etc.
6. Redirects to dashboard if onboarding complete, else to onboarding

**AI Assistant Flow (Chat/Voice):**

1. User types/speaks in chatbot UI on any page (`greendoor/js/chatbot.js`)
2. Frontend detects page context (dashboard, clients, client-detail, calendar, listings)
3. Calls `askAssistant()` Cloud Function via httpsCallable with user message + context
4. Cloud Function (`functions/index.js`) passes message to Claude API with:
   - System prompt defining GreenDoor AI behavior
   - AI_TOOLS array (create_client, update_client, log_activity, create_showing, etc.)
   - Current user context (clients, calendar, listings data)
5. Claude processes message, potentially invokes tools
6. Cloud Function executes Firestore writes based on tool calls
7. Returns assistant response to frontend
8. Frontend displays response and refreshes UI if data changed

**Client Management Flow:**

1. Frontend loads clients list via `loadClients()` → queries Firestore `clients` collection
2. User can filter by status/name via UI
3. Clicking client opens `/greendoor/app/client-detail` with `clientId` in URL/query
4. Detail page loads all client data: profile, showings, activities, calendar events
5. User can update via form or via AI assistant
6. Updates sync to Firestore and refresh UI

**Showing Scheduling Flow:**

1. User says "schedule showing at 455 W Oak Thursday at 10am" to AI
2. AI extracts: address, date (resolves "Thursday"), time, client context
3. Calls `create_showing` tool
4. Cloud Function creates document in `showings` collection with status "scheduled"
5. Auto-creates follow-up reminder for next day if enabled
6. Frontend notifies user, calendar refreshes to show new showing

**State Management:**

- Frontend: Minimal state — mostly reads from Firestore via real-time listeners
- `cachedProfile` in auth.js stores current user info (role, name, settings)
- Page-specific state in module scope (clients list, calendar data, etc.)
- Firestore is source of truth; frontend listens to changes and re-renders

## Key Abstractions

**AI Assistant System:**

- Purpose: Natural language interface to all CRM operations
- Examples: `functions/index.js` lines 47-300+ (AI_TOOLS array)
- Pattern: Tool-calling LLM with Firestore side effects. System prompt defines behavior constraints. Each tool maps to CRUD operation or business logic.

**Firebase Modular Pattern:**

- Purpose: Structured initialization of Firebase services
- Examples: `greendoor/js/firebase-config.js`, individual module imports in each page script
- Pattern: Each module imports specific Firestore/Auth/Functions methods only as needed

**Page-Scoped Modules:**

- Purpose: Organize code by UI surface (page = module)
- Examples: `greendoor/js/dashboard.js`, `greendoor/js/client-detail.js`, `greendoor/js/calendar.js`
- Pattern: Each module initializes on page load, sets up listeners, handles UI interactions. HTML imports corresponding JS module.

**Activity Logging:**

- Purpose: Immutable audit trail of all client interactions
- Examples: `log_activity` tool in Cloud Function
- Pattern: Each activity (call, email, showing, note) creates document in `activities` subcollection under client, with timestamp and type enum

## Entry Points

**Web Application Entry:**

- Location: `greendoor/app/login.html` → `greendoor/app/dashboard.html` (if authenticated)
- Triggers: User opens https://stoekmedia.com/greendoor/app/*
- Responsibilities: Route authentication, load Firebase config, initialize auth listener

**Cloud Functions Entry:**

- Location: `functions/index.js`
- Triggers: Frontend httpsCallable invocations, webhook calls from BoldSign/SendGrid
- Responsibilities: Business logic, AI processing, database writes, external API calls

**Onboarding Entry:**

- Location: `greendoor/app/onboarding.html` → `greendoor/js/onboarding.js`
- Triggers: New user with `onboardingComplete === false`
- Responsibilities: Collect user profile, signature, avatar, preferences. Set onboardingComplete flag.

**Password Reset Entry:**

- Location: `greendoor/app/set-password.html` → `greendoor/js/set-password.js`
- Triggers: User clicks password reset link in email
- Responsibilities: Validate oobCode, accept new password, update auth

## Error Handling

**Strategy:** Try-catch at Cloud Function level, error messages displayed in UI, logging to console

**Patterns:**

- Cloud Functions wrap operations in try-catch, return error object to frontend
- Frontend shows toast/alert with user-friendly error messages
- Auth errors (wrong password, not found, too many requests) handled with specific messaging in `auth.js`
- Missing required fields in AI tool calls → Claude re-prompts user for clarification
- Firestore permission errors → redirect to login

## Cross-Cutting Concerns

**Logging:** Console.log throughout modules; production logging via Cloud Functions logs

**Validation:** Input validation in Cloud Functions before Firestore writes; frontend form validation for UX feedback

**Authentication:** `onAuthStateChanged` listener in `auth.js` enforces authentication on all CRM pages; redirects unauthenticated users to login

**Authorization:** Role-based checks (e.g., admin role shows admin tab); Firestore security rules enforce document-level access control

---

*Architecture analysis: 2026-03-04*
