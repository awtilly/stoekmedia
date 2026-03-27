/* ============================================================
   GreenDoor CRM — Onboarding Flow (Redesigned)
   3 steps: Profile → Import Clients → Ready
   ============================================================ */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, setDoc, addDoc, getDocs, collection, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast, escapeHtml } from "./auth.js";

let currentStep = 1;
const TOTAL_STEPS = 3;
let importData = null; // parsed CSV data

/* ===== Helpers ===== */
function formatPhone(value) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function generateSignature() {
  const name = document.getElementById("onboard-name").value.trim();
  const company = document.getElementById("onboard-company").value.trim();
  const phone = document.getElementById("onboard-phone").value.trim();
  return `Best regards,\n${name}${company ? "\n" + company : ""}\n${phone}`;
}

function parseCSV(text) {
  const lines = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.length > 0 || lines.length > 0) { lines.push(current); current = ""; }
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
      if (ch === '"') { if (q && line[i + 1] === '"') { cell += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { cells.push(cell.trim()); cell = ""; }
      else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  });
}

const HEADER_MAP = {
  "name": "fullName", "full name": "fullName", "fullname": "fullName",
  "first name": "_firstName", "firstname": "_firstName",
  "last name": "_lastName", "lastname": "_lastName",
  "email": "email", "email address": "email", "e-mail": "email",
  "phone": "phone", "phone number": "phone", "mobile": "phone", "cell": "phone",
  "status": "status", "client status": "status",
  "notes": "notes", "note": "notes", "comments": "notes",
  "source": "source", "lead source": "source",
};

const STATUS_MAP = {
  "lead": "lead", "new": "lead", "prospect": "lead",
  "buyer": "active_buyer", "active buyer": "active_buyer",
  "seller": "active_seller", "active seller": "active_seller",
  "under contract": "under_contract", "pending": "under_contract",
  "closed": "closed", "sold": "closed",
  "inactive": "inactive", "archived": "inactive",
};

/* ===== Step Navigation ===== */
window.goToStep = function (step) {
  if (step < 1 || step > TOTAL_STEPS || step === currentStep) return;

  // Validate step 1 before leaving
  if (currentStep === 1 && step > 1) {
    const name = document.getElementById("onboard-name").value.trim();
    const phone = document.getElementById("onboard-phone").value.trim();
    if (!name) { showToast("Please enter your name.", "error"); return; }
    if (!phone) { showToast("Please enter your phone number.", "error"); return; }
    // Auto-save profile on step 1 exit
    saveProfileProgress();
  }

  const oldEl = document.getElementById(`step-${currentStep}`);
  const newEl = document.getElementById(`step-${step}`);
  oldEl.classList.remove("active");

  setTimeout(() => {
    newEl.classList.add("active");
    currentStep = step;

    // Update progress bar
    const pct = Math.round((step / TOTAL_STEPS) * 100);
    document.getElementById("progress-fill").style.width = `${pct}%`;
    document.getElementById("step-label").textContent = `Step ${step} of ${TOTAL_STEPS}`;

    // Step hooks
    if (step === 3) onEnterStep3();
  }, 200);
};

/* ===== Auto-save profile (step 1 data) ===== */
async function saveProfileProgress() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, "users", user.uid), {
      fullName: document.getElementById("onboard-name").value.trim(),
      phone: document.getElementById("onboard-phone").value.trim(),
      company: document.getElementById("onboard-company").value.trim(),
      emailSignature: document.getElementById("onboard-signature").value.trim()
    }, { merge: true });
  } catch (e) { /* silent save */ }
}

/* ===== Step 3: Personalize ===== */
function onEnterStep3() {
  const name = document.getElementById("onboard-name").value.trim();
  const firstName = name ? name.split(/\s+/)[0] : "";
  const title = document.getElementById("step3-title");
  title.textContent = firstName ? `You're ready, ${firstName}!` : "You're Ready!";

  // Hide notif section if not supported
  if (!("Notification" in window)) {
    const ns = document.getElementById("notif-section");
    if (ns) ns.style.display = "none";
  }
}

/* ===== CSV Import (embedded in onboarding) ===== */
function initImportDropzone() {
  const dropzone = document.getElementById("import-dropzone");
  const fileInput = document.getElementById("import-file-input");
  if (!dropzone || !fileInput) return;

  dropzone.onclick = () => fileInput.click();
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("dragover"); };
  dropzone.ondragleave = () => dropzone.classList.remove("dragover");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
  };
  fileInput.onchange = () => { if (fileInput.files[0]) handleImportFile(fileInput.files[0]); };
}

function handleImportFile(file) {
  if (!file.name.match(/\.(csv|txt)$/i)) { showToast("Please upload a CSV file.", "error"); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const parsed = parseCSV(e.target.result);
    if (parsed.length < 2) { showToast("CSV is empty.", "error"); return; }

    const headers = parsed[0];
    const rows = parsed.slice(1).filter(r => r.some(c => c.trim()));

    // Auto-map headers
    const mapping = {};
    headers.forEach((h, i) => {
      const key = HEADER_MAP[h.toLowerCase().trim()];
      if (key) mapping[i] = key;
    });

    // Build client objects
    const clients = rows.map(row => {
      const client = {};
      let firstName = "", lastName = "";
      Object.entries(mapping).forEach(([col, field]) => {
        const val = (row[parseInt(col)] || "").trim();
        if (!val) return;
        if (field === "_firstName") { firstName = val; return; }
        if (field === "_lastName") { lastName = val; return; }
        if (field === "status") { client[field] = STATUS_MAP[val.toLowerCase()] || "lead"; return; }
        client[field] = val;
      });
      if (!client.fullName && (firstName || lastName)) client.fullName = `${firstName} ${lastName}`.trim();
      return client;
    }).filter(c => c.fullName && c.email);

    importData = clients;

    // Show result
    const dropzone = document.getElementById("import-dropzone");
    dropzone.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <p class="gd-onboard-import-text" style="color:#16a34a;">${escapeHtml(file.name)}</p>
      <p class="gd-onboard-import-sub">${clients.length} contacts ready to import &middot; ${rows.length - clients.length} skipped (missing name/email)</p>`;

    document.getElementById("import-btn").classList.remove("gd-hidden");

    const resultEl = document.getElementById("import-result");
    resultEl.classList.remove("gd-hidden");
    resultEl.querySelector("#import-result-content").innerHTML = clients.slice(0, 5).map(c =>
      `<div class="gd-onboard-import-row">${escapeHtml(c.fullName)} <span class="gd-text-muted-xs">${escapeHtml(c.email)}</span></div>`
    ).join("") + (clients.length > 5 ? `<div class="gd-text-muted-xs">+ ${clients.length - 5} more</div>` : "");
  };
  reader.readAsText(file);
}

window.runOnboardingImport = async function () {
  if (!importData || !importData.length) return;
  const user = auth.currentUser;
  if (!user) return;

  const btn = document.getElementById("import-btn");
  btn.disabled = true;
  btn.textContent = "Importing...";

  const progressEl = document.getElementById("import-progress");
  const fillEl = document.getElementById("onboard-import-fill");
  const textEl = document.getElementById("onboard-import-text");
  progressEl.classList.remove("gd-hidden");

  let imported = 0;
  const total = importData.length;

  for (let i = 0; i < importData.length; i += 10) {
    const chunk = importData.slice(i, i + 10);
    await Promise.all(chunk.map(async (client) => {
      const data = {
        realtorId: user.uid,
        fullName: client.fullName || "",
        email: client.email || "",
        phone: client.phone || "",
        status: client.status || "lead",
        source: client.source || "CSV Import",
        notes: client.notes || "",
        budgetMin: null, budgetMax: null,
        timeline: "", preferredLocations: [], propertyTypes: [],
        bedsMin: null, bedsMax: null, bathsMin: null, bathsMax: null,
        sqftMin: null, sqftMax: null, mustHaveFeatures: [],
        preApprovalStatus: "", preApprovalAmount: null,
        customFields: {},
        lastActivityDate: serverTimestamp(),
        createdAt: serverTimestamp()
      };
      const ref = await addDoc(collection(db, "clients"), data);
      await addDoc(collection(db, "activities"), {
        clientId: ref.id, realtorId: user.uid,
        type: "note", subject: "Client imported from CSV",
        body: "", timestamp: serverTimestamp()
      });
    }));
    imported += chunk.length;
    const pct = Math.round((imported / total) * 100);
    fillEl.style.width = `${pct}%`;
    textEl.textContent = `Imported ${imported} of ${total}...`;
  }

  textEl.textContent = `Done! ${imported} clients imported.`;
  fillEl.style.width = "100%";
  btn.textContent = "Imported!";
  btn.classList.add("gd-hidden");

  showToast(`${imported} clients imported!`);
  importData = null;

  // Auto-advance to step 3 after short delay
  setTimeout(() => goToStep(3), 1500);
};

/* ===== Finish Onboarding ===== */
window.finishOnboarding = async function () {
  const termsCheckbox = document.getElementById("terms-checkbox");
  if (!termsCheckbox.checked) { showToast("Please accept the Terms & Conditions.", "error"); return; }

  const fullName = document.getElementById("onboard-name").value.trim();
  const phone = document.getElementById("onboard-phone").value.trim();
  if (!fullName || !phone) { showToast("Name and phone are required.", "error"); goToStep(1); return; }

  const btn = document.getElementById("onboard-finish-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  const user = auth.currentUser;
  if (!user) return;

  // Request notification permission if toggled
  const notifToggle = document.getElementById("notif-toggle");
  if (notifToggle?.checked && "Notification" in window) {
    try { await Notification.requestPermission(); } catch (e) { /* skip */ }
  }

  try {
    await setDoc(doc(db, "users", user.uid), {
      fullName,
      phone,
      company: document.getElementById("onboard-company").value.trim(),
      emailSignature: document.getElementById("onboard-signature").value.trim(),
      onboardingComplete: true,
      showTour: true,
      onboardingCompletedAt: serverTimestamp(),
      termsAcceptedAt: serverTimestamp()
    }, { merge: true });

    window.location.href = "/greendoor/app/dashboard";
  } catch (err) {
    console.error("Onboarding save error:", err);
    showToast("Failed to save. Please try again.", "error");
    btn.disabled = false;
    btn.textContent = "Go to Dashboard";
  }
};

/* ===== Pre-fill from invite data ===== */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const profile = await getCurrentUser();
  if (!profile) return;

  if (profile.fullName) document.getElementById("onboard-name").value = profile.fullName;
  if (profile.company) document.getElementById("onboard-company").value = profile.company;
  if (profile.phone) document.getElementById("onboard-phone").value = formatPhone(profile.phone);

  // Auto-generate signature from pre-filled data
  const sigEl = document.getElementById("onboard-signature");
  if (!sigEl.value.trim()) sigEl.value = generateSignature();

  // Init dropzone
  initImportDropzone();
});

/* ===== Event Listeners ===== */
document.getElementById("onboard-name").addEventListener("input", () => {
  const sigEl = document.getElementById("onboard-signature");
  // Only auto-update signature if it matches the default pattern
  const current = sigEl.value;
  if (!current || current.startsWith("Best regards,")) sigEl.value = generateSignature();
});

document.getElementById("onboard-phone").addEventListener("input", (e) => {
  const input = e.target;
  const pos = input.selectionStart;
  const prevLen = input.value.length;
  input.value = formatPhone(input.value);
  const diff = input.value.length - prevLen;
  input.setSelectionRange(pos + diff, pos + diff);

  const sigEl = document.getElementById("onboard-signature");
  if (!sigEl.value || sigEl.value.startsWith("Best regards,")) sigEl.value = generateSignature();
});

document.getElementById("onboard-company").addEventListener("input", () => {
  const sigEl = document.getElementById("onboard-signature");
  if (!sigEl.value || sigEl.value.startsWith("Best regards,")) sigEl.value = generateSignature();
});

document.getElementById("sig-reset-btn").addEventListener("click", () => {
  document.getElementById("onboard-signature").value = generateSignature();
});
