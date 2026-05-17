/* ============================================================
   GreenDoor CRM — CSV Client Import
   Upload, map columns, preview, and batch import clients
   ============================================================ */

import { auth, db } from "./firebase-config.js";
import {
  collection, query, where, getDocs, addDoc, serverTimestamp, writeBatch, doc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast, escapeHtml } from "./auth.js";

/* --- GreenDoor field definitions --- */
const GD_FIELDS = [
  { key: "fullName", label: "Full Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone" },
  { key: "status", label: "Status" },
  { key: "budgetMin", label: "Budget Min", type: "number" },
  { key: "budgetMax", label: "Budget Max", type: "number" },
  { key: "timeline", label: "Timeline" },
  { key: "source", label: "Source" },
  { key: "notes", label: "Notes" },
  { key: "preferredLocations", label: "Preferred Locations", type: "list" },
];

/* --- Header auto-mapping --- */
const HEADER_MAP = {
  "name": "fullName", "full name": "fullName", "fullname": "fullName",
  "first name": "_firstName", "firstname": "_firstName", "first": "_firstName",
  "last name": "_lastName", "lastname": "_lastName", "last": "_lastName",
  "email": "email", "email address": "email", "e-mail": "email",
  "phone": "phone", "phone number": "phone", "mobile": "phone", "cell": "phone", "cell phone": "phone",
  "status": "status", "client status": "status", "type": "status", "client type": "status",
  "budget": "budgetMax", "budget min": "budgetMin", "budget max": "budgetMax",
  "min budget": "budgetMin", "max budget": "budgetMax", "price range": "budgetMax",
  "timeline": "timeline", "timeframe": "timeline",
  "source": "source", "lead source": "source", "referral source": "source",
  "notes": "notes", "note": "notes", "comments": "notes", "comment": "notes",
  "location": "preferredLocations", "preferred location": "preferredLocations",
  "city": "preferredLocations", "area": "preferredLocations",
};

/* --- Status normalization --- */
const STATUS_MAP = {
  "lead": "lead", "new": "lead", "prospect": "lead", "new lead": "lead",
  "buyer": "active_buyer", "active buyer": "active_buyer", "buying": "active_buyer",
  "seller": "active_seller", "active seller": "active_seller", "selling": "active_seller",
  "under contract": "under_contract", "pending": "under_contract", "contract": "under_contract",
  "closed": "closed", "sold": "closed", "completed": "closed",
  "inactive": "inactive", "archived": "inactive", "lost": "inactive",
};

let csvData = { headers: [], rows: [], mapping: {} };
let existingEmails = new Set();

/* --- CSV Parser (handles quoted fields, commas in values) --- */
function parseCSV(text) {
  const lines = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.length > 0 || lines.length > 0) {
        lines.push(current);
        current = "";
      }
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      current += ch;
    }
  }
  if (current.length > 0) lines.push(current);

  return lines.map(line => {
    const cells = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cell += '"'; i++; }
        else q = !q;
      } else if (ch === "," && !q) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    return cells;
  });
}

/* --- Auto-detect column mapping --- */
function autoMapHeaders(headers) {
  const mapping = {};
  headers.forEach((h, i) => {
    const normalized = h.toLowerCase().trim();
    if (HEADER_MAP[normalized]) {
      mapping[i] = HEADER_MAP[normalized];
    }
  });
  return mapping;
}

/* --- Load existing emails for duplicate detection --- */
async function loadExistingEmails(uid) {
  const q = query(collection(db, "clients"), where("realtorId", "==", uid));
  const snap = await getDocs(q);
  existingEmails = new Set();
  snap.forEach(d => {
    const email = (d.data().email || "").toLowerCase().trim();
    if (email) existingEmails.add(email);
  });
}

/* --- Step rendering --- */
function renderStep1() {
  return `
    <div class="gd-csv-step" id="csv-step-1">
      <div class="gd-csv-dropzone" id="csv-dropzone">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p class="gd-csv-dropzone-text">Drop a CSV file here, or click to browse</p>
        <p class="gd-csv-dropzone-sub">Accepts .csv files — exported from any CRM, spreadsheet, or contact list</p>
        <input type="file" id="csv-file-input" accept=".csv,.txt" style="display:none;">
      </div>
    </div>`;
}

function renderStep2() {
  const { headers, rows, mapping } = csvData;
  const preview = rows.slice(0, 2);

  const fieldOptions = GD_FIELDS.map(f =>
    `<option value="${f.key}">${f.label}${f.required ? " *" : ""}</option>`
  ).join("");

  const cols = headers.map((h, i) => {
    const mapped = mapping[i] || "";
    const sampleVals = preview.map(r => escapeHtml(r[i] || "—")).join("<br>");
    return `
      <div class="gd-csv-col-map">
        <div class="gd-csv-col-header">${escapeHtml(h)}</div>
        <div class="gd-csv-col-sample">${sampleVals}</div>
        <select class="gd-input gd-csv-field-select" data-col="${i}">
          <option value="">— Skip —</option>
          <option value="_firstName" ${mapped === "_firstName" ? "selected" : ""}>First Name</option>
          <option value="_lastName" ${mapped === "_lastName" ? "selected" : ""}>Last Name</option>
          ${fieldOptions.replace(`value="${mapped}"`, `value="${mapped}" selected`)}
        </select>
      </div>`;
  }).join("");

  return `
    <div class="gd-csv-step" id="csv-step-2">
      <p class="gd-text-muted-sm">Map your CSV columns to GreenDoor fields. We auto-detected what we could.</p>
      <div class="gd-csv-col-grid">${cols}</div>
      <p class="gd-text-muted-xs gd-mt-sm">${rows.length} rows found &middot; Showing first 2 as preview</p>
    </div>`;
}

function renderStep3() {
  const { rows, mapping } = csvData;
  const mapped = buildMappedRows();
  const dupes = mapped.filter(r => r._duplicate);
  const valid = mapped.filter(r => !r._skip);
  const skipped = mapped.filter(r => r._skip && !r._duplicate);

  const previewRows = valid.slice(0, 8).map(r => `
    <tr>
      <td>${escapeHtml(r.fullName || "—")}</td>
      <td>${escapeHtml(r.email || "—")}</td>
      <td>${escapeHtml(r.phone || "—")}</td>
      <td>${r.status ? `<span class="gd-badge-${r.status}">${r.status.replace("_", " ")}</span>` : "—"}</td>
    </tr>`).join("");

  return `
    <div class="gd-csv-step" id="csv-step-3">
      <div class="gd-csv-summary-cards">
        <div class="gd-csv-summary-card">
          <div class="gd-csv-summary-num" style="color:#16a34a;">${valid.length}</div>
          <div class="gd-csv-summary-label">Ready to import</div>
        </div>
        <div class="gd-csv-summary-card">
          <div class="gd-csv-summary-num" style="color:#f59e0b;">${dupes.length}</div>
          <div class="gd-csv-summary-label">Duplicates (skipped)</div>
        </div>
        <div class="gd-csv-summary-card">
          <div class="gd-csv-summary-num" style="color:#94a3b8;">${skipped.length}</div>
          <div class="gd-csv-summary-label">Missing name/email</div>
        </div>
      </div>
      ${valid.length > 0 ? `
      <div class="gd-table-wrap gd-mt-md" style="max-height:260px;overflow-y:auto;">
        <table class="gd-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
          <tbody>${previewRows}</tbody>
        </table>
      </div>
      ${valid.length > 8 ? `<p class="gd-text-muted-xs gd-mt-sm">Showing 8 of ${valid.length} clients</p>` : ""}
      ` : `<p class="gd-text-muted-sm gd-mt-md gd-text-center">No valid rows to import. Check your column mapping.</p>`}
    </div>`;
}

function renderStep4() {
  return `
    <div class="gd-csv-step" id="csv-step-4">
      <div class="gd-csv-progress-area">
        <div class="gd-csv-progress-bar"><div id="csv-progress-fill" class="gd-csv-progress-fill"></div></div>
        <p id="csv-progress-text" class="gd-text-muted-sm gd-text-center">Importing clients...</p>
      </div>
    </div>`;
}

/* --- Build mapped rows from CSV data --- */
function buildMappedRows() {
  const { rows, mapping } = csvData;
  const seenEmails = new Set();
  return rows.map(row => {
    const client = { _skip: false, _duplicate: false };
    let firstName = "", lastName = "";

    Object.entries(mapping).forEach(([colIdx, fieldKey]) => {
      const val = (row[parseInt(colIdx)] || "").trim();
      if (!val) return;
      if (fieldKey === "_firstName") { firstName = val; return; }
      if (fieldKey === "_lastName") { lastName = val; return; }

      const fieldDef = GD_FIELDS.find(f => f.key === fieldKey);
      if (fieldDef?.type === "number") {
        const num = parseFloat(val.replace(/[$,]/g, ""));
        if (!isNaN(num)) client[fieldKey] = num;
      } else if (fieldDef?.type === "list") {
        client[fieldKey] = val.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      } else if (fieldKey === "status") {
        client[fieldKey] = STATUS_MAP[(val.toLowerCase())] || "lead";
      } else {
        client[fieldKey] = val;
      }
    });

    // Combine first + last name if no fullName mapped
    if (!client.fullName && (firstName || lastName)) {
      client.fullName = `${firstName} ${lastName}`.trim();
    }

    // Validate required fields
    if (!client.fullName || !client.email) {
      client._skip = true;
    }

    // Duplicate check — against existing clients in Firestore AND against earlier rows in this CSV
    if (client.email) {
      const normalized = client.email.toLowerCase().trim();
      if (existingEmails.has(normalized) || seenEmails.has(normalized)) {
        client._skip = true;
        client._duplicate = true;
      } else {
        seenEmails.add(normalized);
      }
    }

    return client;
  });
}

/* --- Batch import to Firestore --- */
async function runImport() {
  const user = auth.currentUser;
  if (!user) return;

  const mapped = buildMappedRows().filter(r => !r._skip);
  const total = mapped.length;
  const fillEl = document.getElementById("csv-progress-fill");
  const textEl = document.getElementById("csv-progress-text");
  let imported = 0;

  // Process in batches of 10
  for (let i = 0; i < mapped.length; i += 10) {
    const chunk = mapped.slice(i, i + 10);
    const promises = chunk.map(async (client) => {
      const data = {
        realtorId: user.uid,
        fullName: client.fullName || "",
        email: client.email || "",
        phone: client.phone || "",
        status: client.status || "lead",
        budgetMin: client.budgetMin || null,
        budgetMax: client.budgetMax || null,
        timeline: client.timeline || "",
        source: client.source || "CSV Import",
        notes: client.notes || "",
        preferredLocations: client.preferredLocations || [],
        propertyTypes: [],
        bedsMin: null, bedsMax: null,
        bathsMin: null, bathsMax: null,
        sqftMin: null, sqftMax: null,
        mustHaveFeatures: [],
        preApprovalStatus: "",
        preApprovalAmount: null,
        lastActivityDate: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, "clients"), data);

      // Log activity
      await addDoc(collection(db, "activities"), {
        clientId: docRef.id,
        realtorId: user.uid,
        type: "note",
        subject: "Client imported from CSV",
        body: "",
        timestamp: serverTimestamp(),
      });
    });

    await Promise.all(promises);
    imported += chunk.length;

    const pct = Math.round((imported / total) * 100);
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (textEl) textEl.textContent = `Imported ${imported} of ${total} clients...`;
  }

  if (textEl) textEl.textContent = `Done! ${imported} clients imported.`;
  if (fillEl) fillEl.style.width = "100%";
}

/* --- Modal controller --- */
let currentStep = 1;

function openImportModal() {
  csvData = { headers: [], rows: [], mapping: {} };
  currentStep = 1;
  const modal = document.getElementById("csv-import-modal");
  if (modal) {
    modal.querySelector(".gd-modal-body").innerHTML = renderStep1();
    updateModalFooter();
    modal.classList.add("active");
    initDropzone();
  }
}

function closeImportModal() {
  const modal = document.getElementById("csv-import-modal");
  if (modal) modal.classList.remove("active");
}

function updateModalFooter() {
  const backBtn = document.getElementById("csv-back-btn");
  const nextBtn = document.getElementById("csv-next-btn");
  if (!backBtn || !nextBtn) return;

  backBtn.style.display = currentStep > 1 && currentStep < 4 ? "" : "none";

  if (currentStep === 1) {
    nextBtn.textContent = "Next";
    nextBtn.disabled = csvData.rows.length === 0;
  } else if (currentStep === 2) {
    nextBtn.textContent = "Preview";
    nextBtn.disabled = false;
  } else if (currentStep === 3) {
    const valid = buildMappedRows().filter(r => !r._skip);
    nextBtn.textContent = `Import ${valid.length} Clients`;
    nextBtn.disabled = valid.length === 0;
  } else {
    nextBtn.style.display = "none";
    backBtn.style.display = "none";
  }
}

async function nextStep() {
  const body = document.querySelector("#csv-import-modal .gd-modal-body");
  if (!body) return;

  if (currentStep === 2) {
    // Save mapping from selects
    document.querySelectorAll(".gd-csv-field-select").forEach(sel => {
      const col = sel.dataset.col;
      if (sel.value) csvData.mapping[col] = sel.value;
      else delete csvData.mapping[col];
    });
  }

  currentStep++;

  if (currentStep === 3) {
    // Load existing emails for dupe detection
    const user = auth.currentUser;
    if (user) await loadExistingEmails(user.uid);
    body.innerHTML = renderStep3();
  } else if (currentStep === 4) {
    body.innerHTML = renderStep4();
    updateModalFooter();
    try {
      await runImport();
      showToast("Clients imported successfully!", "success");
      setTimeout(() => {
        closeImportModal();
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error("Import error:", err);
      showToast("Import failed: " + err.message, "error");
    }
    return;
  } else {
    body.innerHTML = currentStep === 2 ? renderStep2() : renderStep1();
  }

  updateModalFooter();
}

function prevStep() {
  if (currentStep <= 1) return;
  currentStep--;
  const body = document.querySelector("#csv-import-modal .gd-modal-body");
  if (!body) return;
  body.innerHTML = currentStep === 1 ? renderStep1() : renderStep2();
  updateModalFooter();
  if (currentStep === 1) initDropzone();
}

/* --- Dropzone file handling --- */
function initDropzone() {
  const dropzone = document.getElementById("csv-dropzone");
  const fileInput = document.getElementById("csv-file-input");
  if (!dropzone || !fileInput) return;

  dropzone.onclick = () => fileInput.click();

  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("dragover"); };
  dropzone.ondragleave = () => dropzone.classList.remove("dragover");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  fileInput.onchange = () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  };
}

function handleFile(file) {
  if (!file.name.match(/\.(csv|txt)$/i)) {
    showToast("Please upload a CSV file", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const parsed = parseCSV(e.target.result);
    if (parsed.length < 2) {
      showToast("CSV file is empty or has no data rows", "error");
      return;
    }

    csvData.headers = parsed[0];
    csvData.rows = parsed.slice(1).filter(r => r.some(cell => cell.trim()));
    csvData.mapping = autoMapHeaders(csvData.headers);

    // Update dropzone to show file info
    const dropzone = document.getElementById("csv-dropzone");
    if (dropzone) {
      dropzone.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p class="gd-csv-dropzone-text" style="color:#16a34a;">${escapeHtml(file.name)}</p>
        <p class="gd-csv-dropzone-sub">${csvData.rows.length} rows &middot; ${csvData.headers.length} columns</p>`;
    }

    updateModalFooter();
  };
  reader.readAsText(file);
}

/* --- Expose to window --- */
window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.csvNextStep = nextStep;
window.csvPrevStep = prevStep;
