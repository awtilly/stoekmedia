# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**AI Assistant:**
- Anthropic Claude API - AI-powered voice-first assistant for CRM operations
  - SDK/Client: @anthropic-ai/sdk v0.39.0
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Features: Tool calling, natural language understanding, email drafting

**Email & Communication:**
- SendGrid - Email delivery service
  - SDK/Client: @sendgrid/mail v8.1.0
  - Auth: `SENDGRID_API_KEY` environment variable
  - Used for: Client notifications, email campaigns

**Document Management & E-Signatures:**
- BoldSign - Document signing and management
  - Auth: `BOLDSIGN_API_KEY` environment variable
  - Webhook Secret: `BOLDSIGN_WEBHOOK_SECRET` environment variable
  - Used for: Document signing workflows, signature verification

## Data Storage

**Databases:**
- Firestore (Firebase)
  - Connection: Implicit via `firebase-admin/app` initialization
  - Client: Firebase Admin SDK v12.0.0
  - Usage: Primary database for clients, showings, follow-ups, activities, events
  - Collections: clients, showings, followups, activities, events, documents

**File Storage:**
- Firebase Storage
  - Client: Firebase Admin SDK v12.0.0 (`getStorage()`)
  - Usage: Document uploads and file storage

**Caching:**
- None detected

## Authentication & Identity

**Auth Provider:**
- Firebase Authentication
  - Implementation: Firebase Admin SDK v12.0.0 (`getAuth()`)
  - Used for: User authentication, ID token validation in HTTP requests
  - Methods: Token-based authentication via Firebase ID tokens

**Webhook Verification:**
- BoldSign webhooks
  - Auth: HMAC-SHA256 signature validation
  - Secret: `BOLDSIGN_WEBHOOK_SECRET` used for verifying webhook authenticity
  - Implementation: Crypto-based signature verification in webhook handlers

## Monitoring & Observability

**Error Tracking:**
- None detected (Firebase Functions logs to Google Cloud Logging)

**Logs:**
- Google Cloud Logging (implicit via Firebase Functions)
- Console logging via standard Node.js `console` methods

## CI/CD & Deployment

**Hosting:**
- Google Cloud Functions (Firebase Functions)
- Deployment: Firebase CLI or Google Cloud Build

**CI Pipeline:**
- None detected in codebase

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` - Anthropic API authentication
- `SENDGRID_API_KEY` - SendGrid email service authentication
- `BOLDSIGN_API_KEY` - BoldSign document signing authentication
- `BOLDSIGN_WEBHOOK_SECRET` - HMAC secret for webhook verification

**Secrets location:**
- Firebase Functions secret parameters (`firebase-functions/params`)
- Define via `firebase functions:secrets:set` command
- Runtime access via `defineSecret()` in `functions/index.js`

## Webhooks & Callbacks

**Incoming:**
- BoldSign webhooks for signature events and document status updates
- Handler: `onRequest` HTTP endpoint for webhook processing
- Verification: HMAC-SHA256 signature validation using `BOLDSIGN_WEBHOOK_SECRET`

**Outgoing:**
- Email callbacks via SendGrid (delivery status, bounce handling)
- Webhook callbacks to external systems for document events (via BoldSign integration)

## Data Flow

**Client Management Flow:**
1. Firebase Authentication validates user
2. HTTP request routed to appropriate function via Cloud Functions
3. Claude AI processes natural language intent
4. Tools execute CRUD operations on Firestore
5. Results returned to client

**Email Workflow:**
1. Claude AI generates email content
2. SendGrid API called to send message
3. Email delivery logged to Firestore activity timeline

**Document Signing Workflow:**
1. Document uploaded to Firebase Storage
2. BoldSign API called to initiate signing
3. BoldSign webhook sends status updates
4. HMAC signature verified before processing
5. Document status updated in Firestore

---

*Integration audit: 2026-03-04*
