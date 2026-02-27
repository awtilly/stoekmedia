import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, deleteDoc, addDoc, getDocs,
  collection, query, where, orderBy, serverTimestamp, Timestamp,
  getCountFromServer, limit
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

if (!clientId) {
  window.location.href = "/greendoor/app/clients";
}

/* --- Cloud Functions --- */
const askAssistant = httpsCallable(functions, "askAssistant");
const sendEmailFn = httpsCallable(functions, "sendEmail");
const sendForSignatureFn = httpsCallable(functions, "sendForSignature");
const checkSignatureStatusFn = httpsCallable(functions, "checkSignatureStatus");
const shareDocumentFn = httpsCallable(functions, "shareDocument");
const scrapeListingFn = httpsCallable(functions, "scrapeListing");

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
    await Promise.all([loadActivities(uid), loadFiles(uid), loadProperties(uid), loadEnvelopes(uid), loadShowings(uid), loadFollowUps(uid)]);

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
    const collections = ["activities", "files", "bookmarkedProperties", "showings", "followUps"];
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
      <span class="gd-file-name">${f.fileName}${signedBadge}</span>
      <span class="gd-badge gd-badge-${f.folder}">${f.folder}</span>
      <span class="gd-file-meta">${formatFileSize(f.fileSize)}</span>
      <span class="gd-file-meta">${formatDate(f.uploadedAt)}</span>
      <button class="gd-btn gd-btn-sm gd-file-send-btn" onclick="event.stopPropagation(); sendSingleFile('${f.id}')">Send</button>
      <a href="${f.downloadUrl}" target="_blank" class="gd-file-download" onclick="event.stopPropagation()">Download</a>
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
  filesEl.innerHTML = files.map(f => `<div class="gd-sig-file-row"><span class="gd-sig-file-name">${f.fileName}</span></div>`).join("");

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
    await uploadBytesResumable(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);
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
  allFiles.filter(f => ["contracts", "disclosures", "other"].includes(f.folder)).forEach(f => {
    select.innerHTML += `<option value="${f.id}">${f.fileName} (${f.folder})</option>`;
  });
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
  const fileId = e.target.value;
  if (!fileId) return;
  const f = allFiles.find(x => x.id === fileId);
  if (f && !sigFiles.some(sf => sf.fileUrl === f.downloadUrl)) {
    sigFiles.push({ fileUrl: f.downloadUrl, fileName: f.fileName });
    renderSigFiles();
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
    await sendForSignatureFn({
      clientId,
      files: sigFiles,
      signers: sigSigners,
      title: document.getElementById("sig-title").value.trim() || undefined,
      message: document.getElementById("sig-message").value.trim() || undefined,
      expiryDays: parseInt(document.getElementById("sig-expiry").value) || 30
    });
    showToast("Documents sent for signature!");
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

    list.innerHTML = pending.map(e => {
      const title = e.title || e.fileName;
      let signerInfo = "";
      if (e.signers && e.signers.length > 0) {
        const signed = e.signers.filter(s => s.status === "completed" || s.status === "signed").length;
        signerInfo = `<div class="gd-envelope-signers">${signed} of ${e.signers.length} signed</div>`;
      } else {
        signerInfo = `<span class="gd-envelope-signer">${e.signerName || ""}</span>`;
      }
      return `
      <div class="gd-envelope-row">
        <span class="gd-envelope-name">${title}</span>
        ${signerInfo}
        <span class="gd-badge-esig" style="background: ${statusColors[e.status] || "#6b7280"}">${statusLabel(e.status)}</span>
        <span class="gd-file-meta">${formatDate(e.sentAt)}</span>
        <button class="gd-btn gd-btn-sm" onclick="checkEnvelopeStatus('${e.documentId}')">Check Status</button>
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
  // Reset scrape UI
  const scrapeStatus = document.getElementById("prop-scrape-status");
  if (scrapeStatus) {
    scrapeStatus.classList.add("gd-hidden");
    scrapeStatus.className = "gd-scrape-status gd-hidden";
    scrapeStatus.textContent = "";
  }
  const scrapeUrl = document.getElementById("prop-scrape-url");
  if (scrapeUrl) scrapeUrl.value = "";
};

window.scrapeListingUrl = async function () {
  const urlInput = document.getElementById("prop-scrape-url");
  const statusEl = document.getElementById("prop-scrape-status");
  const btn = document.getElementById("prop-scrape-btn");
  const url = (urlInput.value || "").trim();

  if (!url) {
    showToast("Please paste a listing URL first.", "error");
    return;
  }

  // Show loading state
  statusEl.classList.remove("gd-hidden", "error", "success");
  statusEl.classList.add("loading");
  statusEl.innerHTML = '<div class="gd-spinner gd-spinner-sm"></div> Fetching listing details...';
  btn.disabled = true;

  try {
    const result = await scrapeListingFn({ url });
    const data = result.data?.data;

    if (!data) {
      throw new Error("No data returned");
    }

    // Auto-fill form fields
    if (data.address) document.getElementById("prop-address").value = data.address;
    if (data.mlsNumber) document.getElementById("prop-mlsNumber").value = data.mlsNumber;
    if (data.listingPrice) document.getElementById("prop-listingPrice").value = data.listingPrice;
    if (url) document.getElementById("prop-listingUrl").value = url;

    // Build a notes string from extra scraped data
    const extras = [];
    if (data.bedrooms != null) extras.push(`${data.bedrooms} bed`);
    if (data.bathrooms != null) extras.push(`${data.bathrooms} bath`);
    if (data.squareFeet != null) extras.push(`${Number(data.squareFeet).toLocaleString()} sqft`);
    if (data.yearBuilt) extras.push(`Built ${data.yearBuilt}`);
    if (data.lotSize) extras.push(`Lot: ${data.lotSize}`);
    if (data.propertyType) extras.push(data.propertyType);
    if (data.description) extras.push(data.description);

    if (extras.length > 0) {
      const notesField = document.getElementById("prop-realtorNotes");
      const existing = notesField.value.trim();
      notesField.value = existing ? `${existing}\n${extras.join(" | ")}` : extras.join(" | ");
    }

    statusEl.classList.remove("loading");
    statusEl.classList.add("success");
    statusEl.textContent = "Listing details filled in successfully!";
    showToast("Listing details auto-filled!");
  } catch (err) {
    console.error("Scrape error:", err);
    statusEl.classList.remove("loading");
    statusEl.classList.add("error");
    statusEl.textContent = err.message || "Failed to fetch listing. Try a different URL or fill in manually.";
  } finally {
    btn.disabled = false;
  }
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
        <div class="gd-showing-card-address">${s.address || "—"}</div>
        ${statusBadge}
      </div>
      <div class="gd-showing-card-meta">
        <span>${date}</span>
        ${price ? `<span>${price}</span>` : ""}
        ${s.mlsNumber ? `<span>MLS: ${s.mlsNumber}</span>` : ""}
        ${stars ? `<span class="gd-stars">${stars}</span>` : ""}
      </div>
      ${s.clientFeedback ? `<div style="font-size:0.8rem;color:#4b5563;margin-bottom:0.35rem;">${s.clientFeedback}</div>` : ""}
      ${s.realtorNotes ? `<div style="font-size:0.8rem;color:#6b7280;font-style:italic;margin-bottom:0.35rem;">${s.realtorNotes}</div>` : ""}
      ${actions ? `<div class="gd-showing-card-actions">${actions}</div>` : ""}
    </div>`;
}

window.openShowingModal = function (showingId) {
  editingShowingId = showingId || null;
  document.getElementById("showing-modal-title").textContent = showingId ? "Edit Showing" : "Add Showing";

  // Populate property dropdown
  const select = document.getElementById("show-property");
  select.innerHTML = '<option value="">— Manual entry —</option>';
  allProperties.forEach(p => {
    select.innerHTML += `<option value="${p.id}">${p.address} ${p.mlsNumber ? "(MLS: " + p.mlsNumber + ")" : ""}</option>`;
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
  const propId = document.getElementById("show-property").value;
  if (!propId) return;
  const p = allProperties.find(x => x.id === propId);
  if (p) {
    document.getElementById("show-address").value = p.address || "";
    document.getElementById("show-mls").value = p.mlsNumber || "";
    document.getElementById("show-price").value = p.listingPrice || "";
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

      showToast("Showing added!");
    }
    closeShowingModal();
    await loadShowings(user.uid);
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
          <div class="gd-followup-title">${f.title}</div>
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

/* ===== VOICE INPUT ===== */
let recognition = null;
let isListening = false;

window.toggleVoiceInput = function () {
  const micBtn = document.getElementById("ai-mic-btn");

  if (isListening) {
    if (recognition) recognition.stop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Voice input not supported in this browser.", "error");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  const input = document.getElementById("ai-input");

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("listening");
    input.placeholder = "Listening...";
  };

  recognition.onresult = (e) => {
    let transcript = "";
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    input.value = transcript;

    // Auto-send when speech is final
    if (e.results[e.results.length - 1].isFinal) {
      setTimeout(() => {
        if (input.value.trim()) {
          sendAiMessage();
        }
      }, 400);
    }
  };

  recognition.onerror = (e) => {
    console.error("Speech error:", e.error);
    if (e.error !== "aborted" && e.error !== "no-speech") {
      showToast("Couldn't hear you — try again.", "error");
    }
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening");
    input.placeholder = "Ask or speak to your AI assistant...";
    recognition = null;
  };

  recognition.start();
};

// Close modals on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modals = [
      { id: "file-preview-modal", close: () => closePreview() },
      { id: "activity-modal", close: () => closeActivityModal() },
      { id: "property-modal", close: () => closePropertyModal() },
      { id: "compare-modal", close: () => closeCompareModal() },
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
    if (aiPanel.classList.contains("open")) { toggleAiPanel(); }
  }
});

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

    // If the AI performed actions, refresh client data so the UI reflects changes
    if (result.data.actionsPerformed && result.data.actionsPerformed.length > 0) {
      const user = auth.currentUser;
      if (user) {
        await loadClient(user.uid);
      }
    }
  } catch (err) {
    removeTypingIndicator();
    const msg = err.message || "Something went wrong. Please try again.";
    addAiMessage(msg, "error");
  }
  btn.disabled = false;
};
