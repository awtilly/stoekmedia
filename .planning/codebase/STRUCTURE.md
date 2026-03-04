# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
/Users/joestoehner/Desktop/GitHub/stoekmedia/
├── functions/               # Firebase Cloud Functions (backend)
│   ├── index.js            # All Cloud Functions, AI tools, business logic
│   ├── package.json        # Node.js dependencies (Firebase, Anthropic, SendGrid, etc.)
│   └── node_modules/       # Installed dependencies
├── greendoor/              # Real estate CRM application
│   ├── app/                # HTML page templates (11 pages)
│   ├── js/                 # JavaScript modules (one per page + utilities)
│   ├── css/                # Stylesheets
│   └── index.html          # Main landing/marketing page
├── .planning/              # GSD planning documents
│   └── codebase/           # Architecture/structure/conventions docs
├── assets/                 # Shared images, CSS, JS (global)
├── blog/                   # Blog content
├── about/                  # About page
├── bookings/               # Bookings/scheduling related
├── software/               # Software product pages
├── firebase.json           # Firebase hosting config
├── firestore.rules         # Firestore security rules
├── storage.rules           # Cloud Storage security rules
├── firestore.indexes.json  # Firestore index definitions
└── index.html              # Website homepage
```

## Directory Purposes

**functions/:**
- Purpose: Serverless backend for all business logic and external integrations
- Contains: Node.js Cloud Functions, AI assistant implementation, database operations
- Key files: `index.js` (300+ lines, all functions and AI tools)

**greendoor/app/:**
- Purpose: HTML templates for 11 pages in the CRM application
- Contains: HTML pages for login, dashboard, clients, client-detail, calendar, listings, settings, admin, onboarding, FAQ, etc.
- Key files: `dashboard.html`, `client-detail.html`, `calendar.html`, `admin.html`, `login.html`

**greendoor/js/:**
- Purpose: JavaScript module for each CRM page, plus utilities
- Contains: Page-scoped initialization, event handlers, UI rendering, Firestore listeners
- Key files:
  - `firebase-config.js` - Firebase SDK initialization
  - `auth.js` - Authentication and global auth listener
  - `dashboard.js` - Dashboard page logic
  - `client-detail.js` - Client detail page logic (largest: 90KB)
  - `calendar.js` - Calendar page logic
  - `chatbot.js` - AI assistant UI and integration
  - `clients.js` - Clients list page logic
  - `admin.js` - Admin panel logic
  - `listings.js` - Listings management
  - `settings.js` - User settings
  - `onboarding.js` - Onboarding flow
  - `set-password.js` - Password reset form
  - `tour.js` - Guided tour UI
  - Utilities: `address-autocomplete.js`, `match-engine.js`

**greendoor/css/:**
- Purpose: Styling for CRM application
- Contains: CSS stylesheets

**assets/:**
- Purpose: Global assets shared across website and app
- Contains: Images, global CSS, global JavaScript

**firestore.rules:**
- Purpose: Security rules for Firestore database access
- Contains: Role-based access control rules

## Key File Locations

**Entry Points:**

- `greendoor/app/login.html`: Login page — initial entry point
- `greendoor/app/dashboard.html`: Main dashboard after login
- `functions/index.js`: Cloud Function handlers invoked by frontend

**Configuration:**

- `greendoor/js/firebase-config.js`: Firebase project config, SDK initialization
- `firebase.json`: Firebase hosting and functions configuration
- `functions/package.json`: Backend dependencies
- `firestore.rules`: Database access control rules

**Core Logic:**

- `functions/index.js`: All Cloud Functions (AI assistant, CRUD operations, integrations)
- `greendoor/js/auth.js`: Authentication state and login/logout handlers
- `greendoor/js/chatbot.js`: AI assistant UI and message flow

**Testing:**

- Not detected — no test files in codebase

## Naming Conventions

**Files:**

- HTML pages: kebab-case (e.g., `client-detail.html`, `set-password.html`)
- JavaScript modules: kebab-case matching HTML page names (e.g., `client-detail.js`, `set-password.js`)
- Utility files: kebab-case describing function (e.g., `address-autocomplete.js`, `match-engine.js`)
- Config files: kebab-case (e.g., `firebase-config.js`)

**Directories:**

- Simple lowercase (e.g., `app`, `js`, `css`, `functions`, `assets`)

**JavaScript Functions:**

- camelCase for regular functions: `loadClients()`, `renderClients()`, `handleLogin()`
- camelCase for exported handler functions: `handleLogin`, `handleForgotPassword`
- UPPERCASE for constants: `SYSTEM_PROMPT`, `AI_TOOLS`, `DAYS`, `MONTHS`, `WEIGHTS`

**Variables:**

- camelCase for standard variables: `cachedProfile`, `userDoc`, `showingDate`
- Suffixes for elements: `-El` for DOM elements (e.g., `nameEl`, `errorEl`, `formEl`)
- Prefixes for functions tied to buttons: `handle-` (e.g., `handleLogin`, `handleForgotPassword`)

**Firestore Collections & Documents:**

- Lowercase plural for collections: `users`, `clients`, `showings`, `calendar_events`, `listings`, `activities`
- Document IDs: auto-generated by Firestore or meaningful strings
- Subcollections: lowercase, nested under parent (e.g., `clients/{clientId}/activities`)

## Where to Add New Code

**New Feature (e.g., new CRM capability):**

- Backend logic: Add to `functions/index.js` as new Cloud Function or extend existing one
- Frontend logic: Create `greendoor/js/new-feature.js`
- HTML page: Create `greendoor/app/new-feature.html`
- Add httpsCallable import to JS: `const newFeature = httpsCallable(functions, "newFeatureName")`
- If AI-accessible: Add tool definition to `AI_TOOLS` array in `functions/index.js`

**New Cloud Function:**

- Add handler function to `functions/index.js` using `exports.functionName = onCall(...)` or `onRequest(...)`
- Define input schema in function docstring or as const
- Use `db`, `auth`, and service clients to interact with Firebase/external APIs
- Return response object with data or error

**New Page/Module:**

- Create `greendoor/app/page-name.html` with content and script import
- Create `greendoor/js/page-name.js` with initialization, listeners, and UI handlers
- Import Firebase config: `import { db, auth, functions, httpsCallable } from "./firebase-config.js"`
- Export window-level handlers: `window.handleAction = async function () { ... }`

**New Utility/Helper:**

- Create `greendoor/js/util-name.js` with export/import of helper functions
- Import in relevant modules as needed

**Firestore Data:**

- Add collection references to `functions/index.js` where data is written
- Add security rules to `firestore.rules` for new collections
- Run `firebase deploy --only firestore:rules` to apply

## Special Directories

**functions/node_modules/:**
- Purpose: Installed npm dependencies for Cloud Functions
- Generated: Yes (via npm install)
- Committed: No (excluded by .gitignore)

**.planning/codebase/:**
- Purpose: Architecture and structure documentation (GSD planning)
- Generated: Manually created by codebase mapper
- Committed: Yes

**.firebase/:**
- Purpose: Firebase local development cache and config
- Generated: Yes (by Firebase CLI)
- Committed: No

---

*Structure analysis: 2026-03-04*
