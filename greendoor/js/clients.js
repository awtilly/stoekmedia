import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, formatCurrency, timeAgo, statusLabel, showToast } from "./auth.js";

const askAssistant = httpsCallable(functions, "askAssistant");

let allClients = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  await loadClients(user.uid);
});

async function loadClients(uid) {
  try {
    const q = query(
      collection(db, "clients"),
      where("realtorId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderClients(allClients);
  } catch (e) {
    console.error("Load clients error:", e);
    showToast("Failed to load clients.", "error");
  }

  document.getElementById("clients-loading").classList.add("gd-hidden");
  document.getElementById("clients-table-wrap").classList.remove("gd-hidden");
}

function renderClients(clients) {
  const tbody = document.getElementById("clients-tbody");
  const wrap = document.getElementById("clients-table-wrap");
  const empty = document.getElementById("clients-empty");

  if (clients.length === 0) {
    wrap.classList.add("gd-hidden");
    empty.classList.remove("gd-hidden");
    return;
  }

  empty.classList.add("gd-hidden");
  wrap.classList.remove("gd-hidden");

  tbody.innerHTML = clients.map(c => `
    <tr>
      <td><a href="/greendoor/app/client-detail?id=${c.id}">${c.fullName || "—"}</a></td>
      <td><span class="gd-badge gd-badge-${c.status || "lead"}">${statusLabel(c.status || "lead")}</span></td>
      <td>${c.budgetMin || c.budgetMax ? formatCurrency(c.budgetMin) + " — " + formatCurrency(c.budgetMax) : "—"}</td>
      <td>${c.preferredLocations && c.preferredLocations.length ? c.preferredLocations[0] : "—"}</td>
      <td>${timeAgo(c.lastActivityDate)}</td>
      <td><button class="gd-ai-icon-btn" onclick="event.stopPropagation(); showAiSummary('${c.id}', this)" title="AI Quick Summary">&#10024;</button></td>
    </tr>
  `).join("");
}

/* --- Search & Filter --- */
document.getElementById("search-input").addEventListener("input", applyFilters);
document.getElementById("status-filter").addEventListener("change", applyFilters);

function applyFilters() {
  const search = document.getElementById("search-input").value.toLowerCase().trim();
  const status = document.getElementById("status-filter").value;

  let filtered = allClients;
  if (status) filtered = filtered.filter(c => c.status === status);
  if (search) {
    filtered = filtered.filter(c =>
      (c.fullName || "").toLowerCase().includes(search) ||
      (c.email || "").toLowerCase().includes(search) ||
      (c.phone || "").toLowerCase().includes(search)
    );
  }
  renderClients(filtered);
}

/* --- Add Client Modal --- */
window.openAddModal = function () {
  document.getElementById("add-modal").classList.add("active");
};

window.closeAddModal = function () {
  document.getElementById("add-modal").classList.remove("active");
};

window.saveClient = async function () {
  const fullName = document.getElementById("add-fullName").value.trim();
  const email = document.getElementById("add-email").value.trim();

  if (!fullName || !email) {
    showToast("Name and email are required.", "error");
    return;
  }

  const user = auth.currentUser;
  if (!user) return;

  const data = {
    realtorId: user.uid,
    fullName,
    email,
    phone: document.getElementById("add-phone").value.trim(),
    status: document.getElementById("add-status").value,
    budgetMin: Number(document.getElementById("add-budgetMin").value) || null,
    budgetMax: Number(document.getElementById("add-budgetMax").value) || null,
    timeline: document.getElementById("add-timeline").value,
    source: document.getElementById("add-source").value,
    notes: document.getElementById("add-notes").value.trim(),
    preferredLocations: [],
    propertyTypes: [],
    bedsMin: null,
    bedsMax: null,
    bathsMin: null,
    bathsMax: null,
    sqftMin: null,
    sqftMax: null,
    mustHaveFeatures: [],
    preApprovalStatus: "",
    preApprovalAmount: null,
    lastActivityDate: serverTimestamp(),
    createdAt: serverTimestamp()
  };

  try {
    const docRef = await addDoc(collection(db, "clients"), data);

    await addDoc(collection(db, "activities"), {
      clientId: docRef.id,
      realtorId: user.uid,
      type: "note",
      subject: "Client created",
      body: "",
      timestamp: serverTimestamp()
    });

    showToast("Client added successfully!");
    closeAddModal();

    document.getElementById("add-fullName").value = "";
    document.getElementById("add-email").value = "";
    document.getElementById("add-phone").value = "";
    document.getElementById("add-status").value = "lead";
    document.getElementById("add-budgetMin").value = "";
    document.getElementById("add-budgetMax").value = "";
    document.getElementById("add-timeline").value = "";
    document.getElementById("add-source").value = "";
    document.getElementById("add-notes").value = "";

    await loadClients(user.uid);
  } catch (e) {
    console.error("Save client error:", e);
    showToast("Failed to save client.", "error");
  }
};

/* ===== AI QUICK SUMMARY POPOVER ===== */
let aiPopoverCache = {};

function formatPopoverHtml(text) {
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

window.showAiSummary = async function (clientId, btnEl) {
  const popover = document.getElementById("ai-popover");
  const content = document.getElementById("ai-popover-content");

  // Position popover near the button
  const rect = btnEl.getBoundingClientRect();
  popover.style.top = (rect.bottom + window.scrollY + 8) + "px";
  popover.style.right = (window.innerWidth - rect.right) + "px";
  popover.style.left = "auto";
  popover.classList.add("active");

  // Check cache
  if (aiPopoverCache[clientId]) {
    content.innerHTML = formatPopoverHtml(aiPopoverCache[clientId]);
    return;
  }

  content.innerHTML = '<div class="gd-spinner"></div>';

  try {
    const result = await askAssistant({
      question: "Give me a 3-4 sentence quick summary of this client: their status, key preferences, when they were last contacted, and what I should do next.",
      clientId,
      context: "client_detail"
    });
    const text = result.data.response;
    aiPopoverCache[clientId] = text;
    content.innerHTML = formatPopoverHtml(text);
  } catch (err) {
    console.error("AI summary error:", err);
    content.innerHTML = '<span style="color: var(--color-error);">Could not load summary.</span>';
  }
};

window.closeAiPopover = function () {
  document.getElementById("ai-popover").classList.remove("active");
};

// Close popover when clicking outside
document.addEventListener("click", (e) => {
  const popover = document.getElementById("ai-popover");
  if (popover.classList.contains("active") && !popover.contains(e.target) && !e.target.classList.contains("gd-ai-icon-btn")) {
    popover.classList.remove("active");
  }
});
