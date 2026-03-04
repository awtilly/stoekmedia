# Phase 1: Foundations - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Realtors can categorize clients by transaction type and organize client files into folders, with a Closing Documents folder auto-created and protected per client. This phase establishes the foundational data (transaction type) and file organization (folders) that all subsequent phases depend on.

</domain>

<decisions>
## Implementation Decisions

### Transaction Type Selector
- Single combined dropdown with 8 options: "SFH - Buyer", "SFH - Seller", "Condo - Buyer", "Condo - Seller", "Multi-Family - Buyer", "Multi-Family - Seller", "Land - Buyer", "Land - Seller"
- Placed on the Overview tab near the existing client status field — groups key client metadata together
- Optional — can be left blank (leads don't have transaction types yet); can be cleared back to blank
- No confirmation dialog when changing — just save immediately on selection change
- Saves to `client.transactionType` in Firestore

### Folder Display & Navigation
- Folder cards displayed above the file list — row of clickable cards with icon, folder name, and file count
- Click a folder card to enter it — shows "Files > [Folder Name]" breadcrumb at top, file list filters to that folder only
- Click "Files" in breadcrumb to return to root (all folders + all root files visible)
- "+ New Folder" button alongside folder cards for creation
- Three-dot menu (kebab) on each folder card with Rename and Delete options
- Flat folder model — single level only (decided in PROJECT.md)

### Folder Migration
- Auto-create "Contracts", "Disclosures", and "Other" as real folder entities for each client
- Remap existing files that have `folder: "contracts"`, `folder: "disclosures"`, `folder: "other"` to point to the new folder documents
- Preserves current organization — no data loss during migration

### File Actions
- Three-dot menu on each file row with "Move to folder", "Download", "Delete"
- Move action shows an inline dropdown/popover listing available folders (including "Root" to move out of a folder)
- Drag-and-drop: files can be dragged onto folder cards to move them — secondary interaction alongside the menu
- Bulk move supported: when files are selected via checkboxes, the existing action bar shows a "Move to..." option
- Upload goes to the currently viewed folder — if viewing "Contracts", upload lands in Contracts; if at root, upload goes to root

### Closing Documents Folder
- Auto-created when a transaction type is set on the client (not on every page load, not for leads)
- System folder — cannot be deleted or renamed
- Three-dot menu on Closing Documents does NOT show Delete or Rename options (cleanest protection approach)
- Visual distinction: Claude's discretion on styling (lock icon, color accent, etc.) based on existing design patterns

### Claude's Discretion
- Visual styling of Closing Documents system folder (lock icon, color treatment)
- Folder card layout details (spacing, icon choice, hover states)
- Drag-and-drop visual feedback (ghost element, drop zone highlighting)
- Breadcrumb styling and animation
- Loading states for folder operations
- Toast messages for folder CRUD operations

</decisions>

<specifics>
## Specific Ideas

- Transaction type selector should feel like the existing status field on the overview tab — same visual weight, not overly prominent
- Folder cards should match the general card aesthetic in the app (subtle shadows, rounded corners)
- The three-dot menu pattern should be consistent across both folder cards and file rows

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `client-detail.js` (~2000 lines): Main workspace module — files tab, upload flow, and bulk selection bar already exist here
- `showToast()` from `auth.js`: Used for all user feedback — reuse for folder CRUD confirmations
- `escapeHtml()` from `auth.js`: Required for rendering folder names in templates
- Existing bulk selection bar (`file-action-bar`): Already handles multi-file selection with count display and close button — extend for bulk move
- `upload-folder` dropdown: Currently a `<select>` in the files tab — will be replaced by context-aware upload behavior

### Established Patterns
- Module-level state arrays: `let allFiles = []` — add `let allFolders = []` following same pattern
- Firestore query pattern: `query(collection(db, "files"), where("clientId", "==", clientId), where("realtorId", "==", uid))`
- Template literal HTML generation with `escapeHtml()` for all user data
- `onAuthStateChanged()` as page entry point — loads data, then renders
- Hard-coded folder filter via `currentFileFolder` string and `folder-filters` click handler — will be replaced by real folder navigation

### Integration Points
- `client-detail.js` files tab: All folder UI and file move actions go here
- `client-detail.html` tab-files section: HTML structure for folder cards, breadcrumb, updated file list
- `css/greendoor.css`: New styles for `.gd-folder-card`, `.gd-breadcrumb`, `.gd-file-context-menu`
- Firestore `files` collection: Add `folderId` field (reference to folder doc) — migrate from string `folder` field
- New Firestore subcollection or collection for folder entities (id, name, clientId, realtorId, isSystem, createdAt)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundations*
*Context gathered: 2026-03-04*
