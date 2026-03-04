# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Single-page application (SPA) with real-time data synchronization via Firebase.

**Key Characteristics:**
- Client-side rendered HTML pages with server-side imports of JavaScript modules
- Firebase Firestore as primary data store with real-time listeners
- ES6 module imports with Firebase SDK from CDN
- Role-based access control (realtor vs. admin)
- Feature-driven page architecture (dashboard, clients, listings, calendar, admin, settings)

## Layers

**Presentation Layer:**
- Purpose: Server HTML pages that structure the UI and define layout
- Location: `app/` directory (`admin.html`, `clients.html`, `client-detail.html`, `dashboard.html`, `calendar.html`, `listings.html`, `settings.html`, `login.html`, `onboarding.html`, `faq.html`)
- Contains: HTML structure, semantic markup, data binding targets via element IDs
- Depends on: CSS (`css/greendoor.css`), JavaScript modules in `js/`
- Used by: Browser rendering engine; consumed by JavaScript modules

**Data Access Layer:**
- Purpose: Firestore client initialization and connection configuration
- Location: `js/firebase-config.js`
- Contains: Firebase app initialization, auth/db/storage/functions exports
- Depends on: Firebase SDK (10.8.0 from CDN)
- Used by: All feature modules for database operations

**Business Logic Layer:**
- Purpose: Feature-specific functionality and state management
- Location: `js/` directory with feature files:
  - `auth.js` — Auth state, login/logout, user profile fetching, utility exports
  - `dashboard.js` — Dashboard data aggregation, activity feeds, AI briefing
  - `clients.js` — Client list loading, filtering, search
  - `client-detail.js` — Comprehensive client operations (activities, files, matches, showings, follow-ups, envelopes)
  - `listings.js` — Listing CRUD, filtering, photo uploads, client-listing matching
  - `calendar.js` — Showing calendar management
  - `admin.js` — Admin panel, user management, audit logs, platform stats
  - `settings.js` — User preferences and profile management
  - `onboarding.js` — New user onboarding workflow
  - `match-engine.js` — Scoring algorithm for listing-to-client matching
  - `address-autocomplete.js` — Google Places integration for address input
  - `tour.js` — Interactive guided tours
  - `chatbot.js` — AI assistant interactions
- Depends on: `firebase-config.js`, Cloud Functions, external APIs
- Used by: HTML pages via direct imports

**Integration Layer:**
- Purpose: Cloud Functions and external API calls
- Location: Cloud Functions invoked via `httpsCallable`:
  - `askAssistant()` — AI briefing and client summaries
  - `sendEmail()` — Email delivery
  - `sendForSignature()` — BoldSign e-signature requests
  - `checkSignatureStatus()` — Poll signature envelope status
  - `createEmbeddedSignatureRequest()` — Embedded signing workflows
  - `shareDocument()` — Document sharing
  - `parseListingUrl()` — URL-based listing parsing
- Location: Firebase Functions deployed in `us-central1`
- Contains: Serverless business logic, external API communication
- Depends on: Third-party APIs (BoldSign, Google Places, OpenAI)

**Utilities Layer:**
- Purpose: Shared helper functions
- Location: `js/auth.js` exports:
  - `getCurrentUser()` — Fetch authenticated user profile from Firestore
  - `showToast()` — Toast notifications
  - `formatCurrency()`, `formatDate()`, `formatDateTime()`, `timeAgo()` — Date/time formatting
  - `formatFileSize()` — File size display
  - `statusLabel()`, `escapeHtml()`, `sanitizeUrl()` — Data formatting and security
- Used by: All feature modules

## Data Flow

**Authentication Flow:**

1. User navigates to `/greendoor/app/login`
2. `auth.js` runs `onAuthStateChanged()` listener on every page load
3. If user is logged in:
   - Fetch user profile from `users/{uid}` collection
   - Check `onboardingComplete` flag; redirect to `/greendoor/app/onboarding` if false
   - Render user name in navigation
   - Show admin tab if `role === "admin"`
4. If user is not logged in and on CRM page:
   - Redirect to `/greendoor/app/login`
5. `handleLogin()` sends email/password to Firebase Auth, creates auth session
6. `handleLogout()` signs out and redirects to login page

**Client Data Flow (Dashboard/Clients Page):**

1. Page loads: `dashboard.html` or `clients.html`
2. Auth listener triggers `onAuthStateChanged()` in corresponding `.js` file
3. Feature module calls Firestore query: `query(collection(db, "clients"), where("realtorId", "==", uid))`
4. Results mapped to local state array
5. Render functions transform data to HTML (with escapeHtml for XSS prevention)
6. Filters/search apply client-side array operations (no re-query)
7. User interactions (create/update/delete) call Firestore write operations
8. Real-time listeners update UI if used

**Listing-Client Matching Flow:**

1. On client-detail page, `match-engine.js` exports `calculateMatchScore(listing, clientPrefs)`
2. Weighting algorithm compares:
   - Price (30% weight): Budget min/max vs. listing price
   - Location (25%): Preferred locations vs. address fields
   - Property type (10%): Exact match
   - Beds/baths/sqft (10% each): Range matching with penalties
   - Features (5%): Presence in listing features/description
   - Deal breakers: Filtered out if present
3. Score 0-100 returned with breakdown and color code
4. User can manually create matches in `clientListingMatches` collection
5. Matches appear in client detail with match score and comparison UI

**File Upload/Download Flow:**

1. User uploads file on client-detail page
2. `uploadFile()` creates resumable upload to Firebase Storage
3. Reference saved to `files/{fileId}` Firestore doc with metadata
4. Progress bar tracks upload
5. Download URL retrieved and rendered as link
6. User can delete file (removes from Storage and Firestore)

**E-Signature Flow:**

1. User uploads document or references template file
2. User selects signers and calls Cloud Function `sendForSignatureFn()`
3. Function calls BoldSign API to create signature request (envelope)
4. Returns envelope ID, saved to `envelopes/{envelopeId}` in Firestore
5. User can poll status with `checkSignatureStatusFn()` (updates `envelopes` doc)
6. When complete, can download signed document
7. Activity logged as "document signed"

**State Management:**

- Page-level state stored in module variables (e.g., `let allClients = []` in `clients.js`)
- Session state in `sessionStorage` (e.g., AI briefing cache)
- User profile cached in `auth.js` as `cachedProfile`
- Firestore provides authoritative state; no Redux/Vuex pattern used

## Key Abstractions

**User Profile:**
- Purpose: Represents authenticated user (realtor or admin)
- Location: `users/{uid}` Firestore collection
- Pattern: Loaded once per session via `getCurrentUser()` in `auth.js`
- Fields: `email`, `fullName`, `role`, `isActive`, `subscription`, `onboardingComplete`, `showTour`, `lastLogin`, etc.

**Client:**
- Purpose: Represents buyer/seller/lead contact
- Location: `clients/{clientId}` Firestore collection
- Pattern: Each client linked to realtor via `realtorId` field
- Fields: `fullName`, `email`, `phone`, `status`, `budget`, `preferredLocations`, `createdAt`, `lastActivityDate`, etc.

**Listing:**
- Purpose: Represents property
- Location: `listings/{listingId}` Firestore collection
- Pattern: Shared across all realtors (no `realtorId` field); any realtor can view and match
- Fields: `address`, `listingPrice`, `propertyType`, `bedrooms`, `bathrooms`, `squareFeet`, `features`, `status`, `photos`, `createdAt`, etc.

**ClientListingMatch:**
- Purpose: Represents a listing-to-client match/opportunity
- Location: `clientListingMatches/{matchId}` Firestore collection
- Pattern: Captures match score, user rating, and match quality
- Fields: `clientId`, `listingId`, `matchScore`, `userRating`, `notes`, `createdAt`, `status`, etc.

**Activity:**
- Purpose: Event log for client interactions (email, call, note, showing, etc.)
- Location: `activities/{activityId}` Firestore collection
- Pattern: Scoped to realtor (`realtorId`) and client (`clientId`)
- Fields: `type` ("email", "call", "note", "sms", "file_share", "showing"), `subject`, `notes`, `timestamp`, etc.

**File:**
- Purpose: Document storage reference
- Location: `files/{fileId}` Firestore doc + Firebase Storage object
- Pattern: User-uploaded or template file
- Fields: `clientId`, `realtorId`, `name`, `size`, `mimeType`, `storageUrl`, `createdAt`, etc.

**Envelope (E-Signature):**
- Purpose: BoldSign signature request wrapper
- Location: `envelopes/{envelopeId}` Firestore collection
- Pattern: Tracks signature request status and metadata
- Fields: `documentId`, `boldSignId`, `signers`, `status`, `createdAt`, `completedAt`, etc.

**Showing:**
- Purpose: Scheduled property showing
- Location: `showings/{showingId}` Firestore collection
- Pattern: Linked to client and listing
- Fields: `clientId`, `listingId`, `realtorId`, `address`, `showingDate`, `status`, `notes`, `rating`, etc.

**EmailTemplate:**
- Purpose: Reusable email draft templates
- Location: `emailTemplates/{templateId}` Firestore collection
- Pattern: Per-realtor or shared system templates
- Fields: `name`, `subject`, `body`, `createdAt`, `realtorId`, etc.

## Entry Points

**CRM Pages:**

**Dashboard (`/greendoor/app/dashboard`):**
- Location: `app/dashboard.html` + `js/dashboard.js`
- Triggers: Direct navigation; redirected from login on auth success
- Responsibilities: Load user stats (client counts by status), activity feed, upcoming showings, AI daily briefing, quick action links

**Clients (`/greendoor/app/clients`):**
- Location: `app/clients.html` + `js/clients.js`
- Triggers: Navigation link or new client workflow
- Responsibilities: List all clients for realtor, search, filter by status, quick action (AI summary), create new client

**Client Detail (`/greendoor/app/client-detail?id={clientId}`):**
- Location: `app/client-detail.html` + `js/client-detail.js` (largest module at ~2000 lines)
- Triggers: Click client row, deep linking
- Responsibilities: Comprehensive client data management — activities, files, e-signatures, showings, matches, follow-ups, email templates, notes

**Listings (`/greendoor/app/listings`):**
- Location: `app/listings.html` + `js/listings.js`
- Triggers: Navigation link
- Responsibilities: Browse all listings (shared pool), filter/search, add new listing, upload photos, match listing to client, quick match scoring

**Calendar (`/greendoor/app/calendar`):**
- Location: `app/calendar.html` + `js/calendar.js`
- Triggers: Navigation link
- Responsibilities: View scheduled showings in calendar format, create/edit/cancel showings

**Admin (`/greendoor/app/admin`):**
- Location: `app/admin.html` + `js/admin.js`
- Triggers: Navigation link (visible only to admin role)
- Responsibilities: Platform-wide analytics, user management, audit logs, invitations, platform settings

**Settings (`/greendoor/app/settings`):**
- Location: `app/settings.html` + `js/settings.js`
- Triggers: Navigation link
- Responsibilities: User profile edit, notification preferences, subscription management, etc.

**Login (`/greendoor/app/login`):**
- Location: `app/login.html` + `js/auth.js`
- Triggers: Unauthenticated user navigates to CRM, or logout
- Responsibilities: Email/password form, call Firebase Auth, handle errors (invalid creds, too many attempts)

**Onboarding (`/greendoor/app/onboarding`):**
- Location: `app/onboarding.html` + `js/onboarding.js`
- Triggers: First login (redirected if `onboardingComplete !== true`)
- Responsibilities: MLS account linking, user profile completion, email template seeding, initial setup wizard

## Error Handling

**Strategy:** Try-catch blocks around async operations with user-facing toast notifications.

**Patterns:**

- Firestore errors caught and logged to console with `console.error()`
- User-facing message shown via `showToast("message", "error")`
- Example: `catch (e) { console.error("Load clients error:", e); showToast("Failed to load clients.", "error"); }`
- Auth errors handled with specific messages (e.g., "auth/user-not-found" → "Invalid email or password")
- Cloud Function errors catch and display generic "Failed to..." message to user
- Loading spinners hidden on error; content remains visible for retry

## Cross-Cutting Concerns

**Logging:**
- Uses browser `console.error()` for diagnostic logging
- No centralized logging service
- Errors logged during data operations and API calls
- Example: `console.error("Stats error:", e)`

**Validation:**
- Form inputs validated before Firestore writes
- Email validation on login/signup
- Budget/bed/bath inputs parsed as numbers with fallback to 0 or empty
- HTML escaping applied on all user-generated content display via `escapeHtml()`
- URL sanitization with `sanitizeUrl()` before rendering links

**Authentication:**
- Firebase Auth session managed automatically
- `onAuthStateChanged()` listener provides auth state on every page
- Role-based access via `profile.role === "admin"` checks
- Admin panel hidden from realtors (CSS + server-side check on page load)
- Redirect to login if not authenticated

**Real-Time Sync:**
- No real-time listeners configured in current code (all one-time queries)
- State refreshed on user action or page navigation
- Future opportunity for `onSnapshot()` to keep client/listing lists live

---

*Architecture analysis: 2026-03-04*
