# GreenDoor CRM — App Store submission checklist

Everything paste-ready, in the order App Store Connect asks for it.
Source metadata: `metadata.md`. Screenshots: this folder.

---

## Already done (no action)

- [x] Apple Developer enrollment active — Team ID `3WCTWL4523`
- [x] APNs auth key uploaded to Firebase (dev + prod)
- [x] Account deletion in-app (guideline 5.1.1)
- [x] Privacy policy live: https://stoekmedia.com/greendoor/privacy
- [x] `ITSAppUsesNonExemptEncryption = NO` in Info.plist (skips the export-compliance question on every build)
- [x] iPhone 6.9" screenshots: `appstore-1..5.png` (1320×2868)
- [x] iPad 13" screenshots: `appstore-ipad-*.png` (2064×2752)

---

## Step 1 — Create the app record

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** → **+** → **New App**

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | `GreenDoor CRM` |
| Primary language | English (U.S.) |
| Bundle ID | `com.stoekmedia.greendoor` (pick from dropdown) |
| SKU | `greendoor-crm` |
| User access | Full Access |

If the bundle ID isn't in the dropdown: developer.apple.com → Identifiers → **+** →
App IDs → App → description `GreenDoor CRM`, explicit bundle ID
`com.stoekmedia.greendoor`, check **Push Notifications** capability → Register.
Then reload the New App form.

## Step 2 — App Information (sidebar → General)

| Field | Value |
|---|---|
| Subtitle | `The realtor's daily driver` |
| Category | Business · secondary Productivity |
| Content rights | Does not contain third-party content |
| Age rating | Answer "None/No" to everything → 4+ |

## Step 3 — Pricing and Availability

- Price: **Free** (USD 0)
- Availability: all countries is fine (or just United States)

## Step 4 — App Privacy (sidebar)

Privacy policy URL: `https://stoekmedia.com/greendoor/privacy`

Click **Get Started** and answer:

**"Do you collect data?"** → Yes.

| Data type | Collected? | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | App Functionality |
| Contact Info → Email Address | Yes | Yes | No | App Functionality |
| Contact Info → Phone Number | Yes | Yes | No | App Functionality |
| User Content → Photos or Videos | Yes | Yes | No | App Functionality |
| User Content → Other User Content | Yes | Yes | No | App Functionality |
| Identifiers → User ID | Yes | Yes | No | App Functionality |

Everything else (location, browsing history, purchases, diagnostics, etc.): **not collected**.
Firebase Analytics is disabled in this app, no ads, no tracking SDKs — so
"used for tracking" is **No** across the board.

## Step 5 — the 1.0 version page

**Screenshots**
- iPhone 6.9": upload `appstore-1.png` … `appstore-5.png` in order
- iPad 13": upload `appstore-ipad-dashboard.png`, `-clients`, `-listings`, `-calendar`, `-studio`

**Fields** (all from `metadata.md`):

- Promotional text (170): `Every client, every listing, every showing — plus Sage, your AI assistant, and a built-in marketing studio. GreenDoor is the door to your whole business.`
- Description: paste the full description block from `metadata.md`
- Keywords (100): `real estate,crm,realtor,agent,listings,showings,clients,open house,marketing,flyer,broker,mls`
- Support URL: `https://stoekmedia.com/greendoor`
- Marketing URL: `https://stoekmedia.com/greendoor` (optional)
- Version: `1.0` · Copyright: `2026 Stoek Media`

**App Review Information**
- Sign-in required: **Yes**
  - Username: `uitest@stoekmedia.com`
  - Password: `GdUiTest!2026`
- Notes:
  ```
  GreenDoor is a CRM for real estate agents. The demo account is preloaded
  with sample clients, listings, and calendar events. Accounts are created
  by invitation (agents are onboarded by their brokerage), so there is no
  public sign-up flow. Sage (AI assistant) and voice input require the
  microphone permission when used. Push notifications alert agents when a
  client signs a document.
  ```
- ⚠️ Do NOT delete the uitest account — it is the App Review demo login.
- The uitest account is a plain **realtor** (demoted from admin 2026-09-10) so
  reviewers and testers never see the Admin panel or other users' data.

## Step 6 — Archive and upload the build (Xcode)

1. Open `greendoor/ios/App/App.xcodeproj` in Xcode
2. Target **App** → Signing & Capabilities: team `3WCTWL4523` (Joseph Stoehner),
   "Automatically manage signing" — Xcode creates the App Store profile
3. Scheme destination: **Any iOS Device (arm64)**
4. Menu **Product → Archive**
5. Organizer opens → **Distribute App** → **App Store Connect** → Upload
   (defaults are fine at every screen)
6. Wait ~15–30 min for processing; the build appears under TestFlight

First archive may prompt for the Apple ID login in Xcode → Settings → Accounts.

## Step 7 — TestFlight (Alison = tester #1)

1. TestFlight tab → the processed build → complete "Test Information"
   (what to test: "Log in, add a client, tap Call/Text/Email on a client and
   log it, ask Sage to set a follow-up, add a listing, make a flyer in Studio
   and share it, subscribe to the calendar feed in Settings → Integrations")
2. Internal testing is only for your own ASC users; for Alison use
   **External Testing** → create group "Beta" → add her email → add the build
   - External TestFlight needs a quick Beta App Review (usually < 1 day)
3. She gets an email → installs TestFlight app → installs GreenDoor
4. **Real-device push test:** she logs in, taps Allow, you send a test doc
   for signature → banner should arrive when it's signed

## Step 8 — Submit for review

1. Version page → **Add Build** → select the build
2. Release option: **Manually release** (so launch timing is yours)
3. **Submit for Review**
4. Typical wait: 24–48 h. Budget one rejection cycle; commonest asks are
   demo-account issues (ours is preloaded) and privacy clarifications.

---

*Generated 2026-09-01 · branch `app-store-capacitor`*

---

## Beta scope (round one, 2026-09-10)

Hidden via the `gd-beta-hidden` CSS class (remove the class to re-enable):
Templates page, Settings → E-Signatures / Email / Sequences, Start Sequence
button, listing detail Activity / Market tabs, the e-signature FAQ entry.
Compliance forms render as a tracking list only (`COMPLIANCE_ESIGN_ENABLED`
in `js/client-detail.js`). Sage's `send_compliance_doc` tool and the
Templates navigation target are removed from `functions/index.js`.

New in this round: Call / Text / Email buttons on the client header with a
one-tap "log this?" prompt on return; push reminders for follow-ups due today
(8am local) and showings one hour out (`functions/reminders.js`, every 15 min);
Studio share/export via the native share sheet; Storage CORS for listing photos.
