# GreenDoor CRM

## What This Is

GreenDoor is a Firebase-based real estate CRM for solo agents and small teams, built with vanilla HTML/CSS/JavaScript and Firebase (Auth, Firestore, Storage, Cloud Functions). It helps realtors manage clients, listings, showings, and document workflows. Currently serving a solo agent in the St. Louis, Missouri market.

## Core Value

Realtors can manage their entire client-to-close workflow in one place — from lead intake through document signing to closing — without switching between tools.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Email/password authentication with session persistence — existing
- ✓ New user onboarding wizard (profile, MLS link, email templates) — existing
- ✓ Client CRUD with status tracking (lead/active/closed) — existing
- ✓ Client search, filtering, and list management — existing
- ✓ Client detail page with activities, files, showings, matches, follow-ups — existing
- ✓ Listing CRUD with photos, MLS data, and property details — existing
- ✓ Smart listing-to-client matching engine (weighted scoring algorithm) — existing
- ✓ Showing scheduling and calendar management — existing
- ✓ File upload/download per client (Firebase Storage) — existing
- ✓ BoldSign e-signature integration (send, check status, embedded signing) — existing
- ✓ AI assistant chatbot (cloud function, voice input, email drafting) — existing
- ✓ AI daily briefing on dashboard — existing
- ✓ Email sending via SendGrid with templates — existing
- ✓ Google Maps address autocomplete (MO/IL biased) — existing
- ✓ Admin panel with user management, audit logs, platform stats — existing
- ✓ Role-based access (realtor vs admin) — existing
- ✓ Interactive product tour for new users — existing
- ✓ Marketing site with SEO pages — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] BoldSign sender email shows realtor's name and email (not BoldSign default)
- [ ] Client file folder management (create, rename, delete folders; move files between folders)
- [ ] Auto-created "Closing Documents" folder per client
- [ ] Compliance document template library organized by transaction type
- [ ] Transaction type selection per client (SFH/Condo/Multi-Family/Land — Buyer/Seller)
- [ ] Merge field autofill from client, listing, and agent data into BoldSign templates
- [ ] Send compliance docs for signature with pre-filled fields
- [ ] Track compliance doc status per client (not sent / sent / signed)
- [ ] BoldSign webhook to auto-save signed PDFs to client's Closing Documents folder
- [ ] AI-powered closing checklist per client, seeded by transaction type
- [ ] Auto-complete checklist items when compliance docs are signed
- [ ] AI check-in for transaction guidance (contextual, uses checklist + client data)
- [ ] ShowingTime iCal feed sync (import showings from webcal feed)
- [ ] ShowingTime showings displayed in calendar with read-only badge
- [ ] Scheduled cloud function to sync ShowingTime feeds every 30 minutes

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multi-state compliance doc packs — Missouri first, expand later after validating the workflow
- BoldSign template creation UI in admin — templates created manually in BoldSign dashboard, IDs pasted
- Real-time chat/messaging between agents — not core to solo agent workflow
- Mobile native app — web-first, mobile-responsive is sufficient for now
- OAuth/social login — email/password is sufficient for current user base
- MLS data feed integration — manual listing entry + URL parsing is working
- Persistent AI chat history — session-only to keep costs down

## Context

- **Market:** St. Louis, Missouri residential real estate (single family, condo, multi-family, land)
- **Users:** Solo agent currently; designed for small teams at a brokerage
- **BoldSign:** Already integrated for basic e-signatures. Templates for MO compliance forms need to be created in BoldSign's dashboard — GreenDoor will reference template IDs
- **AI Assistant:** Already exists via `askAssistant` Cloud Function and `chatbot.js` — will be extended for closing checklist AI check-in
- **ShowingTime:** No public API; agents have personal webcal/iCal feeds that can be parsed
- **File storage:** Currently flat per client. Needs folder hierarchy, especially "Closing Documents" for signed doc auto-archiving
- **MO compliance forms:** Need to research standard St. Louis residential transaction forms (Purchase Agreement, Seller's Disclosure, Agency Disclosure, Lead Paint, HOA Addendum, etc.)
- **Codebase:** ~15 vanilla JS modules, no build system, Firebase SDK from CDN, Cloud Functions for backend logic

## Constraints

- **Tech stack**: Vanilla HTML/CSS/JS + Firebase — no framework migration
- **BoldSign templates**: Created manually in BoldSign dashboard; GreenDoor stores template IDs as stubs until real IDs are added
- **ShowingTime**: No API — limited to iCal feed parsing (webcal/https)
- **Solo deployment**: No CI/CD pipeline — manual Firebase deploy
- **Budget**: Minimize AI API costs (session-only chat history, no persistent conversation storage)

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Missouri-first compliance docs | Solo agent is in STL; validate workflow before expanding | — Pending |
| Seed BoldSign templates with stubs | Templates don't exist yet; decouple template creation from code | — Pending |
| Session-only AI chat for checklist | Keeps API costs down; realtors don't need persistent transcripts | — Pending |
| ShowingTime via iCal (not API) | No public API available; webcal feeds are standard | — Pending |
| Sequential sprint order (1-6) | Each sprint builds on the last (folders before webhook, compliance before checklist) | — Pending |
| Flat folder model (not nested) | Single level of folders per client is sufficient for document organization | — Pending |

---
*Last updated: 2026-03-04 after initialization*
