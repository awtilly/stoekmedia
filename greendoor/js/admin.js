import { auth, db } from "./firebase-config.js";
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
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--color-text-muted);">No realtors found.</td></tr>';
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

      tbody.innerHTML = realtors.map(r => `
        <tr>
          <td style="color: var(--color-text-primary); font-weight: 500;">${r.fullName || "—"}</td>
          <td>${r.email || "—"}</td>
          <td>${r.company || "—"}</td>
          <td>
            <label class="gd-toggle">
              <input type="checkbox" ${r.isActive ? "checked" : ""} onchange="toggleActive('${r.id}', this.checked)">
              <span class="gd-toggle-slider"></span>
            </label>
          </td>
          <td>${clientCounts[r.id]}</td>
          <td>${formatDate(r.lastLogin)}</td>
        </tr>
      `).join("");
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
