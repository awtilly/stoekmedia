import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, formatCurrency, timeAgo, statusLabel, showToast } from "./auth.js";

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
