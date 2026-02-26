import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, getDocs, getCountFromServer,
  doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, formatDate, showToast } from "./auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const profile = await getCurrentUser();
  if (!profile || profile.role !== "admin") {
    window.location.href = "/greendoor/app/dashboard";
    return;
  }

  try {
    const [clientsCount, filesCount, propsCount] = await Promise.all([
      getCountFromServer(collection(db, "clients")),
      getCountFromServer(collection(db, "files")),
      getCountFromServer(collection(db, "bookmarkedProperties"))
    ]);

    document.getElementById("admin-clients").textContent = clientsCount.data().count;
    document.getElementById("admin-files").textContent = filesCount.data().count;
    document.getElementById("admin-properties").textContent = propsCount.data().count;
  } catch (e) {
    console.error("Admin stats error:", e);
  }

  try {
    const realtorsQ = query(collection(db, "users"), where("role", "==", "realtor"));
    const realtorsSnap = await getDocs(realtorsQ);

    let activeCount = 0;
    const realtors = [];
    realtorsSnap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      realtors.push(data);
      if (data.isActive) activeCount++;
    });

    document.getElementById("admin-realtors").textContent = activeCount;

    const tbody = document.getElementById("realtors-tbody");

    if (realtors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--color-text-muted);">No realtors found.</td></tr>';
    } else {
      const clientCounts = {};
      for (const r of realtors) {
        try {
          const c = await getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", r.id)));
          clientCounts[r.id] = c.data().count;
        } catch {
          clientCounts[r.id] = "—";
        }
      }

      tbody.innerHTML = realtors.map(r => {
        let statusBadge;
        if (r.onboardingComplete === true) {
          statusBadge = '<span class="gd-badge gd-badge-complete">Complete</span>';
        } else if (r.onboardingComplete === false && r.lastLogin) {
          statusBadge = '<span class="gd-badge gd-badge-onboarding">Onboarding</span>';
        } else if (r.onboardingComplete === false) {
          statusBadge = '<span class="gd-badge gd-badge-pending">Pending</span>';
        } else {
          statusBadge = '<span class="gd-badge gd-badge-complete">Active</span>';
        }
        return `
        <tr>
          <td style="color: var(--color-text-primary); font-weight: 500;">${r.fullName || "—"}</td>
          <td>${r.email || "—"}</td>
          <td>${r.company || "—"}</td>
          <td>${statusBadge}</td>
          <td>
            <label class="gd-toggle">
              <input type="checkbox" ${r.isActive ? "checked" : ""} onchange="toggleActive('${r.id}', this.checked)">
              <span class="gd-toggle-slider"></span>
            </label>
          </td>
          <td>${clientCounts[r.id]}</td>
          <td>${formatDate(r.lastLogin)}</td>
        </tr>
      `;
      }).join("");
    }
  } catch (e) {
    console.error("Load realtors error:", e);
  }

  document.getElementById("admin-loading").classList.add("gd-hidden");
  document.getElementById("admin-content").classList.remove("gd-hidden");
});

window.toggleActive = async function (userId, isActive) {
  try {
    await updateDoc(doc(db, "users", userId), { isActive });
    showToast(isActive ? "Realtor activated." : "Realtor deactivated.");
  } catch (e) {
    console.error("Toggle error:", e);
    showToast("Failed to update status.", "error");
  }
};

/* --- Invite Modal --- */
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("invite-modal");
    if (modal && modal.classList.contains("active")) {
      closeInviteModal();
    }
  }
});

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
    // Reload page to refresh table
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
