import { auth, db, storage } from "./firebase-config.js";
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

if (!clientId) {
  window.location.href = "/greendoor/app/clients";
}

/* --- Auth gate --- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  await loadClient(user.uid);
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
    await Promise.all([loadActivities(uid), loadFiles(uid), loadProperties(uid)]);

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
  const titles = { note: "Add Note", call: "Log Call", email: "Log Email" };
  document.getElementById("activity-modal-title").textContent = titles[type] || "Add Activity";
  document.getElementById("act-subject").value = "";
  document.getElementById("act-body").value = "";
  document.getElementById("act-duration").value = "";

  document.getElementById("activity-email-to").classList.toggle("gd-hidden", type !== "email");
  document.getElementById("activity-duration-group").classList.toggle("gd-hidden", type !== "call");
  document.getElementById("email-note").classList.toggle("gd-hidden", type !== "email");

  if (type === "email" && clientData) {
    document.getElementById("act-to").value = clientData.email || "";
  }

  document.getElementById("act-body-label").textContent = type === "call" ? "Summary" : "Body";
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

  el.innerHTML = filtered.map(f => `
    <div class="gd-file-row">
      <span class="gd-file-name">${f.fileName}</span>
      <span class="gd-badge gd-badge-${f.folder}">${f.folder}</span>
      <span class="gd-file-meta">${formatFileSize(f.fileSize)}</span>
      <span class="gd-file-meta">${formatDate(f.uploadedAt)}</span>
      <a href="${f.downloadUrl}" target="_blank" class="gd-file-download">Download</a>
    </div>
  `).join("");
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
