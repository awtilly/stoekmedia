# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- JavaScript (ES6+) - Client-side frontend logic for CRM application
- HTML5 - Markup for landing pages and application pages

**Secondary:**
- CSS3 - Styling for UI components and layouts

## Runtime

**Environment:**
- Browser-based web application (no Node.js backend visible in codebase)
- Requires modern browser with ES6 module support

**Package Manager:**
- Not detected - no package.json file found in project root
- External libraries loaded via CDN (Firebase, Google Maps)

## Frameworks

**Core:**
- Firebase 10.8.0 - Backend services (Authentication, Firestore, Storage, Functions)
  - Firebase Authentication - User login/logout and password reset
  - Firestore - NoSQL database for all application data
  - Firebase Storage - Document and file upload storage
  - Firebase Functions - Cloud functions for backend operations (sendEmail, e-signature workflows, etc.)

**Frontend Libraries:**
- Google Maps JavaScript API - Address autocomplete and mapping functionality (loaded conditionally)
- Web Speech API - Voice input for AI chatbot (browser native)

**Build/Dev:**
- Module imports via ES6 `import` statements (native browser modules)
- No build tool detected (direct script loading)

## Key Dependencies

**Critical:**
- Firebase SDK 10.8.0 (`https://www.gstatic.com/firebasejs/10.8.0/`) - All core application functionality
  - `firebase-app.js` - Firebase initialization
  - `firebase-auth.js` - Authentication system
  - `firebase-firestore.js` - Database operations
  - `firebase-storage.js` - File uploads and storage
  - `firebase-functions.js` - Cloud function invocation

**External Services:**
- Google Maps Places Autocomplete API - Address parsing and validation
  - Biased toward Missouri/Illinois region (lat/lng bounds: 36.0 to 40.6 N, -95.8 to -89.0 W)
- BoldSign - Electronic signature service (invoked via Firebase Cloud Functions)
- SendGrid - Email delivery service (invoked via Firebase Cloud Functions)
- Google Cloud - Hosting and infrastructure provider

## Configuration

**Environment:**
- Firebase project: `greendoor-2da47`
- Firebase region: `us-central1` (for Cloud Functions)
- All configuration loaded from `firebase-config.js` at `js/firebase-config.js`

**Build:**
- No build configuration detected
- Direct HTML file serving with inline ES6 module scripts
- CSS loaded from `/greendoor/css/greendoor.css` and `/assets/css/style.css`

## Platform Requirements

**Development:**
- Modern web browser with ES6 module support
- Internet connection for Firebase and external APIs
- Google Maps API key (already embedded in firebase-config.js: `AIzaSyDEPiHPEURzn_gtiTaR-rbCGg06JYUSlQY`)

**Production:**
- Static web hosting (Firebase Hosting or other static host)
- Firebase backend services enabled
- BoldSign API credentials configured in backend
- SendGrid API credentials configured in backend
- Google Maps API key with Places Autocomplete service enabled

---

*Stack analysis: 2026-03-04*
