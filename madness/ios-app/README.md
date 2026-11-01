# Madness iOS app (Capacitor shell)

Packages the Madness web app in `../` as a native iOS app. **Packaging only:** the web app stays
vanilla JS with zero npm dependencies. Every npm package lives here, the same way `greendoor/`
does it. The plan behind this (naming, App Review risks, timeline) is
`docs/ios-app-store-plan.md` (PR #4).

| | |
|---|---|
| App Store name | Madness Draft (placeholder until the name is decided; no NCAA marks) |
| Bundle ID | `com.stoekmedia.madness` |
| Team | `3WCTWL4523` (Joseph Stoehner), automatic signing |
| Firebase | project `march-madness-snake-draft`, iOS app `1:564071043666:ios:c3057ac95585bd22ebc58b` |
| Capacitor | 8.5.0, Swift Package Manager (no CocoaPods), iOS 15+ |

## Layout

```
ios-app/
  package.json            Capacitor CLI/core/ios + haptics, share, keyboard, push-notifications
  capacitor.config.json   appId, appName, webDir "www"
  scripts/sync-www.js     copies ../index.html ../js ../icons ../manifest.json into www/, bundles Firebase JS
  scripts/testflight.sh   bump build number, archive, upload to App Store Connect
  ExportOptions.plist     app-store-connect upload settings for testflight.sh
  assets/logo.png         1024 icon source (RGB, no alpha) for `npm run assets`
  www/                    generated, gitignored
  ios/                    the Xcode project (committed, like greendoor/ios)
```

## Everyday loop (on the Mac)

```sh
cd madness/ios-app
npm install            # first time only
npm run firebase-config  # first time only: GoogleService-Info.plist (gitignored, see below)
npm run sync           # rebuild www/ from ../ and copy it into the Xcode project
npm run open           # opens Xcode; pick a simulator, press Run
```

Edit the web code in `../js/` as usual (and run `node ../scripts/stamp.js`). The app never loads
stoekmedia.com: it ships whatever `npm run sync` last copied, so re-sync before every build.

Simulator build from the command line (no signing needed):

```sh
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/dd build
```

## Push notifications: how the native side works

Same pattern as GreenDoor, already proven on this team (not the `@capacitor-firebase/messaging`
plugin the plan doc first suggested). `AppDelegate.swift` configures Firebase from
`GoogleService-Info.plist`, hands the APNs token to Firebase Messaging, and re-posts the **FCM**
token through `@capacitor/push-notifications`. So in the web code,
`Capacitor.Plugins.PushNotifications`'s `registration` event delivers an FCM token, the same kind
the Cloud Functions already send to. Swizzling is off (`FirebaseAppDelegateProxyEnabled = NO`).

`GoogleService-Info.plist` is **not committed**: it carries a Google API key, this repo is public,
and the OPSEC pre-commit hook rejects it. The Xcode project still references it, so a fresh
checkout fails to build until `npm run firebase-config` writes it (needs `firebase login` with
access to `march-madness-snake-draft`).

Still open before push works end to end (tracked in the plan doc §4 and §5):

1. Web: in `initFCM()`, when native, call `PushNotifications.requestPermissions()` + `register()`
   and write the `registration` token to the same `rooms/{roomId}/fcmTokens/{playerId}` doc.
2. Functions: add a `notification` + `apns` block to each send (iOS does not show data-only
   messages), plus the `sw.js` double-notification guard. Joe-only files.
3. Firebase console: upload an APNs auth key to `march-madness-snake-draft` (see below).

## One-time Apple and Firebase setup (Joe)

1. **App Store Connect record**: appstoreconnect.apple.com → Apps → + → New App. Platform iOS,
   name (Madness Draft or the final pick), English (U.S.), bundle ID `com.stoekmedia.madness`,
   SKU `madness-draft`, Full Access. If the bundle ID is not in the dropdown, run one signed device
   build first (Xcode → Any iOS Device → Product → Build), which registers it.
2. **APNs key into Firebase**: Firebase console → `march-madness-snake-draft` → Project settings →
   Cloud Messaging → Apple app configuration → APNs Authentication Key → Upload. Key ID and Team
   ID `3WCTWL4523`. One APNs key works for every app on the team, so reuse GreenDoor's if you
   still have the `.p8`; otherwise developer.apple.com → Keys → + → Apple Push Notifications service.
3. **Privacy policy** live at `https://stoekmedia.com/madness/privacy.html` (drafted in PR #4).

## TestFlight

```sh
scripts/testflight.sh      # in Terminal on the Mac, not over SSH (keychain)
```

Then in App Store Connect → TestFlight: internal testers (your own ASC users) can install as soon
as processing finishes. Friends need an External group, which takes a short Beta App Review.
Commit the bumped build number after each upload.
