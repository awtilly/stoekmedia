# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- JavaScript (Node.js) - Cloud Functions implementation
- Firebase Functions - Serverless compute layer

**Secondary:**
- JSON - Configuration and data serialization

## Runtime

**Environment:**
- Node.js 20

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Firebase Functions v5.0.0 - Serverless HTTP and background triggers
- Firebase Admin SDK v12.0.0 - Database, authentication, and storage access

**AI/LLM:**
- Anthropic SDK @anthropic-ai/sdk v0.39.0 - Claude API integration for AI assistant

**Communication:**
- SendGrid @sendgrid/mail v8.1.0 - Email delivery service

**Document Handling:**
- BoldSign (via API) - E-signature and document management

**HTTP:**
- node-fetch v2.7.0 - HTTP client for external API calls
- form-data v4.0.0 - Multipart form encoding for file uploads

## Key Dependencies

**Critical:**
- firebase-admin v12.0.0 - Firebase backend SDK for database, auth, storage operations
- @anthropic-ai/sdk v0.39.0 - Claude AI for voice-first assistant functionality (tool calling)
- @sendgrid/mail v8.1.0 - Email service for client communication

**Infrastructure:**
- firebase-functions v5.0.0 - Function deployment and request handling
- crypto (built-in) - Token generation and HMAC validation for webhooks

## Configuration

**Environment:**
- Secret parameters managed via `firebase-functions/params`:
  - `ANTHROPIC_API_KEY` - Anthropic API key for Claude
  - `SENDGRID_API_KEY` - SendGrid API key for email
  - `BOLDSIGN_API_KEY` - BoldSign API key for e-signatures
  - `BOLDSIGN_WEBHOOK_SECRET` - BoldSign webhook HMAC secret

**Build:**
- No build step required - JavaScript deployed directly to Firebase Functions
- Entry point: `index.js` in functions directory
- Firebase configuration: Implicit via `initializeApp()`

## Platform Requirements

**Development:**
- Node.js 20
- npm dependencies installed
- Firebase CLI for local testing and deployment
- Google Cloud SDK credentials for deployment

**Production:**
- Google Cloud Functions (Firebase Functions backend)
- Firestore for database
- Firebase Authentication service
- Firebase Storage for file uploads
- External APIs: Anthropic, SendGrid, BoldSign

---

*Stack analysis: 2026-03-04*
