# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
greendoor/
├── app/                        # CRM application pages (server-side HTML)
├── js/                         # Client-side JavaScript modules
├── css/                        # Stylesheets
├── features/                   # Marketing feature pages (HTML only)
├── compare/                    # Comparison pages
├── .planning/                  # GSD planning documents
├── .git/                       # Version control
├── index.html                  # Marketing homepage
├── best-real-estate-crm.html   # Marketing landing page
├── what-is-real-estate-crm.html # Content page
├── terms.html                  # Legal/terms page
└── greendoor.html              # (legacy or alternate entry)
```

## Directory Purposes

**`app/` — CRM Application Pages**
- Purpose: Server-side rendered HTML pages for authenticated users
- Contains: HTML structure, semantic markup, element ID targets for JavaScript
- Key files:
  - `admin.html` — Admin dashboard for platform management
  - `calendar.html` — Showing/appointment calendar
  - `client-detail.html` — Comprehensive client workspace
  - `clients.html` — Client roster and quick-add
  - `dashboard.html` — Realtor home page (stats, activity, briefing)
  - `faq.html` — FAQ content page
  - `listings.html` — Property listing management
  - `login.html` — Authentication entry point
  - `onboarding.html` — First-time user setup
  - `set-password.html` — Password reset page
  - `settings.html` — User preferences and profile

**`js/` — Client-Side Business Logic**
- Purpose: ES6 modules implementing feature logic and data operations
- Contains: Firestore queries, state management, event handlers, utility functions
- Key files:
  - `firebase-config.js` — Firebase app initialization (central dependency)
  - `auth.js` — Auth state, login/logout, utility exports (used by all modules)
  - `dashboard.js` — Dashboard data aggregation (largest: ~7KB)
  - `clients.js` — Client list operations (~8KB)
  - `client-detail.js` — Client workspace (largest: ~91KB, ~2000 lines)
  - `listings.js` — Listing CRUD and matching (~34KB)
  - `calendar.js` — Showing calendar (~19KB)
  - `admin.js` — Admin panel operations (~36KB)
  - `settings.js` — User preferences (~12KB)
  - `onboarding.js` — Onboarding workflow (~9KB)
  - `match-engine.js` — Listing-to-client scoring algorithm (~6KB)
  - `address-autocomplete.js` — Google Places integration (~3KB)
  - `tour.js` — Interactive guided tours (~1KB, utility)
  - `chatbot.js` — AI assistant chat (~11KB)

**`css/` — Stylesheets**
- Purpose: Design system and component styles
- Contains: Single consolidated stylesheet
- Key files:
  - `greendoor.css` — All GreenDoor CRM styles (116KB, monolithic)

**`features/` — Marketing Feature Pages**
- Purpose: Content marketing pages (not part of CRM application)
- Contains: HTML-only pages describing product features
- Key files:
  - `ai-assistant.html`
  - `e-signatures.html`
  - `email-automation.html`
  - `listing-matching.html`
  - `showing-management.html`

**`compare/` — Comparison Pages**
- Purpose: CRM feature comparison tables
- Contains: Marketing comparison content

**Root HTML Files**
- `index.html` — Marketing homepage (~40KB, SEO landing page)
- `best-real-estate-crm.html` — Comparison/features page (~26KB)
- `what-is-real-estate-crm.html` — Educational content (~17KB)
- `terms.html` — Terms of service

## Key File Locations

**Entry Points:**
- `app/login.html` — Auth entry (unauthenticated users)
- `app/dashboard.html` — Authenticated entry (post-login redirect)
- `index.html` — Marketing homepage

**Configuration:**
- `js/firebase-config.js` — Firebase SDK setup, app initialization, exports (auth, db, storage, functions)

**Core Logic:**
- `js/auth.js` — Authentication state, user profile fetching, shared utilities
- `js/client-detail.js` — Primary feature (largest file, handles complex operations)
- `js/listings.js` — Listing management and cross-client matching
- `js/admin.js` — Platform administration

**Testing:**
- None detected (no test files found)

## Naming Conventions

**Files:**

- **Page HTML:** Kebab-case feature name: `dashboard.html`, `client-detail.html`, `login.html`
- **JavaScript modules:** Kebab-case feature name: `client-detail.js`, `match-engine.js`, `address-autocomplete.js`
- **Stylesheets:** Single file `greendoor.css` for all CRM styles
- **Marketing pages:** Kebab-case descriptive: `best-real-estate-crm.html`, `what-is-real-estate-crm.html`

**Directories:**

- Lowercase single words: `app/`, `js/`, `css/`, `features/`

## Where to Add New Code

**New Feature Page (e.g., "Reports"):**
- Primary code: `app/reports.html` (page structure)
- Logic: `js/reports.js` (ES6 module with import statements)
- Pattern: Import from `js/firebase-config.js`, `js/auth.js`, and utility exports
- Example:
  ```javascript
  import { auth, db, functions, httpsCallable } from "./firebase-config.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
  import { getCurrentUser, showToast, formatDate } from "./auth.js";

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const profile = await getCurrentUser();
    // Feature logic here
  });
  ```

**New Component (e.g., "Client Filter Modal"):**
- If reusable: Extract to `js/components/client-filter.js` (create `components/` subdirectory as needed)
- If single-use: Keep inline in feature module (e.g., in `client-detail.js`)
- Pattern: Export as function, call from parent module

**New Utility Function (e.g., "Calculate Revenue"):**
- Location: Add to `js/auth.js` under utility exports section (lines 136+)
- Pattern: `export function calculateRevenue(...) { ... }`
- Import in feature modules: `import { calculateRevenue } from "./auth.js"`

**New Firestore Collection (e.g., "Reports"):**
- Firestore path: `/reports/{reportId}`
- Access pattern: `collection(db, "reports")`
- Scope: Typically linked to realtor via `realtorId` field (unless platform-wide data)
- Query pattern:
  ```javascript
  const q = query(
    collection(db, "reports"),
    where("realtorId", "==", uid),
    orderBy("createdAt", "desc")
  );
  ```

**New Cloud Function (e.g., "Generate Report"):**
- Invoked from feature module:
  ```javascript
  const generateReportFn = httpsCallable(functions, "generateReport");
  const result = await generateReportFn({ clientId, period: "monthly" });
  ```
- Deploy to Firebase Functions (backend, not in this repo)

**Styling New Component:**
- Add to `css/greendoor.css` (currently monolithic)
- Convention: Use `.gd-` class prefix (e.g., `.gd-report-card`)
- Follow existing variable naming (`--space-sm`, `--space-lg`, color vars)

## Special Directories

**`.planning/`**
- Purpose: GSD (Get Stuff Done) analysis documents
- Contains: Codebase documentation (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, INTEGRATIONS.md, STACK.md)
- Generated: Yes (created by GSD automation)
- Committed: Yes (tracked in git)

**`compare/` and `features/`**
- Purpose: Marketing content (not deployed to CRM)
- Generated: No
- Committed: Yes
- Note: Separate from core application logic

**`.git/`**
- Purpose: Version control metadata
- Generated: Yes (git repository)
- Committed: N/A (hidden)

## Import Pattern & Module Dependencies

**Dependency chain (bottom-up):**

1. **Firebase Config** (`firebase-config.js`)
   - Initialization only
   - No dependencies within codebase

2. **Auth & Utilities** (`auth.js`)
   - Depends on: `firebase-config.js`
   - Exports: `getCurrentUser()`, `showToast()`, formatters, validators

3. **Supporting Modules** (`match-engine.js`, `address-autocomplete.js`, `tour.js`)
   - Depend on: `firebase-config.js` (mostly), `auth.js` (utilities)
   - Used by: Feature modules

4. **Feature Modules** (all others)
   - Depend on: `firebase-config.js`, `auth.js`, supporting modules, Firebase SDK

**Import pattern in feature modules:**
```javascript
// 1. Cloud config
import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";

// 2. Firebase SDK (direct from CDN)
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, query, where, ... } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 3. Local utilities and modules
import { getCurrentUser, showToast, formatDate } from "./auth.js";
import { calculateMatchScore } from "./match-engine.js";
```

## Module Organization Principles

- **One page = one module:** Each `app/*.html` has a corresponding `js/*.js` file
- **Functional cohesion:** Module encapsulates all logic for its feature (queries, event handlers, renders)
- **Minimal sharing:** Shared code extracted to `auth.js`; cross-feature data access via Firestore (no direct module imports between features)
- **State isolation:** Each module maintains its own local state variables
- **Page-load pattern:** `onAuthStateChanged()` listener initiates page-specific logic

---

*Structure analysis: 2026-03-04*
