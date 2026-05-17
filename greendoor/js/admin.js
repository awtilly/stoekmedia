import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, getDocs, getDoc, getCountFromServer,
  doc, updateDoc, setDoc, addDoc, orderBy, limit, startAfter,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, formatDate, showToast, escapeHtml, safeToDate } from "./auth.js";

/* ================================================================
   STATE
   ================================================================ */
let allRealtors = [];
let realtorClientCounts = {};
let currentRealtorId = null;   // for detail modal
let offboardState = {};        // wizard state
let auditLastDoc = null;       // pagination cursor
let tabsLoaded = { overview: false, users: false, audit: false, invitations: false, platform: false };

/* ================================================================
   INIT
   ================================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const profile = await getCurrentUser();
  if (!profile || profile.role !== "admin") {
    window.location.href = "/greendoor/app/dashboard";
    return;
  }

  // Tab switching
  document.querySelectorAll(".gd-tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Search & filter on Users tab
  document.getElementById("users-search").addEventListener("input", renderRealtorTable);
  document.getElementById("users-status-filter").addEventListener("change", renderRealtorTable);

  // Load Overview tab first
  await loadOverviewTab();

  document.getElementById("admin-loading").classList.add("gd-hidden");
  document.getElementById("admin-content").classList.remove("gd-hidden");
});

/* ================================================================
   TAB SWITCHING (lazy-load)
   ================================================================ */
function switchTab(tabName) {
  document.querySelectorAll(".gd-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
  document.querySelectorAll(".gd-tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${tabName}`));

  if (!tabsLoaded[tabName]) {
    if (tabName === "overview") loadOverviewTab();
    else if (tabName === "users") loadUsersTab();
    else if (tabName === "audit") loadAuditLog(true);
    else if (tabName === "invitations") loadInvitations();
    else if (tabName === "platform") loadPlatformSettings();
  }
}

/* ================================================================
   TAB 1: OVERVIEW
   ================================================================ */
async function loadOverviewTab() {
  if (tabsLoaded.overview) return;
  tabsLoaded.overview = true;

  try {
    // Load all realtors (shared across tabs)
    const realtorsQ = query(collection(db, "users"), where("role", "==", "realtor"));
    const realtorsSnap = await getDocs(realtorsQ);
    allRealtors = [];
    let activeCount = 0;
    realtorsSnap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      allRealtors.push(data);
      if (data.isActive && !data.offboardedAt) activeCount++;
    });

    document.getElementById("stat-realtors").textContent = activeCount;

    // Counts
    const [clientsC, filesC, listingsC, envelopesC, showingsC] = await Promise.all([
      getCountFromServer(collection(db, "clients")),
      getCountFromServer(collection(db, "files")),
      getCountFromServer(query(collection(db, "listings"), where("status", "==", "active"))).catch(() => ({ data: () => ({ count: 0 }) })),
      getCountFromServer(collection(db, "envelopes")).catch(() => ({ data: () => ({ count: 0 }) })),
      getCountFromServer(collection(db, "showings")).catch(() => ({ data: () => ({ count: 0 }) }))
    ]);

    document.getElementById("stat-clients").textContent = clientsC.data().count;
    document.getElementById("stat-files").textContent = filesC.data().count;
    document.getElementById("stat-listings").textContent = listingsC.data().count;
    document.getElementById("stat-envelopes").textContent = envelopesC.data().count;
    document.getElementById("stat-showings").textContent = showingsC.data().count;

    // New users this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const newUsers = allRealtors.filter(r => {
      if (!r.createdAt || r.offboardedAt) return false;
      const d = safeToDate(r.createdAt) || new Date();
      return d >= monthStart;
    });

    const newUsersEl = document.getElementById("new-users-list");
    if (newUsers.length === 0) {
      newUsersEl.innerHTML = '<p class="gd-empty-text">No new users this month.</p>';
    } else {
      newUsersEl.innerHTML = newUsers.map(u => `
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border);">
          <span style="font-weight: 500; color: var(--color-text-primary);">${escapeHtml(u.fullName) || "—"}</span>
          <span style="font-size: 0.78rem; color: var(--color-text-muted);">${formatDate(u.createdAt)}</span>
        </div>
      `).join("");
    }

    // Platform Activity (30 days)
    await loadActivityChart();

    // Recent Logins
    const loginSorted = [...allRealtors]
      .filter(r => r.lastLogin && !r.offboardedAt)
      .sort((a, b) => {
        const aDate = safeToDate(a.lastLogin) || new Date(0);
        const bDate = safeToDate(b.lastLogin) || new Date(0);
        return bDate - aDate;
      })
      .slice(0, 10);

    const loginsTbody = document.getElementById("recent-logins-tbody");
    if (loginSorted.length === 0) {
      loginsTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--color-text-muted);">No login data.</td></tr>';
    } else {
      loginsTbody.innerHTML = loginSorted.map(r => `
        <tr>
          <td style="color: var(--color-text-primary); font-weight: 500;">${escapeHtml(r.fullName) || "—"}</td>
          <td>${escapeHtml(r.email) || "—"}</td>
          <td>${formatDate(r.lastLogin)}</td>
        </tr>
      `).join("");
    }
  } catch (e) {
    console.error("Overview load error:", e);
  }
}

async function loadActivityChart() {
  const chartEl = document.getElementById("activity-chart");
  chartEl.innerHTML = '<div class="gd-spinner" style="margin:1rem auto;"></div>';
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const tsThirty = Timestamp.fromDate(thirtyDaysAgo);

    const activitiesSnap = await getDocs(
      query(collection(db, "activities"), where("timestamp", ">=", tsThirty))
    );

    const typeCounts = {};
    activitiesSnap.forEach(d => {
      const type = d.data().type || "other";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      chartEl.innerHTML = '<p class="gd-empty-text">No activity in the last 30 days.</p>';
      return;
    }

    const maxVal = entries[0][1];
    chartEl.innerHTML = entries.map(([type, count]) => {
      const pct = Math.round((count / maxVal) * 100);
      return `
        <div class="gd-admin-bar-row">
          <span class="gd-admin-bar-label">${type}</span>
          <div class="gd-admin-bar-track">
            <div class="gd-admin-bar-fill" style="width: ${pct}%;"></div>
          </div>
          <span class="gd-admin-bar-count">${count}</span>
        </div>
      `;
    }).join("");
  } catch (e) {
    console.error("Activity chart error:", e);
    chartEl.innerHTML = '<p class="gd-empty-text">Could not load activity data.</p>';
  }
}

/* ================================================================
   TAB 2: USERS
   ================================================================ */
async function loadUsersTab() {
  if (tabsLoaded.users) { renderRealtorTable(); return; }
  tabsLoaded.users = true;

  // Ensure realtors loaded
  if (allRealtors.length === 0) {
    const realtorsSnap = await getDocs(query(collection(db, "users"), where("role", "==", "realtor")));
    allRealtors = [];
    realtorsSnap.forEach(d => allRealtors.push({ id: d.id, ...d.data() }));
  }

  // Fetch client counts per realtor (parallel instead of sequential)
  const countPromises = allRealtors.map(r =>
    getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", r.id)))
      .then(c => { realtorClientCounts[r.id] = c.data().count; })
      .catch(() => { realtorClientCounts[r.id] = "—"; })
  );
  await Promise.all(countPromises);

  renderRealtorTable();
}

function getRealtorStatus(r) {
  if (r.offboardedAt) return "offboarded";
  if (!r.isActive) return "inactive";
  if (r.onboardingComplete === false && !r.lastLogin) return "onboarding";
  if (r.onboardingComplete === false && r.lastLogin) return "onboarding";
  return "active";
}

function getStatusBadge(status) {
  const map = {
    active: '<span class="gd-badge gd-badge-complete">Active</span>',
    inactive: '<span class="gd-badge gd-badge-inactive">Inactive</span>',
    onboarding: '<span class="gd-badge gd-badge-onboarding">Onboarding</span>',
    offboarded: '<span class="gd-badge gd-badge-offboarded">Offboarded</span>'
  };
  return map[status] || map.active;
}

function renderRealtorTable() {
  const search = (document.getElementById("users-search").value || "").toLowerCase();
  const statusFilter = document.getElementById("users-status-filter").value;

  let filtered = allRealtors.filter(r => {
    const status = getRealtorStatus(r);
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (search) {
      const haystack = `${r.fullName || ""} ${r.email || ""} ${r.company || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const tbody = document.getElementById("realtors-tbody");
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--color-text-muted);">No realtors found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const status = getRealtorStatus(r);
    const isOffboarded = status === "offboarded";
    return `
    <tr>
      <td style="color: var(--color-text-primary); font-weight: 500;">${escapeHtml(r.fullName) || "—"}</td>
      <td>${escapeHtml(r.email) || "—"}</td>
      <td>${escapeHtml(r.company) || "—"}</td>
      <td>${getStatusBadge(status)}</td>
      <td>
        <label class="gd-toggle">
          <input type="checkbox" ${r.isActive ? "checked" : ""} ${isOffboarded ? "disabled" : ""} onchange="toggleActive('${r.id}', this.checked)">
          <span class="gd-toggle-slider"></span>
        </label>
      </td>
      <td>${realtorClientCounts[r.id] ?? "—"}</td>
      <td>${formatDate(r.lastLogin)}</td>
      <td style="white-space: nowrap;">
        <button class="gd-btn gd-btn-sm" onclick="openRealtorDetail('${r.id}')">View</button>
        ${!isOffboarded ? `<button class="gd-btn gd-btn-sm gd-btn-danger" onclick="startOffboardFromTable('${r.id}')" style="margin-left: 0.25rem;">Offboard</button>` : ""}
      </td>
    </tr>
    `;
  }).join("");
}

/* ================================================================
   TAB 3: AUDIT LOG
   ================================================================ */
window.loadAuditLog = async function (reset) {
  if (reset) {
    auditLastDoc = null;
    tabsLoaded.audit = true;
  }

  const actionFilter = document.getElementById("audit-action-filter").value;
  const dateFrom = document.getElementById("audit-date-from").value;
  const dateTo = document.getElementById("audit-date-to").value;

  try {
    let q = collection(db, "adminAuditLog");
    const constraints = [orderBy("timestamp", "desc"), limit(50)];

    if (actionFilter !== "all") {
      constraints.unshift(where("action", "==", actionFilter));
    }
    if (dateFrom) {
      constraints.push(where("timestamp", ">=", Timestamp.fromDate(new Date(dateFrom))));
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      constraints.push(where("timestamp", "<=", Timestamp.fromDate(end)));
    }
    if (auditLastDoc) {
      constraints.push(startAfter(auditLastDoc));
    }

    const snap = await getDocs(query(q, ...constraints));
    const tbody = document.getElementById("audit-tbody");

    if (reset) tbody.innerHTML = "";

    if (snap.empty && reset) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--color-text-muted);">No audit entries found.</td></tr>';
      document.getElementById("audit-load-more").classList.add("gd-hidden");
      return;
    }

    snap.forEach(d => {
      const data = d.data();
      auditLastDoc = d;
      const actionBadge = getAuditBadge(data.action);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${formatDate(data.timestamp)}</td>
        <td>${actionBadge}</td>
        <td>${data.targetUser || "—"}</td>
        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${data.details || "—"}</td>
        <td>${data.adminName || "—"}</td>
      `;
      tbody.appendChild(row);
    });

    document.getElementById("audit-load-more").classList.toggle("gd-hidden", snap.size < 50);
  } catch (e) {
    console.error("Audit log error:", e);
    showToast("Failed to load audit log.", "error");
  }
};

function getAuditBadge(action) {
  const colors = {
    invite: "gd-badge-audit-invite",
    activate: "gd-badge-audit-activate",
    deactivate: "gd-badge-audit-deactivate",
    offboard: "gd-badge-audit-offboard",
    settings_change: "gd-badge-audit-settings",
    reassign: "gd-badge-audit-reassign"
  };
  return `<span class="gd-badge ${colors[action] || "gd-badge-other"}">${action || "unknown"}</span>`;
}

/* ================================================================
   TAB 4: INVITATIONS
   ================================================================ */
async function loadInvitations() {
  if (tabsLoaded.invitations) return;
  tabsLoaded.invitations = true;

  try {
    if (allRealtors.length === 0) {
      const snap = await getDocs(query(collection(db, "users"), where("role", "==", "realtor")));
      allRealtors = [];
      snap.forEach(d => allRealtors.push({ id: d.id, ...d.data() }));
    }

    const invited = allRealtors.filter(r => r.invitedBy);
    const tbody = document.getElementById("invitations-tbody");

    if (invited.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--color-text-muted);">No invitations found.</td></tr>';
      return;
    }

    tbody.innerHTML = invited.map(r => {
      let statusBadge;
      if (r.onboardingComplete === true) {
        statusBadge = '<span class="gd-badge gd-badge-complete">Accepted</span>';
      } else if (r.isActive === false && !r.onboardingComplete) {
        statusBadge = '<span class="gd-badge gd-badge-inactive">Expired</span>';
      } else {
        statusBadge = '<span class="gd-badge gd-badge-pending">Pending</span>';
      }

      const canResend = r.onboardingComplete !== true;

      return `
      <tr>
        <td style="color: var(--color-text-primary); font-weight: 500;">${escapeHtml(r.fullName) || "—"}</td>
        <td>${escapeHtml(r.email) || "—"}</td>
        <td>${escapeHtml(r.company) || "—"}</td>
        <td>${formatDate(r.lastInviteSentAt || r.createdAt)}</td>
        <td>${statusBadge}</td>
        <td>${canResend ? `<button class="gd-btn gd-btn-sm" onclick="resendInvite('${r.id}', this)">Resend</button>` : "—"}</td>
      </tr>
      `;
    }).join("");
  } catch (e) {
    console.error("Invitations error:", e);
  }
}

/* ================================================================
   TAB 5: PLATFORM SETTINGS
   ================================================================ */
async function loadPlatformSettings() {
  if (tabsLoaded.platform) return;
  tabsLoaded.platform = true;

  try {
    const [generalSnap, emailSnap, featuresSnap] = await Promise.all([
      getDoc(doc(db, "platformSettings", "general")),
      getDoc(doc(db, "platformSettings", "email")),
      getDoc(doc(db, "platformSettings", "features"))
    ]);

    if (generalSnap.exists()) {
      const d = generalSnap.data();
      document.getElementById("platform-name").value = d.platformName || "";
      document.getElementById("platform-support-email").value = d.supportEmail || "";
    }

    if (emailSnap.exists()) {
      const d = emailSnap.data();
      document.getElementById("email-from-name").value = d.fromName || "";
      document.getElementById("email-from-email").value = d.fromEmail || "";
      document.getElementById("email-footer").value = d.footer || "";
    }

    if (featuresSnap.exists()) {
      const d = featuresSnap.data();
      document.getElementById("flag-ai").checked = !!d.aiAssistant;
      document.getElementById("flag-esign").checked = !!d.eSignatures;
      document.getElementById("flag-listing-sync").checked = !!d.listingSync;
      document.getElementById("flag-registration").checked = !!d.registrationOpen;
    }
  } catch (e) {
    console.error("Platform settings error:", e);
  }
}

window.savePlatformGeneral = async function () {
  try {
    await setDoc(doc(db, "platformSettings", "general"), {
      platformName: document.getElementById("platform-name").value.trim(),
      supportEmail: document.getElementById("platform-support-email").value.trim(),
      updatedAt: Timestamp.now()
    }, { merge: true });
    showToast("Platform info saved.");
    await logAdminAction("settings_change", null, "Updated platform info");
  } catch (e) {
    console.error(e);
    showToast("Failed to save.", "error");
  }
};

window.savePlatformEmail = async function () {
  try {
    await setDoc(doc(db, "platformSettings", "email"), {
      fromName: document.getElementById("email-from-name").value.trim(),
      fromEmail: document.getElementById("email-from-email").value.trim(),
      footer: document.getElementById("email-footer").value.trim(),
      updatedAt: Timestamp.now()
    }, { merge: true });
    showToast("Email settings saved.");
    await logAdminAction("settings_change", null, "Updated email settings");
  } catch (e) {
    console.error(e);
    showToast("Failed to save.", "error");
  }
};

window.saveFeatureFlags = async function () {
  try {
    await setDoc(doc(db, "platformSettings", "features"), {
      aiAssistant: document.getElementById("flag-ai").checked,
      eSignatures: document.getElementById("flag-esign").checked,
      listingSync: document.getElementById("flag-listing-sync").checked,
      registrationOpen: document.getElementById("flag-registration").checked,
      updatedAt: Timestamp.now()
    }, { merge: true });
    showToast("Feature flags saved.");
    await logAdminAction("settings_change", null, "Updated feature flags");
  } catch (e) {
    console.error(e);
    showToast("Failed to save.", "error");
  }
};

window.exportPlatformData = function () {
  showToast("Export functionality coming soon.", "error");
};

/* ================================================================
   TOGGLE ACTIVE
   ================================================================ */
window.toggleActive = async function (userId, isActive) {
  try {
    await updateDoc(doc(db, "users", userId), { isActive });
    const realtor = allRealtors.find(r => r.id === userId);
    if (realtor) realtor.isActive = isActive;
    showToast(isActive ? "Realtor activated." : "Realtor deactivated.");
    await logAdminAction(isActive ? "activate" : "deactivate", realtor?.email || userId, `${isActive ? "Activated" : "Deactivated"} realtor ${realtor?.fullName || userId}`);
  } catch (e) {
    console.error("Toggle error:", e);
    showToast("Failed to update status.", "error");
  }
};

/* ================================================================
   INVITE MODAL
   ================================================================ */
window.openInviteModal = function () {
  document.getElementById("invite-modal").classList.add("active");
  document.getElementById("invite-name").value = "";
  document.getElementById("invite-email").value = "";
  document.getElementById("invite-company").value = "";
  document.getElementById("invite-error").style.display = "none";
  document.getElementById("invite-name").focus();
};

window.closeInviteModal = function () {
  document.getElementById("invite-modal").classList.remove("active");
};

window.sendInvite = async function () {
  const fullName = document.getElementById("invite-name").value.trim();
  const email = document.getElementById("invite-email").value.trim();
  const company = document.getElementById("invite-company").value.trim();
  const errorEl = document.getElementById("invite-error");
  const btn = document.getElementById("invite-send-btn");

  errorEl.style.display = "none";

  if (!fullName || !email) {
    errorEl.textContent = "Name and email are required.";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    const inviteRealtor = httpsCallable(functions, "inviteRealtor");
    await inviteRealtor({ email, fullName, company });
    showToast(`Invite sent to ${fullName}!`);
    closeInviteModal();
    await logAdminAction("invite", email, `Invited ${fullName} (${email})`);
    window.location.reload();
  } catch (err) {
    console.error("Invite error:", err);
    const msg = err.message || "Failed to send invite.";
    errorEl.textContent = msg;
    errorEl.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Send Invite";
  }
};

window.resendInvite = async function (userId, btn) {
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const resend = httpsCallable(functions, "resendInvite");
    await resend({ targetUid: userId });
    const realtor = allRealtors.find(r => r.id === userId);
    showToast(`Invite resent to ${realtor?.fullName || "realtor"}!`);
    await logAdminAction("invite", realtor?.email || userId, `Resent invite to ${realtor?.fullName || userId}`);
    btn.textContent = "Sent!";
  } catch (err) {
    console.error("Resend error:", err);
    showToast(err.message || "Failed to resend invite.", "error");
    btn.disabled = false;
    btn.textContent = "Resend";
  }
};

/* ================================================================
   REALTOR DETAIL MODAL
   ================================================================ */
window.openRealtorDetail = async function (realtorId) {
  currentRealtorId = realtorId;
  const r = allRealtors.find(x => x.id === realtorId);
  if (!r) return;

  document.getElementById("rd-name").textContent = r.fullName || "—";
  document.getElementById("rd-email").textContent = r.email || "—";
  document.getElementById("rd-company").textContent = r.company || "—";
  document.getElementById("rd-role").textContent = r.role || "realtor";
  document.getElementById("rd-created").textContent = formatDate(r.createdAt);
  document.getElementById("rd-last-login").textContent = formatDate(r.lastLogin);
  document.getElementById("rd-notes").value = r.adminNotes || "";

  // Hide offboard button if already offboarded
  document.getElementById("rd-offboard-btn").classList.toggle("gd-hidden", !!r.offboardedAt);

  // Usage stats
  try {
    const [clientsC, filesC, showingsC, envelopesC] = await Promise.all([
      getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", realtorId))),
      getCountFromServer(query(collection(db, "files"), where("realtorId", "==", realtorId))),
      getCountFromServer(query(collection(db, "showings"), where("realtorId", "==", realtorId))).catch(() => ({ data: () => ({ count: 0 }) })),
      getCountFromServer(query(collection(db, "envelopes"), where("realtorId", "==", realtorId))).catch(() => ({ data: () => ({ count: 0 }) }))
    ]);
    document.getElementById("rd-clients").textContent = clientsC.data().count;
    document.getElementById("rd-files").textContent = filesC.data().count;
    document.getElementById("rd-showings").textContent = showingsC.data().count;
    document.getElementById("rd-envelopes").textContent = envelopesC.data().count;
  } catch (e) {
    console.error("Detail stats error:", e);
  }

  document.getElementById("realtor-detail-modal").classList.add("active");
};

window.closeRealtorDetail = function () {
  document.getElementById("realtor-detail-modal").classList.remove("active");
  currentRealtorId = null;
};

window.saveRealtorNotes = async function () {
  if (!currentRealtorId) return;
  try {
    const notes = document.getElementById("rd-notes").value.trim();
    await updateDoc(doc(db, "users", currentRealtorId), { adminNotes: notes });
    const r = allRealtors.find(x => x.id === currentRealtorId);
    if (r) r.adminNotes = notes;
    showToast("Notes saved.");
  } catch (e) {
    console.error(e);
    showToast("Failed to save notes.", "error");
  }
};

/* ================================================================
   OFFBOARD WIZARD
   ================================================================ */
let offboardStep = 1;

window.startOffboard = function () {
  if (!currentRealtorId) return;
  closeRealtorDetail();
  initOffboardWizard(currentRealtorId);
};

window.startOffboardFromTable = function (realtorId) {
  initOffboardWizard(realtorId);
};

async function initOffboardWizard(realtorId) {
  const r = allRealtors.find(x => x.id === realtorId);
  if (!r) return;

  offboardState = {
    realtorId,
    realtorEmail: r.email,
    realtorName: r.fullName,
    clients: [],
    clientDispositions: {},
    options: {
      deleteFiles: false,
      deleteActivities: false,
      deleteEnvelopes: false,
      disableAuth: true
    }
  };

  offboardStep = 1;

  // Populate Step 1
  document.getElementById("ob-name").textContent = r.fullName || "—";
  document.getElementById("ob-email").textContent = r.email || "—";

  // Fetch counts
  try {
    const [clientsC, filesC, showingsC, envelopesC] = await Promise.all([
      getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", realtorId))),
      getCountFromServer(query(collection(db, "files"), where("realtorId", "==", realtorId))),
      getCountFromServer(query(collection(db, "showings"), where("realtorId", "==", realtorId))).catch(() => ({ data: () => ({ count: 0 }) })),
      getCountFromServer(query(collection(db, "envelopes"), where("realtorId", "==", realtorId))).catch(() => ({ data: () => ({ count: 0 }) }))
    ]);
    document.getElementById("ob-clients").textContent = clientsC.data().count;
    document.getElementById("ob-files").textContent = filesC.data().count;
    document.getElementById("ob-showings").textContent = showingsC.data().count;
    document.getElementById("ob-envelopes").textContent = envelopesC.data().count;
  } catch (e) {
    console.error(e);
  }

  // Fetch actual clients for Step 2
  try {
    const clientsSnap = await getDocs(query(collection(db, "clients"), where("realtorId", "==", realtorId)));
    offboardState.clients = [];
    clientsSnap.forEach(d => offboardState.clients.push({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(e);
  }

  // Reset checkboxes
  document.getElementById("ob-delete-files").checked = false;
  document.getElementById("ob-delete-activities").checked = false;
  document.getElementById("ob-delete-envelopes").checked = false;
  document.getElementById("ob-disable-auth").checked = true;
  document.getElementById("ob-confirm-email").value = "";
  document.getElementById("ob-error").style.display = "none";

  showOffboardStep(1);
  document.getElementById("offboard-modal").classList.add("active");
}

function showOffboardStep(step) {
  offboardStep = step;
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`offboard-step-${i}`).classList.toggle("gd-hidden", i !== step);
    const stepEl = document.querySelector(`.gd-admin-wizard-step[data-step="${i}"]`);
    stepEl.classList.toggle("active", i <= step);
  }

  document.getElementById("ob-back-btn").classList.toggle("gd-hidden", step === 1);
  document.getElementById("ob-next-btn").classList.toggle("gd-hidden", step === 4);
  document.getElementById("ob-confirm-btn").classList.toggle("gd-hidden", step !== 4);

  if (step === 2) renderOffboardClients();
  if (step === 4) renderOffboardSummary();
}

function renderOffboardClients() {
  const tbody = document.getElementById("ob-clients-tbody");
  const clients = offboardState.clients;

  if (clients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--color-text-muted);">No clients to reassign.</td></tr>';
    return;
  }

  // Build reassign target options from other active realtors
  const otherRealtors = allRealtors.filter(r => r.id !== offboardState.realtorId && r.isActive && !r.offboardedAt);
  const reassignOpts = otherRealtors.map(r => `<option value="reassign:${r.id}">${r.fullName}</option>`).join("");

  // Also populate bulk reassign select
  const bulkSelect = document.getElementById("ob-bulk-action");
  // Reset to base options
  bulkSelect.innerHTML = `
    <option value="">Select action for all...</option>
    <option value="unassign">Leave All Unassigned</option>
    <option value="delete">Delete All</option>
    ${otherRealtors.map(r => `<option value="reassign:${r.id}">Reassign All to ${r.fullName}</option>`).join("")}
  `;

  tbody.innerHTML = clients.map(c => {
    const currentVal = offboardState.clientDispositions[c.id] || "";
    return `
    <tr>
      <td style="color: var(--color-text-primary); font-weight: 500;">${c.fullName || "—"}</td>
      <td>${getStatusBadge(c.status || "lead")}</td>
      <td>
        <select class="gd-input" style="font-size: 0.8rem; padding: 0.4rem 0.6rem;" onchange="setClientDisposition('${c.id}', this.value)">
          <option value="unassign" ${currentVal === "unassign" || !currentVal ? "selected" : ""}>Leave Unassigned</option>
          ${reassignOpts.replace(`value="${currentVal}"`, `value="${currentVal}" selected`)}
          <option value="delete" ${currentVal === "delete" ? "selected" : ""}>Delete</option>
        </select>
      </td>
    </tr>
    `;
  }).join("");
}

window.setClientDisposition = function (clientId, value) {
  offboardState.clientDispositions[clientId] = value;
};

window.applyBulkClientAction = function () {
  const action = document.getElementById("ob-bulk-action").value;
  if (!action) return;

  offboardState.clients.forEach(c => {
    offboardState.clientDispositions[c.id] = action;
  });
  renderOffboardClients();
  showToast("Bulk action applied.");
};

function renderOffboardSummary() {
  offboardState.options.deleteFiles = document.getElementById("ob-delete-files").checked;
  offboardState.options.deleteActivities = document.getElementById("ob-delete-activities").checked;
  offboardState.options.deleteEnvelopes = document.getElementById("ob-delete-envelopes").checked;
  offboardState.options.disableAuth = document.getElementById("ob-disable-auth").checked;

  const lines = [];
  lines.push(`<strong>Realtor:</strong> ${offboardState.realtorName} (${offboardState.realtorEmail})`);

  // Client summary
  const dispositions = offboardState.clientDispositions;
  const reassignCount = Object.values(dispositions).filter(v => v && v.startsWith("reassign:")).length;
  const deleteCount = Object.values(dispositions).filter(v => v === "delete").length;
  const unassignCount = offboardState.clients.length - reassignCount - deleteCount;
  lines.push(`<strong>Clients:</strong> ${reassignCount} reassigned, ${deleteCount} deleted, ${unassignCount} unassigned`);

  // Data cleanup
  const cleanup = [];
  if (offboardState.options.deleteFiles) cleanup.push("files");
  if (offboardState.options.deleteActivities) cleanup.push("activities/showings/follow-ups/events");
  if (offboardState.options.deleteEnvelopes) cleanup.push("envelopes");
  if (offboardState.options.disableAuth) cleanup.push("disable auth");
  lines.push(`<strong>Data cleanup:</strong> ${cleanup.length > 0 ? cleanup.join(", ") : "none"}`);

  document.getElementById("ob-summary").innerHTML = lines.join("<br>");
}

window.offboardNext = function () {
  if (offboardStep < 4) showOffboardStep(offboardStep + 1);
};

window.offboardPrev = function () {
  if (offboardStep > 1) showOffboardStep(offboardStep - 1);
};

window.closeOffboardModal = function () {
  document.getElementById("offboard-modal").classList.remove("active");
  offboardState = {};
  offboardStep = 1;
};

window.executeOffboard = async function () {
  const confirmEmail = document.getElementById("ob-confirm-email").value.trim();
  const errorEl = document.getElementById("ob-error");

  if (confirmEmail !== offboardState.realtorEmail) {
    errorEl.textContent = "Email does not match. Please type the realtor's email exactly.";
    errorEl.style.display = "block";
    return;
  }

  errorEl.style.display = "none";
  const btn = document.getElementById("ob-confirm-btn");
  btn.disabled = true;
  btn.textContent = "Processing...";

  try {
    // Build client dispositions in function format
    const clientDisps = {};
    for (const [clientId, action] of Object.entries(offboardState.clientDispositions)) {
      if (action.startsWith("reassign:")) {
        clientDisps[clientId] = { action: "reassign", targetRealtorId: action.split(":")[1] };
      } else if (action === "delete") {
        clientDisps[clientId] = { action: "delete" };
      } else {
        clientDisps[clientId] = { action: "unassign" };
      }
    }

    // Also include clients not explicitly set (default to unassign)
    offboardState.clients.forEach(c => {
      if (!clientDisps[c.id]) {
        clientDisps[c.id] = { action: "unassign" };
      }
    });

    const offboardFn = httpsCallable(functions, "offboardRealtor");
    await offboardFn({
      targetUid: offboardState.realtorId,
      clientDispositions: clientDisps,
      options: offboardState.options
    });

    showToast(`${offboardState.realtorName} has been offboarded.`);
    closeOffboardModal();

    // Update local state
    const r = allRealtors.find(x => x.id === offboardState.realtorId);
    if (r) {
      r.isActive = false;
      r.offboardedAt = new Date();
    }

    renderRealtorTable();
  } catch (err) {
    console.error("Offboard error:", err);
    errorEl.textContent = err.message || "Offboard failed. Please try again.";
    errorEl.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Offboard";
  }
};

/* ================================================================
   AUDIT LOG HELPER
   ================================================================ */
async function logAdminAction(action, targetUser, details) {
  try {
    const user = auth.currentUser;
    const profile = await getCurrentUser();
    await addDoc(collection(db, "adminAuditLog"), {
      action,
      targetUser: targetUser || null,
      details: details || "",
      adminUid: user.uid,
      adminName: profile?.fullName || user.email,
      timestamp: Timestamp.now()
    });
  } catch (e) {
    console.error("Audit log write error:", e);
  }
}

/* ================================================================
   ESCAPE KEY HANDLER
   ================================================================ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modals = ["offboard-modal", "realtor-detail-modal", "invite-modal"];
    for (const id of modals) {
      const modal = document.getElementById(id);
      if (modal && modal.classList.contains("active")) {
        modal.classList.remove("active");
        break;
      }
    }
  }
});
