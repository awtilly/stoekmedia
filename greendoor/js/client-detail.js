import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, deleteDoc, addDoc, getDocs,
  collection, query, where, orderBy, serverTimestamp, Timestamp,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import {
  getCurrentUser, showToast, formatCurrency, formatDate, formatDateTime,
  timeAgo, formatFileSize, statusLabel
} from "./auth.js";

const params = new URLSearchParams(window.location.search);
const clientId = params.get("id");
let clientData = null;
let currentActivityType = "note";
let editingPropertyId = null;
let selectedRating = 0;
let allProperties = [];
let allFiles = [];
let selectedCompare = new Set();
let emailTemplates = [];
let realtorProfile = null;

if (!clientId) {
  window.location.href = "/greendoor/app/clients";
}

/* --- Cloud Functions --- */
const askAssistant = httpsCallable(functions, "askAssistant");
const sendEmailFn = httpsCallable(functions, "sendEmail");
const sendForSignatureFn = httpsCallable(functions, "sendForSignature");
const checkSignatureStatusFn = httpsCallable(functions, "checkSignatureStatus");

/* --- Auth gate --- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  realtorProfile = await getCurrentUser();
  await loadClient(user.uid);
  loadEmailTemplates(user.uid);
});

/* --- Load client --- */
async function loadClient(uid) {
  try {
    const snap = await getDoc(doc(db, "clients", clientId));
    if (!snap.exists() || snap.data().realtorId !== uid) {
      window.location.href = "/greendoor/app/clients";
      return;
    }
    clientData = { id: snap.id, ...snap.data() };

    document.getElementById("client-name").textContent = clientData.fullName;
    document.title = clientData.fullName + " — GreenDoor";

    const badge = document.getElementById("client-badge");
    badge.textContent = statusLabel(clientData.status);
    badge.className = `gd-badge gd-badge-${clientData.status || "lead"}`;

    const [actCount, fileCount] = await Promise.all([
      getCountFromServer(query(collection(db, "activities"), where("clientId", "==", clientId), where("realtorId", "==", uid))),
      getCountFromServer(query(collection(db, "files"), where("clientId", "==", clientId), where("realtorId", "==", uid)))
    ]);
    document.getElementById("qs-activities").textContent = actCount.data().count;
    document.getElementById("qs-files").textContent = fileCount.data().count;

    if (clientData.lastActivityDate) {
      const lastDate = clientData.lastActivityDate.toDate ? clientData.lastActivityDate.toDate() : new Date(clientData.lastActivityDate);
      const days = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      document.getElementById("qs-days").textContent = days;
    }

    populateOverview(clientData);
    await Promise.all([loadActivities(uid), loadFiles(uid), loadProperties(uid), loadEnvelopes(uid)]);

    document.getElementById("detail-loading").classList.add("gd-hidden");
    document.getElementById("detail-content").classList.remove("gd-hidden");
  } catch (e) {
    console.error("Load client error:", e);
    showToast("Failed to load client.", "error");
  }
}

/* --- Populate overview form --- */
function populateOverview(c) {
  document.getElementById("ov-fullName").value = c.fullName || "";
  document.getElementById("ov-email").value = c.email || "";
  document.getElementById("ov-phone").value = c.phone || "";
  document.getElementById("ov-status").value = c.status || "lead";
  document.getElementById("ov-source").value = c.source || "";
  document.getElementById("ov-timeline").value = c.timeline || "";
  document.getElementById("ov-budgetMin").value = c.budgetMin || "";
  document.getElementById("ov-budgetMax").value = c.budgetMax || "";
  document.getElementById("ov-preferredLocations").value = (c.preferredLocations || []).join(", ");
  document.getElementById("ov-bedsMin").value = c.bedsMin || "";
  document.getElementById("ov-bedsMax").value = c.bedsMax || "";
  document.getElementById("ov-bathsMin").value = c.bathsMin || "";
  document.getElementById("ov-bathsMax").value = c.bathsMax || "";
  document.getElementById("ov-sqftMin").value = c.sqftMin || "";
  document.getElementById("ov-sqftMax").value = c.sqftMax || "";
  document.getElementById("ov-mustHaveFeatures").value = (c.mustHaveFeatures || []).join(", ");
  document.getElementById("ov-preApprovalStatus").value = c.preApprovalStatus || "";
  document.getElementById("ov-preApprovalAmount").value = c.preApprovalAmount || "";
  document.getElementById("ov-notes").value = c.notes || "";

  const types = c.propertyTypes || [];
  document.querySelectorAll("#ov-propertyTypes input").forEach(cb => {
    cb.checked = types.includes(cb.value);
  });
}

/* --- Save overview --- */
window.saveOverview = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const selectedTypes = [];
  document.querySelectorAll("#ov-propertyTypes input:checked").forEach(cb => selectedTypes.push(cb.value));

  const locStr = document.getElementById("ov-preferredLocations").value;
  const locations = locStr ? locStr.split(",").map(s => s.trim()).filter(Boolean) : [];

  const featStr = document.getElementById("ov-mustHaveFeatures").value;
  const features = featStr ? featStr.split(",").map(s => s.trim()).filter(Boolean) : [];

  const data = {
    fullName: document.getElementById("ov-fullName").value.trim(),
    email: document.getElementById("ov-email").value.trim(),
    phone: document.getElementById("ov-phone").value.trim(),
    status: document.getElementById("ov-status").value,
    source: document.getElementById("ov-source").value,
    timeline: document.getElementById("ov-timeline").value,
    budgetMin: Number(document.getElementById("ov-budgetMin").value) || null,
    budgetMax: Number(document.getElementById("ov-budgetMax").value) || null,
    preferredLocations: locations,
    propertyTypes: selectedTypes,
    bedsMin: Number(document.getElementById("ov-bedsMin").value) || null,
    bedsMax: Number(document.getElementById("ov-bedsMax").value) || null,
    bathsMin: Number(document.getElementById("ov-bathsMin").value) || null,
    bathsMax: Number(document.getElementById("ov-bathsMax").value) || null,
    sqftMin: Number(document.getElementById("ov-sqftMin").value) || null,
    sqftMax: Number(document.getElementById("ov-sqftMax").value) || null,
    mustHaveFeatures: features,
    preApprovalStatus: document.getElementById("ov-preApprovalStatus").value,
    preApprovalAmount: Number(document.getElementById("ov-preApprovalAmount").value) || null,
    notes: document.getElementById("ov-notes").value.trim()
  };

  try {
    await updateDoc(doc(db, "clients", clientId), data);
    clientData = { ...clientData, ...data };
    document.getElementById("client-name").textContent = data.fullName;
    const badge = document.getElementById("client-badge");
    badge.textContent = statusLabel(data.status);
    badge.className = `gd-badge gd-badge-${data.status}`;
    showToast("Client updated!");
  } catch (e) {
    console.error("Save error:", e);
    showToast("Failed to save changes.", "error");
  }
};

/* --- Delete client --- */
window.deleteClient = async function () {
  if (!confirm("Are you sure? This will delete the client and all their activities, files, and properties.")) return;

  const user = auth.currentUser;
  if (!user) return;

  try {
    const collections = ["activities", "files", "bookmarkedProperties"];
    for (const col of collections) {
      const q = query(collection(db, col), where("clientId", "==", clientId), where("realtorId", "==", user.uid));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await deleteDoc(doc(db, col, d.id));
      }
    }
    await deleteDoc(doc(db, "clients", clientId));
    showToast("Client deleted.");
    window.location.href = "/greendoor/app/clients";
  } catch (e) {
    console.error("Delete error:", e);
    showToast("Failed to delete client.", "error");
  }
};

/* ===== TABS ===== */
document.querySelectorAll(".gd-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".gd-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".gd-tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});

/* ===== ACTIVITY TAB ===== */
async function loadActivities(uid) {
  try {
    const q = query(
      collection(db, "activities"),
      where("clientId", "==", clientId),
      where("realtorId", "==", uid),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    const el = document.getElementById("activity-timeline");

    if (snap.empty) return;

    const icons = { email: "&#128231;", call: "&#128222;", note: "&#128221;", sms: "&#128172;", file_share: "&#128193;", showing: "&#127968;" };

    let html = "";
    snap.forEach(d => {
      const a = d.data();
      const body = a.body || "";
      const truncated = body.length > 200;
      html += `
        <div class="gd-timeline-item">
          <div class="gd-timeline-dot ${a.type}">${icons[a.type] || ""}</div>
          <div class="gd-timeline-date">${formatDateTime(a.timestamp)}</div>
          <div class="gd-timeline-subject">${a.subject || ""}</div>
          ${body ? `<div class="gd-timeline-body ${truncated ? "truncated" : ""}" onclick="this.classList.toggle('truncated')">${body}</div>` : ""}
        </div>`;
    });
    el.innerHTML = html;
  } catch (e) {
    console.error("Load activities error:", e);
  }
}

window.openActivityModal = function (type) {
  currentActivityType = type;
  const titles = { note: "Add Note", call: "Log Call", email: "Send Email" };
  document.getElementById("activity-modal-title").textContent = titles[type] || "Add Activity";
  document.getElementById("act-subject").value = "";
  document.getElementById("act-body").value = "";
  document.getElementById("act-duration").value = "";

  document.getElementById("activity-email-to").classList.toggle("gd-hidden", type !== "email");
  document.getElementById("activity-template-group").classList.toggle("gd-hidden", type !== "email");
  document.getElementById("activity-duration-group").classList.toggle("gd-hidden", type !== "call");
  document.getElementById("email-save-template").classList.toggle("gd-hidden", type !== "email");

  const saveBtn = document.getElementById("act-save-btn");
  saveBtn.textContent = type === "email" ? "Send Email" : "Save";
  saveBtn.disabled = false;

  if (type === "email" && clientData) {
    document.getElementById("act-to").value = clientData.email || "";
  }

  document.getElementById("act-body-label").textContent = type === "call" ? "Summary" : "Body";
  document.getElementById("act-template").value = "";
  document.getElementById("activity-modal").classList.add("active");
};

window.closeActivityModal = function () {
  document.getElementById("activity-modal").classList.remove("active");
};

window.saveActivity = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const subject = document.getElementById("act-subject").value.trim();
  if (!subject) { showToast("Subject is required.", "error"); return; }

  // If email type, send via SendGrid
  if (currentActivityType === "email") {
    const to = document.getElementById("act-to").value.trim();
    if (!to) { showToast("Recipient email is required.", "error"); return; }

    const body = document.getElementById("act-body").value.trim();
    const saveBtn = document.getElementById("act-save-btn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Sending...";

    try {
      await sendEmailFn({
        to,
        toName: clientData.fullName || "",
        subject,
        body: body.replace(/\n/g, "<br>"),
        clientId
      });
      showToast("Email sent successfully!");
      closeActivityModal();
      await loadActivities(user.uid);
      const c = await getCountFromServer(query(collection(db, "activities"), where("clientId", "==", clientId), where("realtorId", "==", user.uid)));
      document.getElementById("qs-activities").textContent = c.data().count;
      document.getElementById("qs-days").textContent = "0";
    } catch (err) {
      console.error("Send email error:", err);
      showToast(err.message || "Failed to send email.", "error");
      saveBtn.disabled = false;
      saveBtn.textContent = "Send Email";
    }
    return;
  }

  // Non-email activity: save locally
  let body = document.getElementById("act-body").value.trim();
  if (currentActivityType === "call") {
    const dur = document.getElementById("act-duration").value.trim();
    if (dur) body = `Duration: ${dur}\n${body}`;
  }

  try {
    await addDoc(collection(db, "activities"), {
      clientId,
      realtorId: user.uid,
      type: currentActivityType,
      subject,
      body,
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "clients", clientId), { lastActivityDate: serverTimestamp() });
    showToast("Activity saved!");
    closeActivityModal();
    await loadActivities(user.uid);
    const c = await getCountFromServer(query(collection(db, "activities"), where("clientId", "==", clientId), where("realtorId", "==", user.uid)));
    document.getElementById("qs-activities").textContent = c.data().count;
    document.getElementById("qs-days").textContent = "0";
  } catch (e) {
    console.error("Save activity error:", e);
    showToast("Failed to save activity.", "error");
  }
};

/* ===== EMAIL TEMPLATES ===== */
async function loadEmailTemplates(uid) {
  try {
    const systemQ = query(collection(db, "emailTemplates"), where("createdBy", "==", "system"));
    const userQ = query(collection(db, "emailTemplates"), where("createdBy", "==", uid));
    const [systemSnap, userSnap] = await Promise.all([getDocs(systemQ), getDocs(userQ)]);

    emailTemplates = [];
    systemSnap.forEach(d => emailTemplates.push({ id: d.id, ...d.data() }));
    userSnap.forEach(d => emailTemplates.push({ id: d.id, ...d.data() }));

    const select = document.getElementById("act-template");
    select.innerHTML = '<option value="">— No template —</option>';
    emailTemplates.forEach((t, i) => {
      const label = t.createdBy === "system" ? t.name : t.name + " (Custom)";
      select.innerHTML += `<option value="${i}">${label}</option>`;
    });
  } catch (e) {
    console.error("Load templates error:", e);
  }
}

function replaceMergeTags(text) {
  if (!text) return text;
  return text
    .replace(/\{\{clientName\}\}/g, clientData?.fullName || "")
    .replace(/\{\{realtorName\}\}/g, realtorProfile?.fullName || "")
    .replace(/\{\{realtorPhone\}\}/g, realtorProfile?.phone || "")
    .replace(/\{\{realtorEmail\}\}/g, realtorProfile?.email || "")
    .replace(/\{\{realtorCompany\}\}/g, realtorProfile?.company || "");
}

window.applyTemplate = function () {
  const idx = document.getElementById("act-template").value;
  if (idx === "") return;
  const t = emailTemplates[parseInt(idx)];
  if (!t) return;
  document.getElementById("act-subject").value = replaceMergeTags(t.subject);
  // Strip HTML tags for textarea display
  const bodyText = replaceMergeTags(t.body).replace(/<[^>]+>/g, "").replace(/&mdash;/g, "—").replace(/&amp;/g, "&");
  document.getElementById("act-body").value = bodyText;
};

window.saveAsTemplate = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const subject = document.getElementById("act-subject").value.trim();
  const body = document.getElementById("act-body").value.trim();
  if (!subject) { showToast("Enter a subject first.", "error"); return; }

  const name = prompt("Template name:");
  if (!name) return;

  try {
    await addDoc(collection(db, "emailTemplates"), {
      name,
      subject,
      body: body.replace(/\n/g, "<br>"),
      category: "general",
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
    showToast("Template saved!");
    await loadEmailTemplates(user.uid);
  } catch (e) {
    console.error("Save template error:", e);
    showToast("Failed to save template.", "error");
  }
};

/* ===== FILES TAB ===== */
let currentFileFolder = "all";

document.getElementById("folder-filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".gd-folder-btn");
  if (!btn) return;
  document.querySelectorAll(".gd-folder-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentFileFolder = btn.dataset.folder;
  renderFiles();
});

document.getElementById("file-input").addEventListener("change", (e) => {
  const name = e.target.files[0]?.name || "";
  document.getElementById("file-name-display").textContent = name;
});

async function loadFiles(uid) {
  try {
    const q = query(
      collection(db, "files"),
      where("clientId", "==", clientId),
      where("realtorId", "==", uid),
      orderBy("uploadedAt", "desc")
    );
    const snap = await getDocs(q);
    allFiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFiles();
  } catch (e) {
    console.error("Load files error:", e);
  }
}

function renderFiles() {
  const el = document.getElementById("files-list");
  let filtered = allFiles;
  if (currentFileFolder !== "all") {
    filtered = filtered.filter(f => f.folder === currentFileFolder);
  }

  if (filtered.length === 0) {
    el.innerHTML = `<div class="gd-empty"><div class="gd-empty-icon">&#128193;</div><div class="gd-empty-text">No files${currentFileFolder !== "all" ? " in this folder" : ""}</div></div>`;
    return;
  }

  el.innerHTML = filtered.map(f => {
    const signedBadge = f.fileName.startsWith("SIGNED_") ? ' <span class="gd-badge-signed">&#9997; Signed</span>' : '';
    return `
    <div class="gd-file-row">
      <span class="gd-file-name">${f.fileName}${signedBadge}</span>
      <span class="gd-badge gd-badge-${f.folder}">${f.folder}</span>
      <span class="gd-file-meta">${formatFileSize(f.fileSize)}</span>
      <span class="gd-file-meta">${formatDate(f.uploadedAt)}</span>
      <a href="${f.downloadUrl}" target="_blank" class="gd-file-download">Download</a>
    </div>`;
  }).join("");
}

window.uploadFile = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const fileInput = document.getElementById("file-input");
  const file = fileInput.files[0];
  if (!file) { showToast("Select a file first.", "error"); return; }

  const folder = document.getElementById("upload-folder").value;
  const storagePath = `files/${user.uid}/${clientId}/${folder}/${file.name}`;
  const storageRef = ref(storage, storagePath);

  const progressBar = document.getElementById("upload-progress");
  const progressFill = document.getElementById("upload-progress-fill");
  progressBar.classList.add("active");
  progressFill.style.width = "0%";

  const task = uploadBytesResumable(storageRef, file);

  task.on("state_changed",
    (snap) => {
      const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
      progressFill.style.width = pct + "%";
    },
    (err) => {
      console.error("Upload error:", err);
      showToast("Upload failed.", "error");
      progressBar.classList.remove("active");
    },
    async () => {
      try {
        const downloadUrl = await getDownloadURL(storageRef);
        await addDoc(collection(db, "files"), {
          clientId,
          realtorId: user.uid,
          fileName: file.name,
          storagePath,
          downloadUrl,
          folder,
          fileSize: file.size,
          mimeType: file.type,
          uploadedAt: serverTimestamp()
        });
        await addDoc(collection(db, "activities"), {
          clientId,
          realtorId: user.uid,
          type: "file_share",
          subject: `Uploaded ${file.name} to ${folder}`,
          body: "",
          timestamp: serverTimestamp()
        });
        await updateDoc(doc(db, "clients", clientId), { lastActivityDate: serverTimestamp() });
        showToast("File uploaded!");
        fileInput.value = "";
        document.getElementById("file-name-display").textContent = "";
        progressBar.classList.remove("active");
        await loadFiles(user.uid);
        const c = await getCountFromServer(query(collection(db, "files"), where("clientId", "==", clientId), where("realtorId", "==", user.uid)));
        document.getElementById("qs-files").textContent = c.data().count;
      } catch (e) {
        console.error("File doc error:", e);
        showToast("Upload succeeded but failed to save record.", "error");
        progressBar.classList.remove("active");
      }
    }
  );
};

/* ===== BOLDSIGN E-SIGNATURES ===== */
let sigMode = "existing";

window.openSignatureModal = function () {
  // Populate file dropdown with contracts + other files
  const select = document.getElementById("sig-file-select");
  select.innerHTML = '<option value="">— Choose a file —</option>';
  allFiles.filter(f => f.folder === "contracts" || f.folder === "other" || f.folder === "disclosures").forEach(f => {
    select.innerHTML += `<option value="${f.downloadUrl}" data-name="${f.fileName}">${f.fileName} (${f.folder})</option>`;
  });

  // Pre-fill signer info from client data
  document.getElementById("sig-signer-name").value = clientData?.fullName || "";
  document.getElementById("sig-signer-email").value = clientData?.email || "";
  document.getElementById("sig-progress").classList.add("gd-hidden");
  document.getElementById("sig-send-btn").disabled = false;
  document.getElementById("sig-file-input").value = "";
  document.getElementById("sig-file-name").textContent = "";

  setSigMode("existing");
  document.getElementById("signature-modal").classList.add("active");
};

window.closeSignatureModal = function () {
  document.getElementById("signature-modal").classList.remove("active");
};

window.setSigMode = function (mode) {
  sigMode = mode;
  document.querySelectorAll(".gd-sig-toggle-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  document.getElementById("sig-existing-group").classList.toggle("gd-hidden", mode !== "existing");
  document.getElementById("sig-upload-group").classList.toggle("gd-hidden", mode !== "upload");
};

document.getElementById("sig-file-input").addEventListener("change", (e) => {
  document.getElementById("sig-file-name").textContent = e.target.files[0]?.name || "";
});

window.submitSignature = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const signerName = document.getElementById("sig-signer-name").value.trim();
  const signerEmail = document.getElementById("sig-signer-email").value.trim();

  if (!signerName || !signerEmail) {
    showToast("Signer name and email are required.", "error");
    return;
  }

  let fileUrl, fileName;

  if (sigMode === "existing") {
    const select = document.getElementById("sig-file-select");
    fileUrl = select.value;
    fileName = select.selectedOptions[0]?.dataset?.name;
    if (!fileUrl) { showToast("Select a file.", "error"); return; }
  } else {
    const fileInput = document.getElementById("sig-file-input");
    const file = fileInput.files[0];
    if (!file) { showToast("Choose a file to upload.", "error"); return; }

    // Upload the file first
    const progressEl = document.getElementById("sig-progress");
    const progressText = document.getElementById("sig-progress-text");
    progressEl.classList.remove("gd-hidden");
    progressText.textContent = "Uploading document...";
    document.getElementById("sig-send-btn").disabled = true;

    const storagePath = `files/${user.uid}/${clientId}/contracts/${file.name}`;
    const storageRef = ref(storage, storagePath);

    try {
      const snapshot = await uploadBytesResumable(storageRef, file);
      fileUrl = await getDownloadURL(storageRef);
      fileName = file.name;

      // Create file record
      await addDoc(collection(db, "files"), {
        clientId,
        realtorId: user.uid,
        fileName: file.name,
        storagePath,
        downloadUrl: fileUrl,
        folder: "contracts",
        fileSize: file.size,
        mimeType: file.type,
        uploadedAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Upload error:", e);
      showToast("File upload failed.", "error");
      progressEl.classList.add("gd-hidden");
      document.getElementById("sig-send-btn").disabled = false;
      return;
    }
  }

  // Send to BoldSign
  const progressEl = document.getElementById("sig-progress");
  const progressText = document.getElementById("sig-progress-text");
  progressEl.classList.remove("gd-hidden");
  progressText.textContent = "Sending to BoldSign...";
  document.getElementById("sig-send-btn").disabled = true;

  try {
    await sendForSignatureFn({ clientId, fileUrl, fileName, signerEmail, signerName });
    showToast("Document sent for signature!");
    closeSignatureModal();
    await Promise.all([loadFiles(user.uid), loadEnvelopes(user.uid)]);
  } catch (err) {
    console.error("Signature error:", err);
    showToast(err.message || "Failed to send for signature.", "error");
    progressEl.classList.add("gd-hidden");
    document.getElementById("sig-send-btn").disabled = false;
  }
};

/* --- Pending Signatures / Envelopes --- */
async function loadEnvelopes(uid) {
  try {
    const q = query(
      collection(db, "envelopes"),
      where("clientId", "==", clientId),
      where("realtorId", "==", uid)
    );
    const snap = await getDocs(q);
    const pending = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.status !== "completed");

    const section = document.getElementById("pending-signatures");
    const list = document.getElementById("pending-signatures-list");

    if (pending.length === 0) {
      section.classList.add("gd-hidden");
      return;
    }

    section.classList.remove("gd-hidden");

    const statusColors = {
      sent: "#3b82f6", viewed: "#8b5cf6", signed: "#22c55e",
      completed: "#22c55e", declined: "#ef4444", expired: "#6b7280", revoked: "#6b7280"
    };

    list.innerHTML = pending.map(e => `
      <div class="gd-envelope-row">
        <span class="gd-envelope-name">${e.fileName}</span>
        <span class="gd-envelope-signer">${e.signerName}</span>
        <span class="gd-badge-esig" style="background: ${statusColors[e.status] || "#6b7280"}">${statusLabel(e.status)}</span>
        <span class="gd-file-meta">${formatDate(e.sentAt)}</span>
        <button class="gd-btn gd-btn-sm" onclick="checkEnvelopeStatus('${e.documentId}')">Check Status</button>
      </div>
    `).join("");
  } catch (e) {
    console.error("Load envelopes error:", e);
  }
}

window.checkEnvelopeStatus = async function (documentId) {
  try {
    showToast("Checking status...");
    const result = await checkSignatureStatusFn({ documentId });
    showToast("Status: " + statusLabel(result.data.status));
    const user = auth.currentUser;
    if (user) {
      await Promise.all([loadEnvelopes(user.uid), loadFiles(user.uid)]);
    }
  } catch (err) {
    console.error("Check status error:", err);
    showToast(err.message || "Failed to check status.", "error");
  }
};

/* ===== PROPERTIES TAB ===== */
async function loadProperties(uid) {
  try {
    const q = query(
      collection(db, "bookmarkedProperties"),
      where("clientId", "==", clientId),
      where("realtorId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    allProperties = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProperties();
  } catch (e) {
    console.error("Load properties error:", e);
  }
}

function renderProperties() {
  const el = document.getElementById("properties-grid");
  selectedCompare.clear();
  updateCompareBar();

  if (allProperties.length === 0) {
    el.innerHTML = `<div class="gd-empty" style="grid-column:1/-1;"><div class="gd-empty-icon">&#127968;</div><div class="gd-empty-text">No properties bookmarked yet</div></div>`;
    return;
  }

  el.innerHTML = allProperties.map(p => {
    const stars = renderStars(p.clientRating || 0);
    return `
      <div class="gd-property-card" data-id="${p.id}" onclick="editProperty('${p.id}')">
        <input type="checkbox" class="gd-property-check" data-id="${p.id}" onclick="event.stopPropagation(); toggleCompare('${p.id}')">
        <div class="gd-property-address">${p.address || "—"}</div>
        <div class="gd-property-price">${p.listingPrice ? formatCurrency(p.listingPrice) : "—"}</div>
        <div class="gd-property-meta">
          <span class="gd-badge gd-badge-${p.status || "interested"}">${statusLabel(p.status || "interested")}</span>
          <span class="gd-stars">${stars}</span>
        </div>
        ${p.showingDate ? `<div class="gd-property-showing">Showing: ${formatDate(p.showingDate)}</div>` : ""}
        ${p.listingUrl ? `<a href="${p.listingUrl}" target="_blank" class="gd-property-link" onclick="event.stopPropagation()">View Listing &rarr;</a>` : ""}
      </div>`;
  }).join("");
}

function renderStars(rating) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += `<span class="gd-star ${i <= rating ? "filled" : ""}">&#9733;</span>`;
  }
  return html;
}

/* --- Star rating in modal --- */
document.getElementById("prop-stars").addEventListener("click", (e) => {
  const star = e.target.closest(".gd-star");
  if (!star) return;
  selectedRating = parseInt(star.dataset.rating);
  document.querySelectorAll("#prop-stars .gd-star").forEach(s => {
    s.classList.toggle("filled", parseInt(s.dataset.rating) <= selectedRating);
  });
});

window.openPropertyModal = function (propId) {
  editingPropertyId = propId || null;
  document.getElementById("property-modal-title").textContent = propId ? "Edit Property" : "Add Property";

  if (propId) {
    const p = allProperties.find(x => x.id === propId);
    if (p) {
      document.getElementById("prop-address").value = p.address || "";
      document.getElementById("prop-mlsNumber").value = p.mlsNumber || "";
      document.getElementById("prop-listingPrice").value = p.listingPrice || "";
      document.getElementById("prop-status").value = p.status || "interested";
      document.getElementById("prop-clientFeedback").value = p.clientFeedback || "";
      document.getElementById("prop-realtorNotes").value = p.realtorNotes || "";
      document.getElementById("prop-listingUrl").value = p.listingUrl || "";
      selectedRating = p.clientRating || 0;

      if (p.showingDate) {
        const d = p.showingDate.toDate ? p.showingDate.toDate() : new Date(p.showingDate);
        const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById("prop-showingDate").value = iso;
      } else {
        document.getElementById("prop-showingDate").value = "";
      }
    }
  } else {
    document.getElementById("prop-address").value = "";
    document.getElementById("prop-mlsNumber").value = "";
    document.getElementById("prop-listingPrice").value = "";
    document.getElementById("prop-status").value = "interested";
    document.getElementById("prop-showingDate").value = "";
    document.getElementById("prop-clientFeedback").value = "";
    document.getElementById("prop-realtorNotes").value = "";
    document.getElementById("prop-listingUrl").value = "";
    selectedRating = 0;
  }

  document.querySelectorAll("#prop-stars .gd-star").forEach(s => {
    s.classList.toggle("filled", parseInt(s.dataset.rating) <= selectedRating);
  });

  document.getElementById("property-modal").classList.add("active");
};

window.editProperty = function (id) {
  openPropertyModal(id);
};

window.closePropertyModal = function () {
  document.getElementById("property-modal").classList.remove("active");
};

window.saveProperty = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const address = document.getElementById("prop-address").value.trim();
  if (!address) { showToast("Address is required.", "error"); return; }

  const showingVal = document.getElementById("prop-showingDate").value;
  const data = {
    clientId,
    realtorId: user.uid,
    address,
    mlsNumber: document.getElementById("prop-mlsNumber").value.trim(),
    listingPrice: Number(document.getElementById("prop-listingPrice").value) || null,
    status: document.getElementById("prop-status").value,
    showingDate: showingVal ? Timestamp.fromDate(new Date(showingVal)) : null,
    clientRating: selectedRating,
    clientFeedback: document.getElementById("prop-clientFeedback").value.trim(),
    realtorNotes: document.getElementById("prop-realtorNotes").value.trim(),
    listingUrl: document.getElementById("prop-listingUrl").value.trim(),
    photos: []
  };

  try {
    if (editingPropertyId) {
      await updateDoc(doc(db, "bookmarkedProperties", editingPropertyId), data);
      showToast("Property updated!");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "bookmarkedProperties"), data);
      showToast("Property added!");
    }
    closePropertyModal();
    await loadProperties(user.uid);
  } catch (e) {
    console.error("Save property error:", e);
    showToast("Failed to save property.", "error");
  }
};

/* --- Compare --- */
window.toggleCompare = function (id) {
  if (selectedCompare.has(id)) {
    selectedCompare.delete(id);
  } else {
    if (selectedCompare.size >= 4) { showToast("Max 4 properties to compare.", "error"); return; }
    selectedCompare.add(id);
  }
  updateCompareBar();
};

function updateCompareBar() {
  const bar = document.getElementById("compare-bar");
  const count = selectedCompare.size;
  if (count >= 2) {
    bar.classList.add("active");
    document.getElementById("compare-count").textContent = count + " selected";
  } else {
    bar.classList.remove("active");
  }
}

window.showComparison = function () {
  const props = allProperties.filter(p => selectedCompare.has(p.id));
  const table = document.getElementById("compare-table");

  let headerRow = "<tr><th></th>" + props.map(p => `<th>${p.address || "—"}</th>`).join("") + "</tr>";
  const rows = [
    { label: "Price", render: p => formatCurrency(p.listingPrice) },
    { label: "Status", render: p => statusLabel(p.status) },
    { label: "Rating", render: p => renderStars(p.clientRating || 0) },
    { label: "Showing Date", render: p => p.showingDate ? formatDate(p.showingDate) : "—" },
    { label: "Client Feedback", render: p => p.clientFeedback || "—" }
  ];

  let bodyHtml = rows.map(r =>
    `<tr><td style="font-weight:500; color: var(--color-text-primary);">${r.label}</td>` +
    props.map(p => `<td>${r.render(p)}</td>`).join("") + "</tr>"
  ).join("");

  table.innerHTML = headerRow + bodyHtml;
  document.getElementById("compare-modal").classList.add("active");
};

window.closeCompareModal = function () {
  document.getElementById("compare-modal").classList.remove("active");
};

/* ===== AI CHAT PANEL ===== */
let aiChatHistory = [];

function formatAiResponse(text) {
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br>");
  html = html.replace(/((?:<li>.*<\/li><br>?)+)/g, "<ul>$1</ul>");
  html = html.replace(/<ul><br>/g, "<ul>").replace(/<br><\/ul>/g, "</ul>");
  html = html.replace(/<br><li>/g, "<li>");
  return html;
}

function addAiMessage(text, type) {
  const el = document.getElementById("ai-messages");
  const div = document.createElement("div");
  if (type === "user") {
    div.className = "gd-ai-msg gd-ai-msg-user";
    div.textContent = text;
  } else if (type === "error") {
    div.className = "gd-ai-msg gd-ai-msg-error";
    div.textContent = text;
  } else {
    div.className = "gd-ai-msg gd-ai-msg-ai";
    div.innerHTML = formatAiResponse(text);

    // If the response looks like an email draft, add "Open in Email" button
    if (text.toLowerCase().includes("subject:") || text.toLowerCase().includes("dear ") || text.toLowerCase().includes("hi " + (clientData?.fullName?.split(" ")[0] || "").toLowerCase())) {
      const btn = document.createElement("button");
      btn.className = "gd-btn gd-btn-sm gd-btn-ai-email";
      btn.textContent = "Open in Email";
      btn.onclick = () => openAiDraftInEmail(text);
      div.appendChild(btn);
    }
  }
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function openAiDraftInEmail(aiText) {
  // Try to extract subject line
  let subject = "";
  let body = aiText;
  const subjectMatch = aiText.match(/(?:\*\*)?Subject:?\s*(?:\*\*)?\s*(.+?)(?:\n|$)/i);
  if (subjectMatch) {
    subject = subjectMatch[1].replace(/\*\*/g, "").trim();
    body = aiText.replace(subjectMatch[0], "").trim();
  }

  // Clean up markdown formatting for the textarea
  body = body
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .trim();

  openActivityModal("email");
  document.getElementById("act-subject").value = subject;
  document.getElementById("act-body").value = body;
}

function showTypingIndicator() {
  const el = document.getElementById("ai-messages");
  const div = document.createElement("div");
  div.className = "gd-ai-typing";
  div.id = "ai-typing";
  div.innerHTML = '<div class="gd-ai-typing-dot"></div><div class="gd-ai-typing-dot"></div><div class="gd-ai-typing-dot"></div>';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function removeTypingIndicator() {
  const t = document.getElementById("ai-typing");
  if (t) t.remove();
}

window.toggleAiPanel = function () {
  document.getElementById("ai-panel").classList.toggle("open");
};

window.sendQuickAction = function (text) {
  document.getElementById("ai-input").value = text;
  sendAiMessage();
};

window.sendAiMessage = async function () {
  const input = document.getElementById("ai-input");
  const btn = document.getElementById("ai-send-btn");
  const question = input.value.trim();
  if (!question) return;

  addAiMessage(question, "user");
  input.value = "";
  btn.disabled = true;
  showTypingIndicator();

  try {
    const result = await askAssistant({ question, clientId, context: "client_detail" });
    removeTypingIndicator();
    addAiMessage(result.data.response, "ai");
  } catch (err) {
    removeTypingIndicator();
    const msg = err.message || "Something went wrong. Please try again.";
    addAiMessage(msg, "error");
  }
  btn.disabled = false;
};
