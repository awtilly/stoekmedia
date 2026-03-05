---
status: complete
phase: 05-showingtime-sync
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md]
started: 2026-03-05T16:02:00Z
updated: 2026-03-05T16:06:00Z
---

## Current Test

[testing complete]

## Tests

### 1. ShowingTime Feed URL Setup
expected: On the Settings page, an "Integrations" card appears. In disconnected state, it shows a setup guide and URL input. Pasting a ShowingTime iCal feed URL and saving switches to connected state with green dot, truncated URL, last synced timestamp, and Sync Now / Disconnect buttons.
result: pass

### 2. Manual Sync
expected: Clicking "Sync Now" in the connected state triggers a sync with a spinner on the button. On completion, a success toast appears and the "last synced" timestamp updates.
result: pass

### 3. Disconnect
expected: Clicking "Disconnect" prompts a confirmation dialog. Confirming clears the feed URL, deletes all synced showings from Firestore, and returns the card to the disconnected state.
result: pass

### 4. ShowingTime Calendar Display
expected: Synced ShowingTime showings appear in both month and week calendar views with a green "ST" badge. They are read-only: cannot be dragged, and the popover shows datetime, location, and "Source: ShowingTime" with no Edit/Delete/View Client buttons.
result: pass

### 5. Calendar Legend
expected: The calendar legend shows 4 entries, including a "ShowingTime" entry with an ST-badged green dot.
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
