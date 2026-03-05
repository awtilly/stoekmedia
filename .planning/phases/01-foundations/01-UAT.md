---
status: complete
phase: 01-foundations
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md]
started: 2026-03-05T15:40:00Z
updated: 2026-03-05T15:48:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Transaction Type Selector
expected: On the client detail page, the Overview tab's Status & Source section has a transaction type dropdown with 8 options (SFH/Condo/Multi-Family/Land x Buyer/Seller) plus blank default. Selecting a value saves immediately with a toast confirmation. Clearing to blank saves null.
result: pass

### 2. Folder Card Navigation
expected: On the client detail Files tab, folders display as clickable cards above the file list with icon, name, and file count. Clicking a folder filters to show only its files with a breadcrumb "Files > Folder Name". Clicking "Files" in the breadcrumb returns to root view showing all files.
result: pass

### 3. Create, Rename, and Delete Folder
expected: A "+" card creates a new folder via browser prompt. Each folder card has a three-dot kebab menu with Rename and Delete options. Deleting a folder moves its files to root. System folders show a lock icon and have no kebab menu.
result: pass

### 4. File Context Menu
expected: Each file row has a three-dot kebab menu with Move to folder, Download, and Delete options. Clicking "Move to folder" shows a popover listing available folders to move the file into.
result: pass

### 5. Drag and Drop File to Folder
expected: Dragging a file row onto a folder card moves the file into that folder. The folder card visually highlights during drag-over.
result: pass

### 6. Closing Documents Auto-Folder
expected: When a transaction type is set on a client (via the dropdown), a "Closing Documents" system folder with a lock icon is automatically created in the Files tab. It persists on page refresh and cannot be renamed or deleted via the kebab menu.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
