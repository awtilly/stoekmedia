import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, formatCurrency, timeAgo, statusLabel, showToast, escapeHtml } from "./auth.js";
import { checkAndResumeTour } from "./tour.js";

const askAssistant = httpsCallable(functions, "askAssistant");

let allClients = [];

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

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
    showToast("Could not load clients. Please refresh the page.", "error");
  }

  document.getElementById("clients-loading").classList.add("gd-hidden");
  document.getElementById("clients-table-wrap").classList.remove("gd-hidden");

  setTimeout(() => checkAndResumeTour(), 400);
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
      <td><a href="/greendoor/app/client-detail?id=${c.id}">${escapeHtml(c.fullName) || "—"}</a></td>
      <td><span class="gd-badge gd-badge-${c.status || "lead"}">${statusLabel(c.status || "lead")}</span></td>
      <td class="gd-hide-mobile">${c.budgetMin || c.budgetMax ? formatCurrency(c.budgetMin) + " — " + formatCurrency(c.budgetMax) : "—"}</td>
      <td class="gd-hide-mobile">${c.preferredLocations && c.preferredLocations.length ? c.preferredLocations[0] : "—"}</td>
      <td class="gd-hide-mobile">${timeAgo(c.lastActivityDate)}</td>
      <td><button class="gd-ai-icon-btn" onclick="event.stopPropagation(); showAiSummary('${c.id}', this)" title="Sage Summary">&#10024;</button></td>
    </tr>
  `).join("");
}

/* --- Search & Filter --- */
document.getElementById("search-input").addEventListener("input", debounce(applyFilters, 300));
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

  // Duplicate detection by email
  const dupeMatch = allClients.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());
  if (dupeMatch) {
    const confirmed = confirm(`A client with email "${email}" already exists (${dupeMatch.fullName}). Add anyway?`);
    if (!confirmed) return;
  }

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

  // Position popover near the button with viewport boundary checking
  const rect = btnEl.getBoundingClientRect();
  const isMobile = window.innerWidth <= 640;

  if (isMobile) {
    popover.style.position = "fixed";
    popover.style.top = "auto";
    popover.style.bottom = "1rem";
    popover.style.left = "1rem";
    popover.style.right = "1rem";
    popover.style.maxHeight = "60vh";
    popover.style.overflowY = "auto";
  } else {
    popover.style.position = "";
    popover.style.bottom = "";
    popover.style.maxHeight = "";
    popover.style.overflowY = "";
    let topPos = rect.bottom + window.scrollY + 8;
    // Ensure popover doesn't overflow bottom of viewport
    if (rect.bottom + 250 > window.innerHeight) {
      topPos = rect.top + window.scrollY - 250;
    }
    popover.style.top = topPos + "px";
    let rightPos = window.innerWidth - rect.right;
    if (rightPos < 8) rightPos = 8;
    popover.style.right = rightPos + "px";
    popover.style.left = "auto";
  }
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

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("add-modal");
    if (modal.classList.contains("active")) { closeAddModal(); return; }
    const popover = document.getElementById("ai-popover");
    if (popover.classList.contains("active")) { closeAiPopover(); }
  }
});

// Close popover when clicking outside
document.addEventListener("click", (e) => {
  const popover = document.getElementById("ai-popover");
  if (popover.classList.contains("active") && !popover.contains(e.target) && !e.target.classList.contains("gd-ai-icon-btn")) {
    popover.classList.remove("active");
  }
});
