# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**AI & Chatbot:**
- Firebase Cloud Functions (`askAssistant`) - Powers the GreenDoor AI assistant
  - SDK/Client: `firebase-functions` 10.8.0
  - Purpose: Processes user questions, provides context-aware responses, drafts emails, and manages document actions
  - Located in: `js/chatbot.js`
  - Invocation: `httpsCallable(functions, "askAssistant")`

**Email & Communication:**
- SendGrid - Email delivery service
  - Purpose: Sends transactional emails (client follow-ups, confirmations)
  - Invocation: via `sendEmail` Cloud Function
  - Email verification: Uses SendGrid verification links for sender email validation
  - Located in: `js/settings.js` (configuration/testing), `js/client-detail.js` (send operations)

**Address & Maps:**
- Google Maps Places Autocomplete API
  - Purpose: Address autocomplete when adding clients, listings, and properties
  - Key: `AIzaSyDEPiHPEURzn_gtiTaR-rbCGg06JYUSlQY`
  - Biased region: Missouri/Illinois (36.0-40.6°N, -95.8°W to -89.0°W)
  - SDK/Client: Native `google.maps.places.Autocomplete`
  - Located in: `js/address-autocomplete.js`
  - Features: Structured address parsing (street, city, state, zip, county, neighborhood, lat/lng)

**Document & E-Signatures:**
- BoldSign - Electronic signature service
  - Purpose: Send documents for signature, manage signing workflows, embedded signing UI
  - SDK/Client: Cloud Functions calling BoldSign API
  - Functions involved:
    - `sendForSignature` - Initiate signature request
    - `checkSignatureStatus` - Poll signature completion status
    - `createEmbeddedSignatureRequest` - Create embedded signing experience
  - Embed: Opens in modal with `openBoldSignEmbed()` function
  - Testing: `stressTestBoldSign` Cloud Function (diagnostics)
  - Located in: `js/client-detail.js` (signature workflows), `js/settings.js` (testing)

## Data Storage

**Databases:**
- Firebase Firestore
  - Connection: `const db = getFirestore(app)` (firebase-config.js)
  - Client: `firebase-firestore` 10.8.0 SDK
  - Collections:
    - `users` - Realtor profiles (fullName, email, role, onboardingComplete, emailSignature, lastLogin, etc.)
    - `clients` - Client records per realtor (fullName, email, phone, status, budget range, preferences, etc.)
    - `listings` - Property listings (address, price, bedrooms, bathrooms, features, MLS number, etc.)
    - `clientListingMatches` - Smart match scores between clients and listings
    - `activities` - Client interactions (notes, calls, emails, file shares, showings, follow-ups)
    - `files` - Uploaded documents and attachments
    - `envelopes` - E-signature requests and tracking
    - `showings` - Property showings and viewing schedules
    - `followUps` - Automated and scheduled follow-up tasks
    - `emailTemplates` - Saved email templates per realtor
    - `settings` - User preferences and configuration
    - `trialRequests` - Trial signup form submissions
  - Real-time subscriptions: `onSnapshot()` used for live updates on client detail page

**File Storage:**
- Firebase Storage
  - Purpose: Store client documents, listing photos, file attachments, signatures
  - Client: `firebase-storage` 10.8.0 SDK
  - Operations: `uploadBytesResumable()`, `getDownloadURL()`, `deleteObject()`
  - Located in: `js/client-detail.js` (file uploads/management), `js/listings.js` (photo uploads)

**Caching:**
- In-memory JavaScript objects (arrays and caches)
  - `allClients` - Cached client list in `js/clients.js`
  - `allMatches` - Cached listing matches in `js/client-detail.js`
  - `emailTemplates` - Cached templates in `js/client-detail.js`
  - `allListings` - Cached listings in `js/listings.js`
  - Session-based: Chat history stored in `chatHistory` array in `js/chatbot.js`

## Authentication & Identity

**Auth Provider:**
- Firebase Authentication
  - Implementation: Email/password authentication
  - Methods:
    - `signInWithEmailAndPassword()` - User login
    - `sendPasswordResetEmail()` - Password recovery with custom reset URL
    - `signOut()` - User logout
  - Auth gating: `onAuthStateChanged()` listener guards all CRM pages
  - Redirect logic: Unauthenticated users → login page; incomplete onboarding → onboarding page
  - Located in: `js/auth.js` (core auth flows), all app pages use `onAuthStateChanged`

## Monitoring & Observability

**Error Tracking:**
- Not detected - errors logged to browser console only (`console.error()`)

**Logs:**
- Browser console logging via `console.error()` and `console.warn()`
  - Examples: "Load client error:", "Speech error:", "Google Maps Places API not loaded"
  - No remote logging infrastructure detected

**Application-level Feedback:**
- Toast notifications (`showToast()` function in `js/auth.js`)
  - Success messages: Green color (#22c55e)
  - Error messages: Red color (#ef4444)
  - Used throughout for user feedback on operations

## CI/CD & Deployment

**Hosting:**
- Firebase Hosting (inferred from Firebase setup and project name `greendoor-2da47`)
- Static site hosting for HTML/CSS/JS files
- Cloud Functions deployment through Firebase Console

**CI Pipeline:**
- Not detected - no build configuration or CI files found

## Environment Configuration

**Required env vars:**
- Not used in codebase - Firebase config is hardcoded in `firebase-config.js`
- Google Maps API key: `AIzaSyDEPiHPEURzn_gtiTaR-rbCGg06JYUSlQY` (hardcoded in firebase-config.js and index.html)

**Secrets location:**
- Hardcoded in source files (not ideal for production):
  - Firebase config: `js/firebase-config.js` (lines 7-14)
  - Google Maps key: `js/firebase-config.js` (line 8)
  - BoldSign API key: Configured server-side in Cloud Functions (not visible in client code)
  - SendGrid API key: Configured server-side in Cloud Functions (not visible in client code)

## Webhooks & Callbacks

**Incoming:**
- Trial form submissions: Written to Firestore `trialRequests` collection
  - Endpoint: POST to `/` (form submission in index.html)
  - Data: firstName, lastName, email, phone, brokerage, createdAt, status

**Outgoing:**
- Email notifications via SendGrid (Firebase Cloud Functions):
  - Client follow-ups
  - Email template sending
  - Password reset emails (via Firebase Auth)
- E-signature workflows via BoldSign:
  - Signature request sent to client
  - Signature status callbacks checked via `checkSignatureStatus` function
  - Document download URLs generated after signing

**Real-time Updates:**
- Firestore listeners (`onSnapshot()`) for live data sync on client detail page
- Activity feeds update in real-time as notes/calls/emails are logged

---

*Integration audit: 2026-03-04*
