# Phase 1: Foundations - Research

**Researched:** 2026-03-04
**Domain:** Firestore data modeling, vanilla JS UI (folder navigation, drag-and-drop, context menus), Firebase SDK 10.8.0
**Confidence:** HIGH

## Summary

Phase 1 adds two foundational features to the existing `client-detail.js` module: a transaction type selector on the Overview tab and a full folder management system in the Files tab. The existing codebase is a vanilla HTML/CSS/JS app using Firebase SDK 10.8.0 from CDN (no build system, no package manager). All changes target three files: `app/client-detail.html`, `js/client-detail.js` (~2345 lines), and `css/greendoor.css` (~6000 lines).

The folder system replaces the current hard-coded string-based folder filter (`currentFileFolder` with values like "contracts", "disclosures", "other") with real Firestore folder documents. This requires a data migration for existing files and a new `folders` top-level collection. The transaction type selector is straightforward -- a `<select>` element added to the "Status & Source" section, saving to `client.transactionType`. The Closing Documents system folder auto-creates when a transaction type is first set, not on every page load.

**Primary recommendation:** Implement in three plans as specified -- transaction type first (schema-only, smallest surface), then folder CRUD (largest plan, most UI work), then Closing Documents auto-creation (depends on transaction type being set and folders existing). Each plan modifies the same three files, so they must be strictly sequential.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single combined dropdown with 8 options: "SFH - Buyer", "SFH - Seller", "Condo - Buyer", "Condo - Seller", "Multi-Family - Buyer", "Multi-Family - Seller", "Land - Buyer", "Land - Seller"
- Placed on the Overview tab near the existing client status field
- Optional -- can be left blank; can be cleared back to blank
- No confirmation dialog when changing -- just save immediately on selection change
- Saves to `client.transactionType` in Firestore
- Folder cards displayed above the file list -- row of clickable cards with icon, folder name, and file count
- Click a folder card to enter it -- shows "Files > [Folder Name]" breadcrumb at top, file list filters to that folder only
- Click "Files" in breadcrumb to return to root (all folders + all root files visible)
- "+ New Folder" button alongside folder cards for creation
- Three-dot menu (kebab) on each folder card with Rename and Delete options
- Flat folder model -- single level only
- Auto-create "Contracts", "Disclosures", and "Other" as real folder entities for each client (migration)
- Remap existing files that have folder: "contracts", "disclosures", "other" to point to the new folder documents
- Three-dot menu on each file row with "Move to folder", "Download", "Delete"
- Move action shows an inline dropdown/popover listing available folders (including "Root")
- Drag-and-drop: files can be dragged onto folder cards to move them
- Bulk move supported via existing file-action-bar
- Upload goes to the currently viewed folder
- Closing Documents auto-created when a transaction type is set on the client (not on every page load, not for leads)
- System folder -- cannot be deleted or renamed
- Three-dot menu on Closing Documents does NOT show Delete or Rename options

### Claude's Discretion
- Visual styling of Closing Documents system folder (lock icon, color treatment)
- Folder card layout details (spacing, icon choice, hover states)
- Drag-and-drop visual feedback (ghost element, drop zone highlighting)
- Breadcrumb styling and animation
- Loading states for folder operations
- Toast messages for folder CRUD operations

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TXTP-01 | Client detail page has a transaction type selector (SFH/Condo/Multi-Family/Land x Buyer/Seller) | Add `<select>` to "Status & Source" section in client-detail.html; 8 `<option>` values; save via `updateDoc` on change event |
| TXTP-02 | Selected transaction type saves to client's Firestore document (client.transactionType) | Field `transactionType` on `clients/{clientId}` doc; populate in `populateOverview()`, save in change handler |
| FLDR-01 | User can create a named folder for a client's files | `addDoc` to `folders` collection with {name, clientId, realtorId, isSystem: false, createdAt}; inline name input or modal |
| FLDR-02 | User can rename an existing folder | `updateDoc` on folder doc; inline edit on folder card or prompt; disallow rename on system folders |
| FLDR-03 | User can delete a folder (files move to root, not deleted) | `deleteDoc` folder + `writeBatch` to clear `folderId` on all files in that folder; prevent delete on system folders |
| FLDR-04 | Folder cards display above the file list with name and file count | New `.gd-folder-cards` container in HTML; render from `allFolders` array; count via `allFiles.filter(f => f.folderId === folder.id).length` |
| FLDR-05 | User can click a folder to filter files; breadcrumb navigates back to root | Replace `currentFileFolder` string filter with `currentFolderId`; render breadcrumb when inside a folder |
| FLDR-06 | User can move a file to a folder or back to root via context menu | Three-dot kebab menu on each file row; `updateDoc` to set/clear `folderId`; also drag-and-drop onto folder cards |
| FLDR-07 | A "Closing Documents" system folder auto-creates per client on page load | Triggered when transactionType is set; query folders where isSystem === true; if none exists, create one with `isSystem: true, name: "Closing Documents"` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Firebase JS SDK | 10.8.0 | Auth, Firestore, Storage | Already in use via CDN imports; no package manager |
| Vanilla JS (ES modules) | ES2020+ | All application logic | Project constraint -- no framework migration |
| HTML5 Drag and Drop API | Native | File-to-folder drag-and-drop | Built into browsers; no library needed for simple card drop targets |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `writeBatch` (Firestore) | 10.8.0 | Atomic multi-doc writes | Folder delete (move files to root) and migration (remap existing files) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HTML5 Drag and Drop API | SortableJS library | Adds dependency; overkill for simple drop-on-card; project has no package manager |
| Top-level `folders` collection | Subcollection `clients/{id}/folders` | Subcollection would scope queries but complicates cross-client operations and later phases; top-level with `clientId` + `realtorId` fields matches existing `files` collection pattern |

**Installation:**
No installation needed -- all dependencies loaded via CDN `<script type="module">` imports. Add `writeBatch` to the existing Firestore import line in `client-detail.js`.

## Architecture Patterns

### Firestore Data Model

#### New `folders` collection (top-level)
```
folders/{folderId}
  name: string              // "Contracts", "Closing Documents", etc.
  clientId: string          // references clients/{clientId}
  realtorId: string         // owner UID
  isSystem: boolean         // true for "Closing Documents" (cannot delete/rename)
  createdAt: Timestamp      // serverTimestamp()
```

#### Modified `files` collection (existing)
```
files/{fileId}
  ... existing fields ...
  folder: string            // DEPRECATED - old string value ("contracts", "disclosures", "other")
  folderId: string | null   // NEW - references folders/{folderId}, null = root
```

#### Modified `clients` collection (existing)
```
clients/{clientId}
  ... existing fields ...
  transactionType: string | null  // NEW - "SFH - Buyer", "Condo - Seller", etc.
```

### Recommended Code Structure (within client-detail.js)

Since this is a single-file vanilla JS module, new code sections follow existing conventions:

```
js/client-detail.js additions:
  - Module state: let allFolders = []; let currentFolderId = null;
  - loadFolders(uid) — query folders collection, populate allFolders
  - renderFolderCards() — generate folder card HTML above file list
  - renderBreadcrumb() — show "Files > Folder Name" when inside a folder
  - createFolder(name) — addDoc to folders collection
  - renameFolder(folderId, newName) — updateDoc
  - deleteFolder(folderId) — writeBatch: clear folderId on files, delete folder doc
  - moveFileToFolder(fileId, folderId) — updateDoc on file doc
  - bulkMoveToFolder(fileIds, folderId) — writeBatch update
  - ensureClosingDocumentsFolder(clientId, uid) — check + create system folder
  - migrateExistingFolders(uid) — one-time migration of string folder values to folder docs
```

### Pattern 1: Immediate Save on Selection Change (Transaction Type)
**What:** Save to Firestore immediately when dropdown value changes, no "Save" button
**When to use:** Transaction type selector (matches user decision: "no confirmation dialog, save immediately")
**Example:**
```javascript
// Source: Existing pattern in client-detail.js (similar to how status changes work)
document.getElementById("ov-transactionType").addEventListener("change", async (e) => {
  const user = auth.currentUser;
  if (!user) return;
  const value = e.target.value || null; // empty string -> null (clearable)
  try {
    await updateDoc(doc(db, "clients", clientId), { transactionType: value });
    clientData.transactionType = value;
    showToast("Transaction type updated.");
    // Trigger Closing Documents auto-creation if type was just set
    if (value) {
      await ensureClosingDocumentsFolder(clientId, user.uid);
    }
  } catch (err) {
    console.error("Transaction type save error:", err);
    showToast("Failed to update transaction type.", "error");
  }
});
```

### Pattern 2: Folder Card Rendering
**What:** Generate folder card HTML from allFolders array, display above file list
**When to use:** After loadFolders completes and whenever folders change
**Example:**
```javascript
// Source: Follows existing renderFiles() pattern in client-detail.js
function renderFolderCards() {
  const container = document.getElementById("folder-cards");
  if (currentFolderId) {
    // Inside a folder -- show breadcrumb, hide folder cards
    container.innerHTML = "";
    renderBreadcrumb();
    return;
  }

  container.innerHTML = allFolders.map(f => {
    const count = allFiles.filter(file => file.folderId === f.id).length;
    const isSystem = f.isSystem;
    const systemClass = isSystem ? " gd-folder-card--system" : "";
    const icon = isSystem ? "&#128274;" : "&#128193;"; // lock vs folder
    const menuHtml = isSystem
      ? "" // No menu for system folders
      : `<button class="gd-folder-kebab" onclick="event.stopPropagation(); toggleFolderMenu('${f.id}')" title="Folder options">&#8942;</button>
         <div class="gd-folder-menu gd-hidden" id="folder-menu-${f.id}">
           <button onclick="renameFolder('${f.id}')">Rename</button>
           <button onclick="deleteFolder('${f.id}')">Delete</button>
         </div>`;
    return `
    <div class="gd-folder-card${systemClass}" data-folder-id="${f.id}"
         ondragover="event.preventDefault(); this.classList.add('gd-folder-card--dragover')"
         ondragleave="this.classList.remove('gd-folder-card--dragover')"
         ondrop="event.preventDefault(); this.classList.remove('gd-folder-card--dragover'); dropFileOnFolder(event, '${f.id}')"
         onclick="enterFolder('${f.id}')">
      <span class="gd-folder-card-icon">${icon}</span>
      <span class="gd-folder-card-name">${escapeHtml(f.name)}</span>
      <span class="gd-folder-card-count">${count}</span>
      ${menuHtml}
    </div>`;
  }).join("") + `
    <button class="gd-folder-card gd-folder-card--add" onclick="createNewFolder()">
      <span class="gd-folder-card-icon">+</span>
      <span class="gd-folder-card-name">New Folder</span>
    </button>`;
}
```

### Pattern 3: Batch Write for Folder Delete (Files to Root)
**What:** Atomically move all files to root and delete folder in one batch
**When to use:** When deleting a non-system folder
**Example:**
```javascript
// Source: Firebase docs — https://firebase.google.com/docs/firestore/manage-data/transactions
import { writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

async function deleteFolderWithFiles(folderId) {
  const batch = writeBatch(db);
  // Move all files in this folder to root
  const filesInFolder = allFiles.filter(f => f.folderId === folderId);
  filesInFolder.forEach(f => {
    batch.update(doc(db, "files", f.id), { folderId: null });
  });
  // Delete the folder document
  batch.delete(doc(db, "folders", folderId));
  await batch.commit();
}
```

### Pattern 4: HTML5 Drag and Drop on File Rows
**What:** Make file rows draggable, folder cards as drop targets
**When to use:** Secondary interaction for moving files to folders
**Example:**
```javascript
// Source: MDN — https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// On file row: add draggable="true" and ondragstart
// In renderFiles():
`<div class="gd-file-row" draggable="true"
     ondragstart="event.dataTransfer.setData('text/plain', '${f.id}')"
     onclick="openPreview('${f.id}')">
  ...
</div>`

// On folder card drop handler:
window.dropFileOnFolder = async function(event, folderId) {
  const fileId = event.dataTransfer.getData("text/plain");
  if (!fileId) return;
  await moveFileToFolder(fileId, folderId);
};
```

### Pattern 5: Migration (One-Time per Client)
**What:** Convert existing string `folder` field values to real folder document references
**When to use:** First time a client's file tab loads after the folder system is deployed
**Example:**
```javascript
async function migrateExistingFolders(uid) {
  // Check if migration already happened (any folder docs exist for this client)
  if (allFolders.length > 0) return;

  // Get unique folder string values from existing files
  const folderNames = new Set(allFiles.map(f => f.folder).filter(Boolean));
  if (folderNames.size === 0) return;

  const nameMap = { contracts: "Contracts", disclosures: "Disclosures", other: "Other" };
  const batch = writeBatch(db);
  const folderIdMap = {}; // old string -> new doc ID

  for (const oldName of folderNames) {
    if (nameMap[oldName]) {
      const folderRef = doc(collection(db, "folders")); // auto-ID
      batch.set(folderRef, {
        name: nameMap[oldName],
        clientId,
        realtorId: uid,
        isSystem: false,
        createdAt: serverTimestamp()
      });
      folderIdMap[oldName] = folderRef.id;
    }
  }

  // Update files to point to new folder docs
  for (const f of allFiles) {
    if (f.folder && folderIdMap[f.folder]) {
      batch.update(doc(db, "files", f.id), { folderId: folderIdMap[f.folder] });
    }
  }

  await batch.commit();
  // Reload folders and files
  await Promise.all([loadFolders(uid), loadFiles(uid)]);
}
```

### Anti-Patterns to Avoid
- **Subcollection for folders:** Do NOT put folders under `clients/{id}/folders`. The existing `files` collection is top-level with `clientId` filter. Keep folders consistent with this pattern for simpler queries and security rules.
- **Nested folder support:** The user explicitly decided on flat (single-level) folders. Do NOT add parentId or depth fields. This is an out-of-scope v2 feature.
- **Separate page load for Closing Documents:** Do NOT create the system folder on every page load. Only create it when transactionType is first set (or changed from null to a value). Query once, create if missing.
- **Client-side folder name in file doc:** Do NOT denormalize folder name into the file document. Use `folderId` reference only. The folder name is always available from `allFolders` in memory.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop library | Custom drag manager with position tracking | HTML5 native `draggable`, `ondragstart`, `ondragover`, `ondrop` | Only need drop-on-card (no sorting, no reordering); native API is sufficient |
| Atomic multi-write | Sequential updateDoc + deleteDoc calls | `writeBatch` from Firebase SDK | Folder delete must atomically move files AND delete folder; partial failure = data corruption |
| Context menu positioning | Custom absolute position calculator | CSS `position: absolute` relative to parent with `overflow: visible` | Follow the existing popover pattern in the app (`.gd-ai-popover` pattern) |
| Folder count badge | Real-time listener on each folder | In-memory count from `allFiles.filter()` | Data is already loaded; no need for extra Firestore reads. Recount on file changes. |

**Key insight:** This project has zero external dependencies beyond Firebase SDK. Every UI component is hand-built with template literals and CSS. The folder system must follow this pattern -- no new libraries, no build step changes.

## Common Pitfalls

### Pitfall 1: writeBatch 500-Document Limit
**What goes wrong:** Firestore `writeBatch` is limited to 500 operations per batch. A folder with hundreds of files could exceed this during folder delete or migration.
**Why it happens:** The 500-op limit is a hard Firestore constraint.
**How to avoid:** For folder delete, check file count first. If > 400 files in a folder (leaving room for the folder delete op), split into multiple batches. In practice, a single client's folder is unlikely to have 500 files, but defend against it.
**Warning signs:** Batch commit fails with "maximum 500 writes" error.

### Pitfall 2: Race Condition on Closing Documents Creation
**What goes wrong:** Two browser tabs or a fast page reload could create duplicate "Closing Documents" system folders.
**Why it happens:** Both tabs query "does system folder exist?" simultaneously, both get empty result, both create.
**How to avoid:** After creating the system folder, always re-query to confirm only one exists. If duplicates found, delete extras. Alternatively, use a deterministic document ID like `${clientId}_closing_documents` to make creation idempotent.
**Warning signs:** Multiple "Closing Documents" folders appearing for a single client.

### Pitfall 3: Migration Runs Multiple Times
**What goes wrong:** The migration check `if (allFolders.length > 0) return` is fragile. If a client has no existing folder strings but folders from another source, migration skips. If folders array hasn't loaded yet, migration triggers incorrectly.
**Why it happens:** Race between loadFolders and loadFiles completing.
**How to avoid:** Run migration AFTER both loadFolders and loadFiles complete (use `Promise.all`). Check for the specific migrated flag or check if any files still have a string `folder` value without a `folderId`.
**Warning signs:** Files losing their folder association, or duplicate folders created.

### Pitfall 4: Click Event Propagation on Folder Cards
**What goes wrong:** Clicking the kebab menu or rename/delete buttons also triggers the folder card's `onclick` (entering the folder).
**Why it happens:** Event bubbling -- click on child button propagates to parent card.
**How to avoid:** Use `event.stopPropagation()` on all interactive child elements. The existing codebase already does this on file row buttons (see renderFiles line: `onclick="event.stopPropagation()"`).
**Warning signs:** Clicking "Rename" also navigates into the folder.

### Pitfall 5: Stale allFolders/allFiles After Mutations
**What goes wrong:** After creating/deleting a folder or moving a file, the in-memory arrays don't reflect the change, causing incorrect renders.
**Why it happens:** Firestore writes don't automatically update local state.
**How to avoid:** After every write operation, either (a) reload from Firestore with `loadFolders`/`loadFiles`, or (b) optimistically update the local array before re-rendering. The existing codebase uses pattern (a) -- `await loadFiles(user.uid)` after every mutation.
**Warning signs:** UI shows stale data until manual page refresh.

### Pitfall 6: Upload Folder Context Lost
**What goes wrong:** User is viewing files inside "Contracts" folder, uploads a file, but file goes to root because upload doesn't know the current folder context.
**Why it happens:** The existing `upload-folder` dropdown is being replaced; the new upload must read `currentFolderId`.
**How to avoid:** In the upload function, set `folderId: currentFolderId || null` instead of reading from the old dropdown. If `currentFolderId` is set, new upload goes to that folder. If at root, goes to root.
**Warning signs:** Files always uploading to root regardless of which folder is being viewed.

## Code Examples

Verified patterns from the existing codebase:

### Adding the Transaction Type Select to HTML
```html
<!-- Source: Existing pattern from client-detail.html lines 101-128 -->
<!-- Add inside the "Status & Source" section, as a third field in the gd-form-row -->
<div class="gd-form-group">
  <label for="ov-transactionType">Transaction Type</label>
  <select id="ov-transactionType" class="gd-input">
    <option value="">Select...</option>
    <option value="SFH - Buyer">SFH - Buyer</option>
    <option value="SFH - Seller">SFH - Seller</option>
    <option value="Condo - Buyer">Condo - Buyer</option>
    <option value="Condo - Seller">Condo - Seller</option>
    <option value="Multi-Family - Buyer">Multi-Family - Buyer</option>
    <option value="Multi-Family - Seller">Multi-Family - Seller</option>
    <option value="Land - Buyer">Land - Buyer</option>
    <option value="Land - Seller">Land - Seller</option>
  </select>
</div>
```

### Populating Transaction Type from Firestore
```javascript
// Source: Follows populateOverview() pattern at line 106 of client-detail.js
// Add to populateOverview(c) function:
document.getElementById("ov-transactionType").value = c.transactionType || "";
```

### Files Tab HTML Structure (Replacing Folder Filters)
```html
<!-- Source: Replaces existing folder-filters div at client-detail.html line 266-274 -->
<div id="folder-breadcrumb" class="gd-breadcrumb gd-hidden">
  <a href="#" onclick="exitFolder(); return false;" class="gd-breadcrumb-link">Files</a>
  <span class="gd-breadcrumb-sep">&rsaquo;</span>
  <span id="breadcrumb-folder-name" class="gd-breadcrumb-current"></span>
</div>

<div id="folder-cards" class="gd-folder-cards">
  <!-- Rendered by renderFolderCards() -->
</div>
```

### New Firestore Import Addition
```javascript
// Source: Existing import at client-detail.js line 3-7
// Add writeBatch to the existing import:
import {
  doc, getDoc, updateDoc, deleteDoc, addDoc, getDocs,
  collection, query, where, orderBy, serverTimestamp, Timestamp,
  getCountFromServer, limit, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
```

### Folder Card CSS (Matching Existing Card Patterns)
```css
/* Source: Follows .gd-card pattern from greendoor.css line 1016 */
/* and .gd-folder-btn pattern from line 1436 */
.gd-folder-cards {
  display: flex;
  gap: 0.75rem;
  margin-bottom: var(--space-md);
  flex-wrap: wrap;
}

.gd-folder-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  font-size: 0.85rem;
}

.gd-folder-card:hover {
  border-color: var(--gd-green-500);
}

.gd-folder-card--system {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.05);
}

.gd-folder-card--dragover {
  border-color: var(--gd-green-500);
  background: rgba(34, 197, 94, 0.1);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}
```

### Context Menu (Three-Dot Kebab) Pattern
```css
/* Source: No existing kebab menu in codebase; new pattern following .gd-ai-popover style */
.gd-folder-kebab {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 1.1rem;
  padding: 0.2rem;
  line-height: 1;
  margin-left: auto;
}

.gd-folder-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 50;
  min-width: 120px;
}

.gd-folder-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--color-text-primary);
}

.gd-folder-menu button:hover {
  background: var(--color-surface);
}
```

## State of the Art

| Old Approach (Current) | New Approach (Phase 1) | Impact |
|------------------------|------------------------|--------|
| Hard-coded folder string on file doc (`folder: "contracts"`) | Folder documents in `folders` collection + `folderId` reference on files | Enables user-created folders, system folders, folder count, proper CRUD |
| Static folder filter buttons in HTML | Dynamic folder cards rendered from Firestore data | Users can create/name their own folders |
| No transaction type field | `transactionType` field on client doc | Foundation for Phase 2 compliance docs (filtered by transaction type) |
| `upload-folder` dropdown (static options) | Upload context from `currentFolderId` | Files go to whichever folder the user is viewing |
| No context menus on files | Three-dot kebab menu with Move/Download/Delete | Consistent interaction pattern for both folders and files |

**Deprecated/outdated after Phase 1:**
- `currentFileFolder` string state variable -- replaced by `currentFolderId`
- `folder-filters` HTML element and click handler -- replaced by folder cards
- `upload-folder` dropdown element -- replaced by context-aware upload
- `folder` string field on file documents -- replaced by `folderId` (old field kept for backward compatibility but no longer read)

## Open Questions

1. **Firestore composite index for folders query**
   - What we know: Querying `folders` where `clientId == X AND realtorId == Y` requires a composite index. Firestore auto-creates single-field indexes but NOT composite ones.
   - What's unclear: Whether the Firebase project already has auto-indexing configured, or if indexes need to be manually created in the Firebase console.
   - Recommendation: The first time the query runs, Firestore will log a console error with a direct link to create the needed index. Click the link in the browser console. Include this as a step in the plan.

2. **Migration trigger mechanism**
   - What we know: Existing files have `folder: "contracts"` etc. as strings. Need to create folder docs and remap.
   - What's unclear: Whether to run migration automatically on page load, or require a manual trigger.
   - Recommendation: Run automatically on first load per client (check if any files have `folder` string but no `folderId`). Migration is idempotent -- if folders already exist, skip.

3. **Closing "outside" click handler for kebab menus**
   - What we know: Kebab menus need to close when clicking elsewhere on the page.
   - What's unclear: The existing codebase has no global click-away-to-close pattern.
   - Recommendation: Add a single document-level click listener that closes any open `.gd-folder-menu` or `.gd-file-menu`. This is a common vanilla JS pattern.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None -- no test infrastructure exists |
| Config file | none -- see Wave 0 |
| Quick run command | Manual browser testing |
| Full suite command | Manual browser testing |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TXTP-01 | Transaction type dropdown exists and has 8 options + blank | manual-only | Open client detail, verify dropdown in Overview tab | N/A |
| TXTP-02 | Selection saves to Firestore and persists on refresh | manual-only | Select value, refresh page, verify value persists | N/A |
| FLDR-01 | Create named folder | manual-only | Click "+ New Folder", enter name, verify card appears | N/A |
| FLDR-02 | Rename folder | manual-only | Click kebab > Rename, enter new name, verify card updates | N/A |
| FLDR-03 | Delete folder moves files to root | manual-only | Add files to folder, delete folder, verify files at root | N/A |
| FLDR-04 | Folder cards with name and count | manual-only | Create folders, add files, verify count badges | N/A |
| FLDR-05 | Click folder filters files, breadcrumb back | manual-only | Click folder card, verify filtered view, click breadcrumb | N/A |
| FLDR-06 | Move file via context menu and drag-and-drop | manual-only | Use three-dot menu "Move to folder", also test drag | N/A |
| FLDR-07 | Closing Documents auto-creates when type is set | manual-only | Set transaction type, verify system folder appears | N/A |

### Sampling Rate
- **Per task commit:** Manual browser test of changed functionality
- **Per wave merge:** Full manual walkthrough of all 9 requirements
- **Phase gate:** Full walkthrough checklist before `/gsd:verify-work`

### Wave 0 Gaps
No automated test infrastructure exists in this project. This is a vanilla JS app deployed directly to Firebase Hosting with no build system. Adding a test framework (Jest, Playwright, etc.) would require introducing a package.json, node_modules, and a build/test pipeline -- which is out of scope for this phase and contradicts the project's "no framework migration" constraint.

**Justification for manual-only testing:** All requirements are UI interactions (dropdown selection, folder card clicks, drag-and-drop, context menus). They require a live Firestore connection and browser DOM. The cost of setting up E2E testing infrastructure exceeds the value for this 3-plan phase.

## Sources

### Primary (HIGH confidence)
- Firebase Firestore transactions/batched writes documentation: https://firebase.google.com/docs/firestore/manage-data/transactions
- MDN HTML Drag and Drop API: https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
- Existing codebase files: `js/client-detail.js` (2345 lines), `app/client-detail.html`, `css/greendoor.css`
- CONTEXT.md user decisions (gathered 2026-03-04)

### Secondary (MEDIUM confidence)
- Firebase modular SDK writeBatch reference: https://modularfirebase.web.app/reference/firestore_.writebatch
- DigitalOcean vanilla JS drag-and-drop tutorial: https://www.digitalocean.com/community/tutorials/js-drag-and-drop-vanilla-js

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources or existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Firebase SDK 10.8.0 is already in use; all APIs verified against existing imports
- Architecture: HIGH -- folder collection pattern mirrors existing files collection; all code patterns derived from actual codebase
- Pitfalls: HIGH -- writeBatch limit is documented Firebase behavior; race conditions are standard distributed systems concerns
- Migration: MEDIUM -- migration logic is custom; needs careful testing to handle edge cases (files with no folder, files with unknown folder strings)

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no library upgrades expected)
