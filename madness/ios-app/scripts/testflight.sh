#!/bin/sh
# Archive the iOS app and upload it to App Store Connect, where it shows up under TestFlight
# after ~15-30 min of processing. Run on the Mac, from Terminal: madness/ios-app/scripts/testflight.sh
#
# Needs (one time): Xcode signed in to the Apple ID on team 3WCTWL4523 (Xcode > Settings >
# Accounts), and the App Store Connect app record for com.stoekmedia.madness (see README).
# Over SSH the login keychain is usually locked and codesign fails; run it in Terminal on the Mac.
set -e
cd "$(dirname "$0")/.."

PBX=ios/App/App.xcodeproj/project.pbxproj
OLD=$(grep -m1 -o 'CURRENT_PROJECT_VERSION = [0-9]*' "$PBX" | grep -o '[0-9]*$')
NEW=$((OLD + 1))
sed -i '' "s/CURRENT_PROJECT_VERSION = $OLD;/CURRENT_PROJECT_VERSION = $NEW;/g" "$PBX"
echo "Build number $OLD -> $NEW"

npm run -s sync

ARCHIVE="ios/App/build/Madness-$NEW.xcarchive"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist ExportOptions.plist \
  -exportPath ios/App/build/export -allowProvisioningUpdates

echo
echo "Uploaded build $NEW. Commit the bump so the next build number is right:"
echo "  git commit -am 'Madness iOS: build $NEW'"
