import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, deleteDoc, addDoc, getDocs,
  collection, query, where, orderBy, serverTimestamp, Timestamp,
  getCountFromServer, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import {
  getCurrentUser, showToast, formatCurrency, formatDate, formatDateTime,
  timeAgo, formatFileSize, statusLabel, escapeHtml, sanitizeUrl
} from "./auth.js";
import { calculateMatchScore, matchScoreColor, matchScoreLabel } from "./match-engine.js";

const params = new URLSearchParams(window.location.search);
const clientId = params.get("id");
let clientData = null;
let currentActivityType = "note";
let editingMatchId = null;
let selectedRating = 0;
let allMatches = []; // clientListingMatches joined with listing data
let allListingsCache = []; // all listings for match-a-listing panel
let allFiles = [];
let allShowings = [];
let allFollowUps = [];
let selectedCompare = new Set();
let selectedFiles = new Set();
let emailTemplates = [];
let realtorProfile = null;
let editingShowingId = null;
let completingShowingId = null;
let completeRating = 0;
let sigFiles = [];
let sigSigners = [];
let embedUnsubscribe = null;
let embedPollInterval = null;
let allTemplateFiles = [];
let copyClientsList = [];
let selectedCopyClientId = null;
let addListingFeatureTags = [];

if (!clientId) {
  window.location.href = "/greendoor/app/clients";
}

/* --- Cloud Functions --- */
const sendEmailFn = httpsCallable(functions, "sendEmail");
const sendForSignatureFn = httpsCallable(functions, "sendForSignature");
const checkSignatureStatusFn = httpsCallable(functions, "checkSignatureStatus");
const createEmbeddedSignatureRequestFn = httpsCallable(functions, "createEmbeddedSignatureRequest");
const shareDocumentFn = httpsCallable(functions, "shareDocument");
const parseListingUrlFn = httpsCallable(functions, "parseListingUrl");

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
    await Promise.all([loadActivities(uid), loadFiles(uid), loadTemplateFiles(uid), loadMatches(uid), loadEnvelopes(uid), loadShowings(uid), loadFollowUps(uid)]);

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
  document.getElementById("ov-dealBreakers").value = (c.dealBreakers || []).join(", ");
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

  const dbStr = document.getElementById("ov-dealBreakers").value;
  const dealBreakers = dbStr ? dbStr.split(",").map(s => s.trim()).filter(Boolean) : [];

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
    dealBreakers,
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
    const collections = ["activities", "files", "bookmarkedProperties", "clientListingMatches", "showings", "followUps"];
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

    const icons = { email: "&#128231;", call: "&#128222;", note: "&#128221;", sms: "&#128172;", file_share: "&#128193;", showing: "&#127968;", followup: "&#128276;" };

    let html = "";
    snap.forEach(d => {
      const a = d.data();
      const body = a.body || "";
      const truncated = body.length > 200;
      html += `
        <div class="gd-timeline-item">
          <div class="gd-timeline-dot ${a.type}">${icons[a.type] || ""}</div>
          <div class="gd-timeline-date">${formatDateTime(a.timestamp)}</div>
          <div class="gd-timeline-subject">${escapeHtml(a.subject)}</div>
          ${body ? `<div class="gd-timeline-body ${truncated ? "truncated" : ""}" onclick="this.classList.toggle('truncated')">${escapeHtml(body)}</div>` : ""}
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
  if (e.target.files[0]) {
    uploadFile();
  }
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

async function loadTemplateFiles(uid) {
  try {
    const q = query(
      collection(db, "templateFiles"),
      where("realtorId", "==", uid),
      orderBy("uploadedAt", "desc")
    );
    const snap = await getDocs(q);
    allTemplateFiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("Load template files error:", e);
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
    const checked = selectedFiles.has(f.id) ? "checked" : "";
    return `
    <div class="gd-file-row" onclick="openPreview('${f.id}')">
      <input type="checkbox" class="gd-file-check" data-id="${f.id}" ${checked} onclick="event.stopPropagation(); toggleFileSelect('${f.id}')">
      <span class="gd-file-preview-icon">&#128065;</span>
      <span class="gd-file-name">${escapeHtml(f.fileName)}${signedBadge}</span>
      <span class="gd-badge gd-badge-${f.folder}">${f.folder}</span>
      <span class="gd-file-meta">${formatFileSize(f.fileSize)}</span>
      <span class="gd-file-meta">${formatDate(f.uploadedAt)}</span>
      <button class="gd-btn gd-btn-sm gd-file-send-btn" onclick="event.stopPropagation(); sendSingleFile('${f.id}')">Send</button>
      <a href="${f.downloadUrl}" target="_blank" class="gd-file-download" onclick="event.stopPropagation()">Download</a>
      <button class="gd-btn gd-btn-sm gd-btn-danger" onclick="event.stopPropagation(); deleteFile('${f.id}')" title="Delete file">&times;</button>
    </div>`;
  }).join("");
}

window.deleteFile = async function (fileId) {
  if (!confirm("Delete this file? This cannot be undone.")) return;
  const user = auth.currentUser;
  if (!user) return;

  const fileData = allFiles.find(f => f.id === fileId);
  if (!fileData) return;

  try {
    // Delete from Storage if we have the path
    if (fileData.storagePath) {
      try {
        await deleteObject(ref(storage, fileData.storagePath));
      } catch (e) {
        // File may already be gone from storage — continue with Firestore cleanup
        console.warn("Storage delete:", e.message);
      }
    }
    // Delete Firestore record
    await deleteDoc(doc(db, "files", fileId));
    showToast("File deleted.");
    await loadFiles(user.uid);
  } catch (err) {
    console.error("Delete file error:", err);
    showToast("Failed to delete file.", "error");
  }
};

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
        progressBar.classList.remove("active");
        await loadFiles(user.uid);
        try {
          const c = await getCountFromServer(query(collection(db, "files"), where("clientId", "==", clientId), where("realtorId", "==", user.uid)));
          document.getElementById("qs-files").textContent = c.data().count;
        } catch (countErr) {
          console.warn("File count update failed:", countErr);
        }
      } catch (e) {
        console.error("File record error:", e);
        showToast("Upload succeeded but failed to save record.", "error");
        progressBar.classList.remove("active");
      }
    }
  );
};

/* ===== FILE SELECTION & SHARING ===== */

window.toggleFileSelect = function (fileId) {
  if (selectedFiles.has(fileId)) {
    selectedFiles.delete(fileId);
  } else {
    selectedFiles.add(fileId);
  }
  updateFileActionBar();
};

function updateFileActionBar() {
  const bar = document.getElementById("file-action-bar");
  const count = selectedFiles.size;
  if (count > 0) {
    bar.classList.add("active");
    document.getElementById("file-action-count").textContent = count + " selected";
  } else {
    bar.classList.remove("active");
  }
}

window.clearFileSelection = function () {
  selectedFiles.clear();
  updateFileActionBar();
  renderFiles();
};

window.sendSingleFile = function (fileId) {
  selectedFiles.clear();
  selectedFiles.add(fileId);
  updateFileActionBar();
  renderFiles();
  openSendDocModal();
};

window.openSendDocModal = function () {
  const files = allFiles.filter(f => selectedFiles.has(f.id));
  if (files.length === 0) { showToast("Select files first.", "error"); return; }

  document.getElementById("send-doc-to").value = clientData?.email || "";
  document.getElementById("send-doc-cc").value = "";
  document.getElementById("send-doc-subject").value = `Documents from ${realtorProfile?.fullName || "your realtor"}`;
  document.getElementById("send-doc-message").value = `Hi ${clientData?.fullName || ""},\n\nPlease find the attached documents for your review.`;

  const filesEl = document.getElementById("send-doc-files");
  filesEl.innerHTML = files.map(f => `<div class="gd-sig-file-row"><span class="gd-sig-file-name">${escapeHtml(f.fileName)}</span></div>`).join("");

  document.getElementById("send-doc-progress").classList.add("gd-hidden");
  document.getElementById("send-doc-btn").disabled = false;
  document.getElementById("send-doc-modal").classList.add("active");
};

window.closeSendDocModal = function () {
  document.getElementById("send-doc-modal").classList.remove("active");
};

window.submitSendDoc = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const to = document.getElementById("send-doc-to").value.trim();
  const cc = document.getElementById("send-doc-cc").value.trim();
  const subject = document.getElementById("send-doc-subject").value.trim();
  const message = document.getElementById("send-doc-message").value.trim();

  if (!to || !subject) { showToast("To and Subject are required.", "error"); return; }

  const files = allFiles.filter(f => selectedFiles.has(f.id)).map(f => ({
    fileName: f.fileName,
    downloadUrl: f.downloadUrl
  }));

  document.getElementById("send-doc-progress").classList.remove("gd-hidden");
  document.getElementById("send-doc-btn").disabled = true;

  try {
    await shareDocumentFn({ clientId, files, to, cc, subject, message });
    showToast("Documents sent!");
    closeSendDocModal();
    clearFileSelection();
    await loadActivities(user.uid);
  } catch (err) {
    console.error("Share error:", err);
    showToast(err.message || "Failed to send documents.", "error");
    document.getElementById("send-doc-progress").classList.add("gd-hidden");
    document.getElementById("send-doc-btn").disabled = false;
  }
};

window.uploadAndSend = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const fileInput = document.getElementById("file-input");
  const file = fileInput.files[0];
  if (!file) { showToast("Select a file first.", "error"); return; }

  const folder = document.getElementById("upload-folder").value;
  const storagePath = `files/${user.uid}/${clientId}/${folder}/${file.name}`;
  const storageRef = ref(storage, storagePath);

  try {
    showToast("Uploading...");
    const snap = await uploadBytesResumable(storageRef, file);
    const downloadUrl = await getDownloadURL(snap.ref);
    const docRef = await addDoc(collection(db, "files"), {
      clientId, realtorId: user.uid, fileName: file.name, storagePath, downloadUrl,
      folder, fileSize: file.size, mimeType: file.type, uploadedAt: serverTimestamp()
    });
    fileInput.value = "";
    await loadFiles(user.uid);

    // Open send modal with this file
    selectedFiles.clear();
    selectedFiles.add(docRef.id);
    updateFileActionBar();
    renderFiles();
    openSendDocModal();
  } catch (e) {
    console.error("Upload error:", e);
    showToast("Upload failed.", "error");
  }
};

/* ===== FILE PREVIEW ===== */

window.openPreview = function (fileId) {
  const f = allFiles.find(x => x.id === fileId);
  if (!f) return;

  document.getElementById("preview-file-name").textContent = f.fileName;
  document.getElementById("preview-download").href = f.downloadUrl;

  const contentEl = document.getElementById("preview-content");
  const ext = (f.fileName.split(".").pop() || "").toLowerCase();
  const mime = (f.mimeType || "").toLowerCase();

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
    contentEl.innerHTML = `<img src="${f.downloadUrl}" alt="${f.fileName}">`;
  } else if (mime === "application/pdf" || ext === "pdf") {
    contentEl.innerHTML = `<iframe src="${f.downloadUrl}"></iframe>`;
  } else if (["doc", "docx", "xlsx", "xls", "csv", "ppt", "pptx"].includes(ext)) {
    const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(f.downloadUrl)}&embedded=true`;
    contentEl.innerHTML = `<iframe src="${viewerUrl}"></iframe>`;
  } else {
    contentEl.innerHTML = `<div class="gd-empty"><div class="gd-empty-icon">&#128196;</div><div class="gd-empty-text">Preview not available for this file type</div><div class="gd-empty-sub">Use the Download button below</div></div>`;
  }

  document.getElementById("file-preview-modal").classList.add("active");
};

window.closePreview = function () {
  document.getElementById("file-preview-modal").classList.remove("active");
  document.getElementById("preview-content").innerHTML = "";
};

/* ===== BOLDSIGN E-SIGNATURES (Multi-doc/signer) ===== */

function populateSigExistingDropdown() {
  const select = document.getElementById("sig-add-existing");
  select.innerHTML = '<option value="">+ Add from existing files...</option>';

  // My Templates group
  if (allTemplateFiles.length > 0) {
    let tplGroup = '<optgroup label="My Templates">';
    allTemplateFiles.forEach(t => {
      const name = t.templateName || t.fileName;
      tplGroup += `<option value="tpl:${t.id}">${name} (${t.category || 'other'})</option>`;
    });
    tplGroup += '</optgroup>';
    select.innerHTML += tplGroup;
  }

  // Client files group
  const clientFiles = allFiles.filter(f => ["contracts", "disclosures", "other"].includes(f.folder));
  if (clientFiles.length > 0) {
    let fileGroup = '<optgroup label="Client Files">';
    clientFiles.forEach(f => {
      fileGroup += `<option value="${f.id}">${f.fileName} (${f.folder})</option>`;
    });
    fileGroup += '</optgroup>';
    select.innerHTML += fileGroup;
  }
}

function renderSigFiles() {
  const el = document.getElementById("sig-files-list");
  if (sigFiles.length === 0) {
    el.innerHTML = '<div class="gd-text-muted" style="font-size:0.8rem;">No documents added yet</div>';
    return;
  }
  el.innerHTML = sigFiles.map((f, i) => `
    <div class="gd-sig-file-row">
      <span class="gd-sig-file-name">${f.fileName}</span>
      <button class="gd-sig-file-remove" onclick="removeSigFile(${i})">&times;</button>
    </div>`).join("");
}

window.removeSigFile = function (idx) {
  sigFiles.splice(idx, 1);
  renderSigFiles();
};

function renderSigSigners() {
  const el = document.getElementById("sig-signers-list");
  el.innerHTML = sigSigners.map((s, i) => `
    <div class="gd-sig-signer-row">
      <span class="gd-sig-signer-order">${i + 1}</span>
      <input type="text" class="gd-input" placeholder="Name" value="${s.name}" onchange="sigSigners[${i}].name=this.value">
      <input type="email" class="gd-input" placeholder="Email" value="${s.email}" onchange="sigSigners[${i}].email=this.value">
      ${sigSigners.length > 1 ? `<button class="gd-sig-file-remove" onclick="removeSigner(${i})">&times;</button>` : ""}
    </div>`).join("");
}

window.addSigner = function () {
  sigSigners.push({ name: "", email: "", order: sigSigners.length + 1 });
  renderSigSigners();
};

window.removeSigner = function (idx) {
  sigSigners.splice(idx, 1);
  sigSigners.forEach((s, i) => s.order = i + 1);
  renderSigSigners();
};

window.openSignatureModal = function () {
  sigFiles = [];
  sigSigners = [{ name: clientData?.fullName || "", email: clientData?.email || "", order: 1 }];
  document.getElementById("sig-title").value = "";
  document.getElementById("sig-message").value = "";
  document.getElementById("sig-expiry").value = "30";
  document.getElementById("sig-signing-order").checked = false;
  document.getElementById("sig-progress").classList.add("gd-hidden");
  document.getElementById("sig-send-btn").disabled = false;
  document.getElementById("sig-file-input").value = "";

  populateSigExistingDropdown();
  renderSigFiles();
  renderSigSigners();
  document.getElementById("signature-modal").classList.add("active");
};

window.openSignatureModalFromSelection = function () {
  // Pre-populate with selected files
  openSignatureModal();
  const files = allFiles.filter(f => selectedFiles.has(f.id));
  sigFiles = files.map(f => ({ fileUrl: f.downloadUrl, fileName: f.fileName }));
  renderSigFiles();
  clearFileSelection();
};

window.closeSignatureModal = function () {
  document.getElementById("signature-modal").classList.remove("active");
};

// Add existing file from dropdown
document.getElementById("sig-add-existing").addEventListener("change", (e) => {
  const val = e.target.value;
  if (!val) return;

  if (val.startsWith("tpl:")) {
    const tplId = val.substring(4);
    const t = allTemplateFiles.find(x => x.id === tplId);
    if (t && !sigFiles.some(sf => sf.fileUrl === t.downloadUrl)) {
      sigFiles.push({ fileUrl: t.downloadUrl, fileName: t.templateName || t.fileName });
      renderSigFiles();
    }
  } else {
    const f = allFiles.find(x => x.id === val);
    if (f && !sigFiles.some(sf => sf.fileUrl === f.downloadUrl)) {
      sigFiles.push({ fileUrl: f.downloadUrl, fileName: f.fileName });
      renderSigFiles();
    }
  }
  e.target.value = "";
});

// Upload new files for signature
document.getElementById("sig-file-input").addEventListener("change", async (e) => {
  const user = auth.currentUser;
  if (!user) return;

  const files = e.target.files;
  if (!files.length) return;

  const progressEl = document.getElementById("sig-progress");
  const progressText = document.getElementById("sig-progress-text");
  progressEl.classList.remove("gd-hidden");
  progressText.textContent = "Uploading documents...";

  for (const file of files) {
    try {
      const storagePath = `files/${user.uid}/${clientId}/contracts/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytesResumable(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      await addDoc(collection(db, "files"), {
        clientId, realtorId: user.uid, fileName: file.name, storagePath, downloadUrl,
        folder: "contracts", fileSize: file.size, mimeType: file.type, uploadedAt: serverTimestamp()
      });

      sigFiles.push({ fileUrl: downloadUrl, fileName: file.name });
    } catch (err) {
      console.error("Upload error:", err);
      showToast(`Failed to upload ${file.name}`, "error");
    }
  }

  progressEl.classList.add("gd-hidden");
  renderSigFiles();
  await loadFiles(user.uid);
  populateSigExistingDropdown();
  e.target.value = "";
});

window.submitSignature = async function () {
  const user = auth.currentUser;
  if (!user) return;

  // Read signer values from inputs
  document.querySelectorAll("#sig-signers-list .gd-sig-signer-row").forEach((row, i) => {
    const inputs = row.querySelectorAll("input");
    sigSigners[i].name = inputs[0].value.trim();
    sigSigners[i].email = inputs[1].value.trim();
  });

  if (sigFiles.length === 0) { showToast("Add at least one document.", "error"); return; }

  const invalidSigner = sigSigners.find(s => !s.name || !s.email);
  if (invalidSigner) { showToast("All signers need a name and email.", "error"); return; }

  const progressEl = document.getElementById("sig-progress");
  const progressText = document.getElementById("sig-progress-text");
  progressEl.classList.remove("gd-hidden");
  progressText.textContent = "Sending to BoldSign...";
  document.getElementById("sig-send-btn").disabled = true;

  try {
    progressText.textContent = "Preparing signature editor...";
    const result = await createEmbeddedSignatureRequestFn({
      clientId,
      files: sigFiles,
      signers: sigSigners,
      title: document.getElementById("sig-title").value.trim() || undefined,
      message: document.getElementById("sig-message").value.trim() || undefined,
      expiryDays: parseInt(document.getElementById("sig-expiry").value) || 30
    });
    closeSignatureModal();
    openBoldSignEmbed(result.data.sendUrl, result.data.documentId);
  } catch (err) {
    console.error("Signature error:", err);
    showToast(err.message || "Failed to create signature request.", "error");
    progressEl.classList.add("gd-hidden");
    document.getElementById("sig-send-btn").disabled = false;
  }
};

/* --- BoldSign Embed --- */
function openBoldSignEmbed(sendUrl, documentId) {
  const modal = document.getElementById("boldsign-embed-modal");
  const iframe = document.getElementById("boldsign-embed-iframe");
  const loading = document.getElementById("boldsign-embed-loading");

  loading.style.display = "";
  iframe.style.display = "none";
  iframe.src = sendUrl;
  iframe.onload = () => {
    loading.style.display = "none";
    iframe.style.display = "";
  };

  modal.classList.add("active");

  // Firestore listener: auto-close when draft transitions to sent/viewed/completed
  embedUnsubscribe = onSnapshot(doc(db, "envelopes", documentId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status && data.status !== "draft") {
      showToast("Document sent for signature!");
      closeBoldSignEmbed();
      const user = auth.currentUser;
      if (user) {
        Promise.all([loadFiles(user.uid), loadEnvelopes(user.uid)]);
      }
    }
  });

  // Fallback poll in case webhook is delayed
  embedPollInterval = setInterval(async () => {
    try {
      const result = await checkSignatureStatusFn({ documentId });
      if (result.data.status && result.data.status !== "draft") {
        showToast("Document sent for signature!");
        closeBoldSignEmbed();
        const user = auth.currentUser;
        if (user) {
          Promise.all([loadFiles(user.uid), loadEnvelopes(user.uid)]);
        }
      }
    } catch (e) {
      // Ignore poll errors
    }
  }, 15000);
}

window.closeBoldSignEmbed = function () {
  const modal = document.getElementById("boldsign-embed-modal");
  const iframe = document.getElementById("boldsign-embed-iframe");
  modal.classList.remove("active");
  iframe.src = "";
  if (embedUnsubscribe) { embedUnsubscribe(); embedUnsubscribe = null; }
  if (embedPollInterval) { clearInterval(embedPollInterval); embedPollInterval = null; }
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
      draft: "#f59e0b", sent: "#3b82f6", viewed: "#8b5cf6", signed: "#22c55e",
      completed: "#22c55e", declined: "#ef4444", expired: "#6b7280", revoked: "#6b7280"
    };

    list.innerHTML = pending.map(e => {
      const title = e.title || e.fileName;
      let signerInfo = "";
      if (e.signers && e.signers.length > 0) {
        const signed = e.signers.filter(s => s.status === "completed" || s.status === "signed").length;
        signerInfo = `<div class="gd-envelope-signers">${signed} of ${e.signers.length} signed</div>`;
      } else {
        signerInfo = `<span class="gd-envelope-signer">${escapeHtml(e.signerName)}</span>`;
      }
      return `
      <div class="gd-envelope-row">
        <span class="gd-envelope-name">${escapeHtml(title)}</span>
        ${signerInfo}
        <span class="gd-badge-esig" style="background: ${statusColors[e.status] || "#6b7280"}">${statusLabel(e.status)}</span>
        <span class="gd-file-meta">${e.status === "draft" ? "Draft" : formatDate(e.sentAt)}</span>
        <button class="gd-btn gd-btn-sm" onclick="checkEnvelopeStatus('${e.documentId}')">Check Status</button>
        <button class="gd-btn gd-btn-sm gd-btn-danger" onclick="deleteEnvelope('${e.documentId}')" title="Delete">&times;</button>
      </div>`;
    }).join("");
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

window.deleteEnvelope = async function (documentId) {
  if (!confirm("Delete this signature request? This cannot be undone.")) return;
  const user = auth.currentUser;
  if (!user) return;

  try {
    await deleteDoc(doc(db, "envelopes", documentId));
    showToast("Signature request deleted.");
    await loadEnvelopes(user.uid);
  } catch (err) {
    console.error("Delete envelope error:", err);
    showToast("Failed to delete.", "error");
  }
};

/* ===== PROPERTIES TAB (Listings + Matches) ===== */
async function loadMatches(uid) {
  try {
    // Load clientListingMatches for this client
    const matchQ = query(
      collection(db, "clientListingMatches"),
      where("clientId", "==", clientId),
      where("realtorId", "==", uid),
      orderBy("matchedAt", "desc")
    );
    const matchSnap = await getDocs(matchQ);
    const rawMatches = matchSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Load referenced listings
    allMatches = [];
    for (const m of rawMatches) {
      try {
        const listingSnap = await getDoc(doc(db, "listings", m.listingId));
        if (listingSnap.exists()) {
          allMatches.push({ ...m, listing: { id: listingSnap.id, ...listingSnap.data() } });
        }
      } catch (e) {
        // Listing may have been deleted
      }
    }

    // Also cache all listings for match-a-listing panel
    const allQ = query(collection(db, "listings"), orderBy("createdAt", "desc"));
    const allSnap = await getDocs(allQ);
    allListingsCache = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Recalculate match scores
    if (clientData) {
      allMatches.forEach(m => {
        const result = calculateMatchScore(m.listing, clientData);
        m.calculatedScore = result.score;
        m.breakdown = result.breakdown;
        m.dealBreakerHits = result.dealBreakerHits;
      });
    }

    renderMatches();
  } catch (e) {
    console.error("Load matches error:", e);
  }
}

window.renderMatches = function () {
  const el = document.getElementById("properties-grid");
  selectedCompare.clear();
  updateCompareBar();

  const statusFilter = document.getElementById("match-status-filter")?.value || "";
  const sort = document.getElementById("match-sort")?.value || "score";

  let matches = [...allMatches];
  if (statusFilter) {
    matches = matches.filter(m => m.status === statusFilter);
  }

  matches.sort((a, b) => {
    switch (sort) {
      case "price_asc": return (a.listing?.listingPrice || 0) - (b.listing?.listingPrice || 0);
      case "price_desc": return (b.listing?.listingPrice || 0) - (a.listing?.listingPrice || 0);
      case "newest": return (b.matchedAt?.toMillis?.() || 0) - (a.matchedAt?.toMillis?.() || 0);
      default: return (b.calculatedScore || 0) - (a.calculatedScore || 0);
    }
  });

  if (matches.length === 0) {
    el.innerHTML = `<div class="gd-empty" style="grid-column:1/-1;"><div class="gd-empty-icon">&#127968;</div><div class="gd-empty-text">No matched listings yet</div></div>`;
    return;
  }

  el.innerHTML = matches.map(m => {
    const l = m.listing;
    const addr = l.address?.full || l.address?.street || "—";
    const score = m.calculatedScore || m.matchScore || 0;
    const color = matchScoreColor(score);
    const stars = renderStars(m.clientRating || 0);

    return `
      <div class="gd-property-card" data-id="${m.id}" onclick="openEditMatchModal('${m.id}')">
        <input type="checkbox" class="gd-property-check" data-id="${m.id}" onclick="event.stopPropagation(); toggleCompare('${m.id}')">
        <div class="gd-match-score-badge" style="border-color:${color}; color:${color}">${score}%</div>
        <div class="gd-property-address">${escapeHtml(addr)}</div>
        <div class="gd-property-price">${l.listingPrice ? formatCurrency(l.listingPrice) : "—"}</div>
        <div class="gd-property-meta">
          <span class="gd-badge gd-badge-${m.status || "interested"}">${statusLabel(m.status || "interested")}</span>
          ${l.bedrooms != null ? `<span>${l.bedrooms}bd</span>` : ""}
          ${l.bathrooms != null ? `<span>${l.bathrooms}ba</span>` : ""}
          ${l.squareFeet ? `<span>${Number(l.squareFeet).toLocaleString()}sqft</span>` : ""}
          <span class="gd-stars">${stars}</span>
        </div>
        ${m.dealBreakerHits?.length ? `<div class="gd-match-dealbreaker">Deal breaker: ${escapeHtml(m.dealBreakerHits.join(", "))}</div>` : ""}
        ${l.listingUrl ? `<a href="${sanitizeUrl(l.listingUrl)}" target="_blank" class="gd-property-link" onclick="event.stopPropagation()">View Listing &rarr;</a>` : ""}
      </div>`;
  }).join("");
};

function renderStars(rating) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += `<span class="gd-star ${i <= rating ? "filled" : ""}">&#9733;</span>`;
  }
  return html;
}

/* --- Edit Match Modal --- */
document.getElementById("em-stars")?.addEventListener("click", (e) => {
  const star = e.target.closest(".gd-star");
  if (!star) return;
  selectedRating = parseInt(star.dataset.rating);
  document.querySelectorAll("#em-stars .gd-star").forEach(s => {
    s.classList.toggle("filled", parseInt(s.dataset.rating) <= selectedRating);
  });
});

window.openEditMatchModal = function (matchId) {
  const m = allMatches.find(x => x.id === matchId);
  if (!m) return;
  editingMatchId = matchId;

  const addr = m.listing?.address?.full || "Match";
  document.getElementById("edit-match-title").textContent = addr;
  document.getElementById("em-status").value = m.status || "interested";
  document.getElementById("em-feedback").value = m.clientFeedback || "";
  document.getElementById("em-notes").value = m.realtorNotes || "";
  selectedRating = m.clientRating || 0;
  document.querySelectorAll("#em-stars .gd-star").forEach(s => {
    s.classList.toggle("filled", parseInt(s.dataset.rating) <= selectedRating);
  });

  document.getElementById("edit-match-modal").classList.add("active");
};

window.closeEditMatchModal = function () {
  document.getElementById("edit-match-modal").classList.remove("active");
  editingMatchId = null;
};

window.saveMatch = async function () {
  if (!editingMatchId) return;
  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, "clientListingMatches", editingMatchId), {
      status: document.getElementById("em-status").value,
      clientRating: selectedRating,
      clientFeedback: document.getElementById("em-feedback").value.trim(),
      realtorNotes: document.getElementById("em-notes").value.trim()
    });
    showToast("Match updated!");
    closeEditMatchModal();
    await loadMatches(user.uid);
  } catch (e) {
    console.error("Save match error:", e);
    showToast("Failed to save.", "error");
  }
};

window.deleteMatch = async function () {
  if (!editingMatchId) return;
  if (!confirm("Remove this listing match?")) return;
  const user = auth.currentUser;
  if (!user) return;

  try {
    await deleteDoc(doc(db, "clientListingMatches", editingMatchId));
    showToast("Match removed.");
    closeEditMatchModal();
    await loadMatches(user.uid);
  } catch (e) {
    console.error("Delete match error:", e);
    showToast("Failed to remove.", "error");
  }
};

/* --- Match-a-Listing Panel --- */
window.openMatchListingPanel = function () {
  renderMatchListingResults();
  document.getElementById("match-listing-modal").classList.add("active");
};

window.closeMatchListingPanel = function () {
  document.getElementById("match-listing-modal").classList.remove("active");
};

window.filterMatchListings = function () {
  renderMatchListingResults();
};

function renderMatchListingResults() {
  const search = (document.getElementById("match-search")?.value || "").toLowerCase();
  const el = document.getElementById("match-listing-results");
  const matchedIds = new Set(allMatches.map(m => m.listingId));

  let listings = allListingsCache.filter(l => {
    if (matchedIds.has(l.id)) return false; // already matched
    if (search) {
      const addrStr = [l.address?.full, l.address?.city, l.mlsNumber].filter(Boolean).join(" ").toLowerCase();
      if (!addrStr.includes(search)) return false;
    }
    return true;
  });

  // Score and sort
  if (clientData) {
    listings = listings.map(l => {
      const result = calculateMatchScore(l, clientData);
      return { ...l, _score: result.score, _color: matchScoreColor(result.score) };
    }).sort((a, b) => b._score - a._score);
  }

  if (listings.length === 0) {
    el.innerHTML = '<div class="gd-text-muted" style="padding:1rem;">No listings found</div>';
    return;
  }

  el.innerHTML = listings.slice(0, 20).map(l => {
    const addr = l.address?.full || "—";
    return `
      <div class="gd-match-listing-row">
        <div>
          ${l._score != null ? `<span class="gd-match-badge-inline" style="background:${l._color}">${l._score}%</span>` : ""}
          <strong>${addr}</strong>
          <span class="gd-text-muted">${l.listingPrice ? formatCurrency(l.listingPrice) : ""}</span>
          <span class="gd-text-muted">${[l.bedrooms ? l.bedrooms + "bd" : "", l.bathrooms ? l.bathrooms + "ba" : ""].filter(Boolean).join(" / ")}</span>
        </div>
        <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="matchListingToThisClient('${l.id}')">Match</button>
      </div>`;
  }).join("");
}

window.matchListingToThisClient = async function (listingId) {
  const user = auth.currentUser;
  if (!user || !clientData) return;

  try {
    const listing = allListingsCache.find(l => l.id === listingId);
    const result = calculateMatchScore(listing, clientData);

    await addDoc(collection(db, "clientListingMatches"), {
      listingId,
      clientId,
      realtorId: user.uid,
      matchScore: result.score,
      matchBreakdown: result.breakdown,
      dealBreakerHits: result.dealBreakerHits,
      status: "interested",
      clientRating: null,
      clientFeedback: "",
      realtorNotes: "",
      matchedAt: serverTimestamp()
    });

    showToast("Listing matched!");
    await loadMatches(user.uid);
    renderMatchListingResults(); // refresh to remove matched listing
  } catch (e) {
    console.error("Match error:", e);
    showToast("Failed to match.", "error");
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
  if (count >= 1) {
    bar.classList.add("active");
    document.getElementById("compare-count").textContent = count + " selected";
    document.getElementById("compare-btn").disabled = count < 2;
  } else {
    bar.classList.remove("active");
  }
}

window.showComparison = function () {
  const matches = allMatches.filter(m => selectedCompare.has(m.id));
  const table = document.getElementById("compare-table");

  let headerRow = "<tr><th></th>" + matches.map(m => {
    const addr = m.listing?.address?.full || "—";
    return `<th>${addr}</th>`;
  }).join("") + "</tr>";

  const rows = [
    { label: "Match Score", render: m => { const s = m.calculatedScore || 0; return `<span style="color:${matchScoreColor(s)};font-weight:600;">${s}%</span>`; } },
    { label: "Price", render: m => formatCurrency(m.listing?.listingPrice) },
    { label: "Beds", render: m => m.listing?.bedrooms ?? "—" },
    { label: "Baths", render: m => m.listing?.bathrooms ?? "—" },
    { label: "Sq Ft", render: m => m.listing?.squareFeet ? Number(m.listing.squareFeet).toLocaleString() : "—" },
    { label: "Type", render: m => m.listing?.propertyType || "—" },
    { label: "Year Built", render: m => m.listing?.yearBuilt || "—" },
    { label: "Status", render: m => statusLabel(m.status) },
    { label: "Rating", render: m => renderStars(m.clientRating || 0) },
    { label: "Feedback", render: m => m.clientFeedback || "—" }
  ];

  const values = {};
  rows.forEach(r => {
    values[r.label] = matches.map(m => r.render(m));
  });

  let bodyHtml = rows.map(r => {
    const vals = matches.map(m => r.render(m));
    const allSame = vals.every(v => v === vals[0]);
    return `<tr><td style="font-weight:500; color: var(--color-text-primary);">${r.label}</td>` +
      vals.map(v => `<td${!allSame ? ' class="gd-compare-diff"' : ""}>${v}</td>`).join("") + "</tr>";
  }).join("");

  table.innerHTML = headerRow + bodyHtml;
  document.getElementById("compare-modal").classList.add("active");
};

window.closeCompareModal = function () {
  document.getElementById("compare-modal").classList.remove("active");
};

/* --- Copy to Client --- */
window.openCopyToClientModal = async function () {
  const summaryEl = document.getElementById("copy-property-summary");
  const selected = allMatches.filter(m => selectedCompare.has(m.id));
  summaryEl.innerHTML = selected.map(m => {
    const addr = m.listing?.address?.full || "Unknown";
    const price = m.listing?.listingPrice ? formatCurrency(m.listing.listingPrice) : "";
    return `<div class="gd-copy-summary-item"><span>${addr}</span>${price ? `<span class="gd-text-muted">${price}</span>` : ""}</div>`;
  }).join("");

  document.getElementById("copy-client-search").value = "";
  document.getElementById("copy-selected-client").classList.add("gd-hidden");
  document.getElementById("copy-client-search-group").style.display = "";
  document.getElementById("copy-client-list").innerHTML = '<div class="gd-text-muted" style="padding:1rem;">Loading clients...</div>';
  document.getElementById("copy-client-btn").disabled = true;
  document.getElementById("copy-progress").classList.add("gd-hidden");
  selectedCopyClientId = null;

  document.getElementById("copy-client-modal").classList.add("active");

  try {
    const user = auth.currentUser;
    const q = query(collection(db, "clients"), where("realtorId", "==", user.uid), orderBy("fullName"));
    const snap = await getDocs(q);
    copyClientsList = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.id !== clientId);
    renderCopyClientList(copyClientsList);
  } catch (e) {
    console.error("Load clients error:", e);
    document.getElementById("copy-client-list").innerHTML = '<div class="gd-text-muted" style="padding:1rem;color:var(--gd-red);">Failed to load clients.</div>';
  }
};

window.closeCopyToClientModal = function () {
  document.getElementById("copy-client-modal").classList.remove("active");
};

window.filterCopyClients = function () {
  const term = document.getElementById("copy-client-search").value.toLowerCase().trim();
  if (!term) { renderCopyClientList(copyClientsList); return; }
  const filtered = copyClientsList.filter(c =>
    (c.fullName || "").toLowerCase().includes(term) ||
    (c.email || "").toLowerCase().includes(term)
  );
  renderCopyClientList(filtered);
};

function renderCopyClientList(clients) {
  const el = document.getElementById("copy-client-list");
  if (!clients.length) {
    el.innerHTML = '<div class="gd-text-muted" style="padding:1rem;">No clients found.</div>';
    return;
  }
  el.innerHTML = clients.map(c => `
    <div class="gd-copy-client-row" onclick="selectCopyClient('${c.id}')">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:500;">${escapeHtml(c.fullName) || "Unnamed"}</div>
        <div class="gd-text-muted">${escapeHtml(c.email) || "No email"}</div>
      </div>
      <span class="gd-badge gd-badge-${c.status || "lead"}">${statusLabel(c.status || "lead")}</span>
    </div>
  `).join("");
}

window.selectCopyClient = function (id) {
  selectedCopyClientId = id;
  const client = copyClientsList.find(c => c.id === id);
  if (!client) return;
  const el = document.getElementById("copy-selected-client");
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <span style="font-weight:500;">${escapeHtml(client.fullName) || "Unnamed"}</span>
      <span class="gd-badge gd-badge-${client.status || "lead"}">${statusLabel(client.status || "lead")}</span>
      <button class="gd-modal-close" onclick="clearCopyClientSelection()" style="margin-left:auto;font-size:1.2rem;" aria-label="Clear">&times;</button>
    </div>
    <div class="gd-text-muted">${escapeHtml(client.email)}</div>
  `;
  el.classList.remove("gd-hidden");
  document.getElementById("copy-client-search-group").style.display = "none";
  document.getElementById("copy-client-list").style.display = "none";
  document.getElementById("copy-client-btn").disabled = false;
};

window.clearCopyClientSelection = function () {
  selectedCopyClientId = null;
  document.getElementById("copy-selected-client").classList.add("gd-hidden");
  document.getElementById("copy-client-search-group").style.display = "";
  document.getElementById("copy-client-list").style.display = "";
  document.getElementById("copy-client-btn").disabled = true;
};

window.executeCopyToClient = async function () {
  if (!selectedCopyClientId) return;
  const user = auth.currentUser;
  if (!user) return;

  const btn = document.getElementById("copy-client-btn");
  const progress = document.getElementById("copy-progress");
  btn.disabled = true;
  progress.classList.remove("gd-hidden");

  try {
    const destClient = copyClientsList.find(c => c.id === selectedCopyClientId);
    const selectedMatches = allMatches.filter(m => selectedCompare.has(m.id));

    // Get existing matches on destination client to check duplicates
    const existingQ = query(
      collection(db, "clientListingMatches"),
      where("clientId", "==", selectedCopyClientId),
      where("realtorId", "==", user.uid)
    );
    const existingSnap = await getDocs(existingQ);
    const existingListingIds = new Set(existingSnap.docs.map(d => d.data().listingId));

    let copied = 0;
    let skipped = 0;

    for (const match of selectedMatches) {
      const lid = match.listingId || match.listing?.id;
      if (!lid || existingListingIds.has(lid)) { skipped++; continue; }

      const result = destClient ? calculateMatchScore(match.listing, destClient) : { score: 0, breakdown: {}, dealBreakerHits: [] };

      await addDoc(collection(db, "clientListingMatches"), {
        listingId: lid,
        clientId: selectedCopyClientId,
        realtorId: user.uid,
        matchScore: result.score,
        matchBreakdown: result.breakdown,
        dealBreakerHits: result.dealBreakerHits,
        status: "interested",
        clientRating: null,
        clientFeedback: "",
        realtorNotes: "",
        matchedAt: serverTimestamp()
      });
      copied++;
    }

    const name = destClient?.fullName || "client";
    let msg = `Copied ${copied} propert${copied === 1 ? "y" : "ies"} to ${name}`;
    if (skipped > 0) msg += ` (${skipped} already existed)`;
    showToast(msg);
    closeCopyToClientModal();
  } catch (e) {
    console.error("Copy to client error:", e);
    showToast("Failed to copy properties.", "error");
    btn.disabled = false;
  } finally {
    progress.classList.add("gd-hidden");
  }
};

/* ===== SHOWINGS TAB ===== */

async function loadShowings(uid) {
  try {
    const q = query(
      collection(db, "showings"),
      where("clientId", "==", clientId),
      where("realtorId", "==", uid),
      orderBy("showingDate", "desc")
    );
    const snap = await getDocs(q);
    allShowings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderShowings();
  } catch (e) {
    console.error("Load showings error:", e);
  }
}

function renderShowings() {
  const now = new Date();
  const upcoming = allShowings.filter(s => s.status === "scheduled" && s.showingDate?.toDate && s.showingDate.toDate() >= now);
  const past = allShowings.filter(s => s.status !== "scheduled" || (s.showingDate?.toDate && s.showingDate.toDate() < now));
  const completed = allShowings.filter(s => s.status === "completed");

  document.getElementById("ss-total").textContent = allShowings.length;
  document.getElementById("ss-upcoming").textContent = upcoming.length;
  document.getElementById("ss-completed").textContent = completed.length;

  const ratings = completed.filter(s => s.clientRating).map(s => s.clientRating);
  document.getElementById("ss-avgrating").textContent = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : "—";

  const upEl = document.getElementById("showings-upcoming");
  const pastEl = document.getElementById("showings-past");

  if (upcoming.length === 0) {
    upEl.innerHTML = '<div class="gd-text-muted" style="padding:0.5rem 0;">No upcoming showings</div>';
  } else {
    upEl.innerHTML = upcoming.map(s => renderShowingCard(s, true)).join("");
  }

  if (past.length === 0) {
    pastEl.innerHTML = '<div class="gd-text-muted" style="padding:0.5rem 0;">No past showings</div>';
  } else {
    pastEl.innerHTML = past.map(s => renderShowingCard(s, false)).join("");
  }
}

function renderShowingCard(s, isUpcoming) {
  const date = s.showingDate?.toDate ? formatDateTime(s.showingDate) : "—";
  const price = s.listingPrice ? formatCurrency(s.listingPrice) : "";
  const stars = s.clientRating ? renderStars(s.clientRating) : "";
  const statusBadge = `<span class="gd-badge gd-badge-${s.status}">${statusLabel(s.status)}</span>`;

  let actions = "";
  if (isUpcoming) {
    actions = `
      <button class="gd-btn gd-btn-sm" onclick="editShowing('${s.id}')">Edit</button>
      <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="openCompleteShowingModal('${s.id}')">Complete</button>
      <button class="gd-btn gd-btn-sm" onclick="cancelShowing('${s.id}')">Cancel</button>`;
  }

  return `
    <div class="gd-showing-card">
      <div class="gd-showing-card-header">
        <div class="gd-showing-card-address">${escapeHtml(s.address) || "—"}</div>
        ${statusBadge}
      </div>
      <div class="gd-showing-card-meta">
        <span>${date}</span>
        ${price ? `<span>${price}</span>` : ""}
        ${s.mlsNumber ? `<span>MLS: ${s.mlsNumber}</span>` : ""}
        ${stars ? `<span class="gd-stars">${stars}</span>` : ""}
      </div>
      ${s.clientFeedback ? `<div style="font-size:0.8rem;color:#4b5563;margin-bottom:0.35rem;">${escapeHtml(s.clientFeedback)}</div>` : ""}
      ${s.realtorNotes ? `<div style="font-size:0.8rem;color:#6b7280;font-style:italic;margin-bottom:0.35rem;">${escapeHtml(s.realtorNotes)}</div>` : ""}
      ${actions ? `<div class="gd-showing-card-actions">${actions}</div>` : ""}
    </div>`;
}

window.openShowingModal = function (showingId) {
  editingShowingId = showingId || null;
  document.getElementById("showing-modal-title").textContent = showingId ? "Edit Showing" : "Add Showing";

  // Populate property dropdown from matched listings
  const select = document.getElementById("show-property");
  select.innerHTML = '<option value="">— Manual entry —</option>';
  allMatches.forEach(m => {
    const l = m.listing;
    if (!l) return;
    const addr = l.address?.full || l.address?.street || "—";
    select.innerHTML += `<option value="${l.id}">${escapeHtml(addr)} ${l.mlsNumber ? "(MLS: " + escapeHtml(l.mlsNumber) + ")" : ""}</option>`;
  });

  if (showingId) {
    const s = allShowings.find(x => x.id === showingId);
    if (s) {
      document.getElementById("show-address").value = s.address || "";
      document.getElementById("show-mls").value = s.mlsNumber || "";
      document.getElementById("show-price").value = s.listingPrice || "";
      document.getElementById("show-notes").value = s.realtorNotes || "";
      document.getElementById("show-duration").value = 60;
      document.getElementById("show-followup").checked = false;
      if (s.showingDate) {
        const d = s.showingDate.toDate ? s.showingDate.toDate() : new Date(s.showingDate);
        const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById("show-date").value = iso;
      }
    }
  } else {
    document.getElementById("show-address").value = "";
    document.getElementById("show-mls").value = "";
    document.getElementById("show-price").value = "";
    document.getElementById("show-date").value = "";
    document.getElementById("show-duration").value = "60";
    document.getElementById("show-notes").value = "";
    document.getElementById("show-followup").checked = true;
    document.getElementById("show-property").value = "";
  }

  document.getElementById("showing-modal").classList.add("active");
};

window.editShowing = function (id) { openShowingModal(id); };

window.closeShowingModal = function () {
  document.getElementById("showing-modal").classList.remove("active");
};

window.fillShowingFromProperty = function () {
  const listingId = document.getElementById("show-property").value;
  if (!listingId) return;
  const m = allMatches.find(x => x.listing?.id === listingId);
  if (m?.listing) {
    const l = m.listing;
    document.getElementById("show-address").value = l.address?.full || "";
    document.getElementById("show-mls").value = l.mlsNumber || "";
    document.getElementById("show-price").value = l.listingPrice || "";
  }
};

window.saveShowing = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const address = document.getElementById("show-address").value.trim();
  if (!address) { showToast("Address is required.", "error"); return; }

  const dateVal = document.getElementById("show-date").value;
  if (!dateVal) { showToast("Date is required.", "error"); return; }

  const startDate = new Date(dateVal);
  const duration = parseInt(document.getElementById("show-duration").value) || 60;
  const endDate = new Date(startDate.getTime() + duration * 60000);

  const data = {
    clientId,
    realtorId: user.uid,
    address,
    mlsNumber: document.getElementById("show-mls").value.trim(),
    listingPrice: Number(document.getElementById("show-price").value) || null,
    showingDate: Timestamp.fromDate(startDate),
    endDate: Timestamp.fromDate(endDate),
    status: "scheduled",
    realtorNotes: document.getElementById("show-notes").value.trim(),
    propertyId: document.getElementById("show-property").value || null,
    updatedAt: serverTimestamp()
  };

  try {
    if (editingShowingId) {
      await updateDoc(doc(db, "showings", editingShowingId), data);
      showToast("Showing updated!");
    } else {
      data.createdAt = serverTimestamp();
      data.clientRating = null;
      data.clientFeedback = "";
      data.disclosuresSent = false;
      data.followUpId = null;
      const showingRef = await addDoc(collection(db, "showings"), data);

      // Log activity
      await addDoc(collection(db, "activities"), {
        clientId, realtorId: user.uid, type: "showing",
        subject: `Showing scheduled: ${address}`,
        body: `${formatDateTime(Timestamp.fromDate(startDate))}`,
        timestamp: serverTimestamp()
      });
      await updateDoc(doc(db, "clients", clientId), { lastActivityDate: serverTimestamp() });

      // Auto-create follow-up if checked
      if (document.getElementById("show-followup").checked) {
        const fuDate = new Date(startDate.getTime() + 86400000); // next day
        await addDoc(collection(db, "followUps"), {
          realtorId: user.uid, clientId,
          title: `Follow up: ${address} showing`,
          dueDate: Timestamp.fromDate(fuDate),
          priority: "medium", status: "pending", notes: "",
          sourceType: "showing", sourceId: showingRef.id,
          createdAt: serverTimestamp()
        });
      }

      // Auto-import: create skeleton listing if no matching listing exists
      try {
        const addrLower = address.toLowerCase();
        const existingListing = allListingsCache.find(l =>
          (l.address?.full || "").toLowerCase() === addrLower
        );
        let listingId = existingListing?.id || data.propertyId;

        if (!listingId) {
          // Create skeleton listing
          const listingData = {
            address: { full: address, street: address, city: "", state: "", zip: "", county: "", neighborhood: "", lat: null, lng: null },
            listingPrice: data.listingPrice,
            mlsNumber: data.mlsNumber || "",
            status: "active",
            source: "showing_import",
            addedBy: user.uid,
            photos: [],
            features: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          const listingRef = await addDoc(collection(db, "listings"), listingData);
          listingId = listingRef.id;
        }

        // Auto-create clientListingMatch if not already matched
        const matchQ = query(
          collection(db, "clientListingMatches"),
          where("listingId", "==", listingId),
          where("clientId", "==", clientId),
          where("realtorId", "==", user.uid)
        );
        const matchSnap = await getDocs(matchQ);
        if (matchSnap.empty) {
          await addDoc(collection(db, "clientListingMatches"), {
            listingId,
            clientId,
            realtorId: user.uid,
            matchScore: null,
            status: "shown",
            clientRating: null,
            clientFeedback: "",
            realtorNotes: "",
            matchedAt: serverTimestamp()
          });
        }
      } catch (importErr) {
        console.warn("Auto-import listing from showing:", importErr);
      }

      showToast("Showing added!");
    }
    closeShowingModal();
    await loadShowings(user.uid);
    await loadMatches(user.uid); // refresh matches after auto-import
  } catch (e) {
    console.error("Save showing error:", e);
    showToast("Failed to save showing.", "error");
  }
};

window.cancelShowing = async function (id) {
  if (!confirm("Cancel this showing?")) return;
  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, "showings", id), { status: "cancelled", updatedAt: serverTimestamp() });
    showToast("Showing cancelled.");
    await loadShowings(user.uid);
  } catch (e) {
    console.error("Cancel showing error:", e);
    showToast("Failed to cancel.", "error");
  }
};

/* --- Complete Showing Modal --- */

document.getElementById("complete-stars").addEventListener("click", (e) => {
  const star = e.target.closest(".gd-star");
  if (!star) return;
  completeRating = parseInt(star.dataset.rating);
  document.querySelectorAll("#complete-stars .gd-star").forEach(s => {
    s.classList.toggle("filled", parseInt(s.dataset.rating) <= completeRating);
  });
});

window.openCompleteShowingModal = function (id) {
  completingShowingId = id;
  completeRating = 0;
  document.querySelectorAll("#complete-stars .gd-star").forEach(s => s.classList.remove("filled"));
  document.getElementById("complete-feedback").value = "";
  document.getElementById("complete-notes").value = "";
  document.getElementById("complete-followup").checked = true;
  document.getElementById("complete-showing-modal").classList.add("active");
};

window.closeCompleteShowingModal = function () {
  document.getElementById("complete-showing-modal").classList.remove("active");
};

window.submitCompleteShowing = async function () {
  const user = auth.currentUser;
  if (!user || !completingShowingId) return;

  const showing = allShowings.find(s => s.id === completingShowingId);
  if (!showing) return;

  try {
    await updateDoc(doc(db, "showings", completingShowingId), {
      status: "completed",
      clientRating: completeRating || null,
      clientFeedback: document.getElementById("complete-feedback").value.trim(),
      realtorNotes: document.getElementById("complete-notes").value.trim(),
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "activities"), {
      clientId, realtorId: user.uid, type: "showing",
      subject: `Showing completed: ${showing.address}`,
      body: completeRating ? `Rating: ${completeRating}/5` : "",
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "clients", clientId), { lastActivityDate: serverTimestamp() });

    if (document.getElementById("complete-followup").checked) {
      const fuDate = new Date(Date.now() + 86400000);
      await addDoc(collection(db, "followUps"), {
        realtorId: user.uid, clientId,
        title: `Follow up after showing: ${showing.address}`,
        dueDate: Timestamp.fromDate(fuDate),
        priority: "medium", status: "pending", notes: "",
        sourceType: "showing", sourceId: completingShowingId,
        createdAt: serverTimestamp()
      });
    }

    showToast("Showing completed!");
    closeCompleteShowingModal();
    await Promise.all([loadShowings(user.uid), loadActivities(user.uid), loadFollowUps(user.uid)]);
  } catch (e) {
    console.error("Complete showing error:", e);
    showToast("Failed to complete showing.", "error");
  }
};

/* ===== FOLLOW-UPS ===== */

async function loadFollowUps(uid) {
  try {
    const q = query(
      collection(db, "followUps"),
      where("clientId", "==", clientId),
      where("realtorId", "==", uid),
      orderBy("dueDate", "asc")
    );
    const snap = await getDocs(q);
    allFollowUps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFollowUps();
  } catch (e) {
    console.error("Load follow-ups error:", e);
  }
}

function renderFollowUps() {
  const pending = allFollowUps.filter(f => f.status === "pending");
  const el = document.getElementById("followup-list");

  if (pending.length === 0) {
    el.classList.add("gd-hidden");
    return;
  }

  el.classList.remove("gd-hidden");
  el.innerHTML = `<div class="gd-showing-section-title" style="margin-top:0;">Pending Follow-ups</div>` +
    pending.map(f => {
      const due = f.dueDate?.toDate ? formatDate(f.dueDate) : "—";
      const isOverdue = f.dueDate?.toDate && f.dueDate.toDate() < new Date();
      return `
      <div class="gd-followup-item priority-${f.priority || "medium"}">
        <div class="gd-followup-dot"></div>
        <div class="gd-followup-info">
          <div class="gd-followup-title">${escapeHtml(f.title)}</div>
          <div class="gd-followup-due">${isOverdue ? "Overdue — " : ""}Due: ${due}</div>
        </div>
        <div class="gd-followup-actions">
          <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="completeFollowUp('${f.id}')">Done</button>
          <button class="gd-btn gd-btn-sm" onclick="snoozeFollowUp('${f.id}')">Snooze</button>
          <button class="gd-btn gd-btn-sm" onclick="dismissFollowUp('${f.id}')">Dismiss</button>
        </div>
      </div>`;
    }).join("");
}

window.openFollowUpModal = function (sourceType, sourceId) {
  document.getElementById("fu-title").value = "";
  // Default due date = tomorrow
  const tomorrow = new Date(Date.now() + 86400000);
  document.getElementById("fu-date").value = tomorrow.toISOString().slice(0, 10);
  document.getElementById("fu-priority").value = "medium";
  document.getElementById("fu-notes").value = "";
  document.getElementById("followup-modal").classList.add("active");
  // Store source info on modal element
  document.getElementById("followup-modal").dataset.sourceType = sourceType || "";
  document.getElementById("followup-modal").dataset.sourceId = sourceId || "";
};

window.closeFollowUpModal = function () {
  document.getElementById("followup-modal").classList.remove("active");
};

window.saveFollowUp = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const title = document.getElementById("fu-title").value.trim();
  const dateVal = document.getElementById("fu-date").value;
  if (!title || !dateVal) { showToast("Title and due date are required.", "error"); return; }

  const modal = document.getElementById("followup-modal");

  try {
    await addDoc(collection(db, "followUps"), {
      realtorId: user.uid, clientId, title,
      dueDate: Timestamp.fromDate(new Date(dateVal)),
      priority: document.getElementById("fu-priority").value,
      status: "pending",
      notes: document.getElementById("fu-notes").value.trim(),
      sourceType: modal.dataset.sourceType || null,
      sourceId: modal.dataset.sourceId || null,
      createdAt: serverTimestamp()
    });
    showToast("Follow-up created!");
    closeFollowUpModal();
    await loadFollowUps(user.uid);
  } catch (e) {
    console.error("Save follow-up error:", e);
    showToast("Failed to save follow-up.", "error");
  }
};

window.completeFollowUp = async function (id) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, "followUps", id), { status: "completed", completedAt: serverTimestamp() });
    showToast("Follow-up completed!");
    await loadFollowUps(user.uid);
  } catch (e) {
    showToast("Failed to update.", "error");
  }
};

window.snoozeFollowUp = async function (id) {
  const user = auth.currentUser;
  if (!user) return;
  const snoozeTo = new Date(Date.now() + 86400000); // +1 day
  try {
    await updateDoc(doc(db, "followUps", id), {
      dueDate: Timestamp.fromDate(snoozeTo),
      snoozedUntil: Timestamp.fromDate(snoozeTo)
    });
    showToast("Snoozed for 1 day.");
    await loadFollowUps(user.uid);
  } catch (e) {
    showToast("Failed to snooze.", "error");
  }
};

window.dismissFollowUp = async function (id) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, "followUps", id), { status: "dismissed" });
    showToast("Follow-up dismissed.");
    await loadFollowUps(user.uid);
  } catch (e) {
    showToast("Failed to dismiss.", "error");
  }
};

/* ===== AI EMAIL DRAFT HANDLER ===== */
// Listen for email draft events from shared chatbot module
document.addEventListener("ai-email-draft", (e) => {
  const aiText = e.detail.text;
  let subject = "";
  let body = aiText;
  const subjectMatch = aiText.match(/(?:\*\*)?Subject:?\s*(?:\*\*)?\s*(.+?)(?:\n|$)/i);
  if (subjectMatch) {
    subject = subjectMatch[1].replace(/\*\*/g, "").trim();
    body = aiText.replace(subjectMatch[0], "").trim();
  }
  body = body
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .trim();
  openActivityModal("email");
  document.getElementById("act-subject").value = subject;
  document.getElementById("act-body").value = body;
});

// Listen for AI actions that should refresh client data
document.addEventListener("ai-actions-performed", async () => {
  const user = auth.currentUser;
  if (user) {
    await loadClient(user.uid);
  }
});

/* ===== ADD LISTING FROM CLIENT DETAIL ===== */
const FEATURE_SUGGESTIONS = [
  "Pool", "Garage", "Fireplace", "Hardwood Floors", "Open Floor Plan",
  "Basement", "Deck", "Patio", "Fenced Yard", "Central Air",
  "Updated Kitchen", "Stainless Appliances", "Granite Counters",
  "Walk-in Closet", "Laundry Room", "Home Office", "Smart Home",
  "Solar Panels", "Corner Lot", "Cul-de-sac", "New Roof",
  "Finished Basement", "In-ground Pool", "Screened Porch"
];

window.openAddListingModal = function () {
  // Clear all form fields
  ["al-url", "al-address", "al-city", "al-state", "al-zip", "al-county", "al-neighborhood",
   "al-price", "al-beds", "al-baths", "al-sqft", "al-yearBuilt", "al-lotSize",
   "al-garage", "al-stories", "al-mls", "al-listingUrl", "al-description", "al-notes"
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("al-type").value = "";
  document.getElementById("al-status").value = "active";
  document.getElementById("al-fetch-status").innerHTML = "";
  document.getElementById("al-fetch-btn").disabled = false;
  document.getElementById("al-fetch-btn").textContent = "Fetch";
  document.getElementById("al-save-btn").disabled = false;
  addListingFeatureTags = [];
  renderAddListingTags();
  renderAddListingTagSuggestions();
  document.getElementById("add-listing-modal").classList.add("active");
};

window.closeAddListingModal = function () {
  document.getElementById("add-listing-modal").classList.remove("active");
};

window.fetchListingFromUrl = async function () {
  const url = document.getElementById("al-url").value.trim();
  if (!url) { showToast("Enter a listing URL.", "error"); return; }

  const btn = document.getElementById("al-fetch-btn");
  const statusEl = document.getElementById("al-fetch-status");
  btn.disabled = true;
  btn.textContent = "Fetching...";
  statusEl.innerHTML = '<div class="gd-spinner" style="display:inline-block;vertical-align:middle;margin-right:0.5rem;"></div> Extracting property details...';
  statusEl.className = "gd-url-fetch-result gd-url-fetch-loading";

  try {
    const result = await parseListingUrlFn({ url });
    const listing = result.data.listing;

    // Populate form fields
    if (listing.address) {
      document.getElementById("al-address").value = listing.address.street || listing.address.full || "";
      document.getElementById("al-city").value = listing.address.city || "";
      document.getElementById("al-state").value = listing.address.state || "";
      document.getElementById("al-zip").value = listing.address.zip || "";
      document.getElementById("al-county").value = listing.address.county || "";
      document.getElementById("al-neighborhood").value = listing.address.neighborhood || "";
    }
    if (listing.listingPrice) document.getElementById("al-price").value = listing.listingPrice;
    if (listing.bedrooms != null) document.getElementById("al-beds").value = listing.bedrooms;
    if (listing.bathrooms != null) document.getElementById("al-baths").value = listing.bathrooms;
    if (listing.squareFeet) document.getElementById("al-sqft").value = listing.squareFeet;
    if (listing.propertyType) document.getElementById("al-type").value = listing.propertyType;
    if (listing.yearBuilt) document.getElementById("al-yearBuilt").value = listing.yearBuilt;
    if (listing.lotSize) document.getElementById("al-lotSize").value = listing.lotSize;
    if (listing.garageSpaces) document.getElementById("al-garage").value = listing.garageSpaces;
    if (listing.stories) document.getElementById("al-stories").value = listing.stories;
    if (listing.mlsNumber) document.getElementById("al-mls").value = listing.mlsNumber;
    if (listing.status) document.getElementById("al-status").value = listing.status;
    if (listing.description) document.getElementById("al-description").value = listing.description;
    document.getElementById("al-listingUrl").value = url;

    if (listing.features && Array.isArray(listing.features)) {
      addListingFeatureTags = listing.features.slice(0, 30);
      renderAddListingTags();
      renderAddListingTagSuggestions();
    }

    statusEl.innerHTML = "&#10003; Property details extracted!";
    statusEl.className = "gd-url-fetch-result gd-url-fetch-success";
  } catch (err) {
    console.error("Fetch listing error:", err);
    statusEl.innerHTML = "&#10007; " + (err.message || "Failed to extract listing details.");
    statusEl.className = "gd-url-fetch-result gd-url-fetch-error";
  }
  btn.disabled = false;
  btn.textContent = "Fetch";
};

function renderAddListingTags() {
  const el = document.getElementById("al-tag-list");
  el.innerHTML = addListingFeatureTags.map((tag, i) =>
    `<span class="gd-tag">${escapeHtml(tag)}<button class="gd-tag-remove" onclick="removeAddListingTag(${i})">&times;</button></span>`
  ).join("");
}

function renderAddListingTagSuggestions() {
  const el = document.getElementById("al-tag-suggestions");
  const available = FEATURE_SUGGESTIONS.filter(s => !addListingFeatureTags.includes(s));
  el.innerHTML = available.map(s =>
    `<button class="gd-tag-suggestion" onclick="addAddListingTag('${s}')">${s}</button>`
  ).join("");
}

window.addAddListingTag = function (tag) {
  if (!addListingFeatureTags.includes(tag)) {
    addListingFeatureTags.push(tag);
    renderAddListingTags();
    renderAddListingTagSuggestions();
  }
};

window.removeAddListingTag = function (index) {
  addListingFeatureTags.splice(index, 1);
  renderAddListingTags();
  renderAddListingTagSuggestions();
};

// Tag input: Enter to add custom tags
document.getElementById("al-tag-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const val = e.target.value.trim();
    if (val && !addListingFeatureTags.includes(val)) {
      addListingFeatureTags.push(val);
      renderAddListingTags();
      renderAddListingTagSuggestions();
    }
    e.target.value = "";
  }
});

window.saveAndMatchListing = async function () {
  const user = auth.currentUser;
  if (!user || !clientData) return;

  const addrFull = document.getElementById("al-address").value.trim();
  if (!addrFull) { showToast("Street address is required.", "error"); return; }

  const saveBtn = document.getElementById("al-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const price = Number(document.getElementById("al-price").value) || null;
  const sqft = Number(document.getElementById("al-sqft").value) || null;

  const address = {
    full: [addrFull, document.getElementById("al-city").value.trim(), document.getElementById("al-state").value.trim(), document.getElementById("al-zip").value.trim()].filter(Boolean).join(", "),
    street: addrFull,
    city: document.getElementById("al-city").value.trim(),
    state: document.getElementById("al-state").value.trim(),
    zip: document.getElementById("al-zip").value.trim(),
    county: document.getElementById("al-county").value.trim(),
    neighborhood: document.getElementById("al-neighborhood").value.trim(),
    lat: null,
    lng: null
  };

  const data = {
    address,
    listingPrice: price,
    bedrooms: Number(document.getElementById("al-beds").value) || null,
    bathrooms: Number(document.getElementById("al-baths").value) || null,
    squareFeet: sqft,
    propertyType: document.getElementById("al-type").value,
    yearBuilt: Number(document.getElementById("al-yearBuilt").value) || null,
    lotSize: document.getElementById("al-lotSize").value.trim(),
    garageSpaces: Number(document.getElementById("al-garage").value) || null,
    stories: Number(document.getElementById("al-stories").value) || null,
    features: addListingFeatureTags,
    mlsNumber: document.getElementById("al-mls").value.trim(),
    status: document.getElementById("al-status").value,
    listingUrl: document.getElementById("al-listingUrl").value.trim(),
    description: document.getElementById("al-description").value.trim(),
    notes: document.getElementById("al-notes").value.trim(),
    photos: [],
    addedBy: user.uid,
    source: "manual",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (price && sqft) {
    data.pricePerSqft = Math.round(price / sqft);
  }

  try {
    // 1. Save the listing
    const docRef = await addDoc(collection(db, "listings"), data);

    // 2. Calculate match score against current client
    const listingForScore = { id: docRef.id, ...data };
    const result = calculateMatchScore(listingForScore, clientData);

    // 3. Create the match
    await addDoc(collection(db, "clientListingMatches"), {
      listingId: docRef.id,
      clientId,
      realtorId: user.uid,
      matchScore: result.score,
      matchBreakdown: result.breakdown,
      dealBreakerHits: result.dealBreakerHits,
      status: "interested",
      clientRating: null,
      clientFeedback: "",
      realtorNotes: "",
      matchedAt: serverTimestamp()
    });

    showToast("Listing added and matched!");
    closeAddListingModal();
    await loadMatches(user.uid);
  } catch (e) {
    console.error("Save listing error:", e);
    showToast("Failed to save listing.", "error");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save & Match";
  }
};

// Close modals on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modals = [
      { id: "file-preview-modal", close: () => closePreview() },
      { id: "activity-modal", close: () => closeActivityModal() },
      { id: "add-listing-modal", close: () => closeAddListingModal() },
      { id: "match-listing-modal", close: () => closeMatchListingPanel() },
      { id: "edit-match-modal", close: () => closeEditMatchModal() },
      { id: "compare-modal", close: () => closeCompareModal() },
      { id: "copy-client-modal", close: () => closeCopyToClientModal() },
      { id: "signature-modal", close: () => closeSignatureModal() },
      { id: "send-doc-modal", close: () => closeSendDocModal() },
      { id: "showing-modal", close: () => closeShowingModal() },
      { id: "complete-showing-modal", close: () => closeCompleteShowingModal() },
      { id: "followup-modal", close: () => closeFollowUpModal() }
    ];
    for (const m of modals) {
      if (document.getElementById(m.id).classList.contains("active")) { m.close(); return; }
    }
    const aiPanel = document.getElementById("ai-panel");
    if (aiPanel && aiPanel.classList.contains("open")) { window.toggleAiPanel(); }
  }
});

