import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, getCountFromServer, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, timeAgo, formatDate } from "./auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const profile = await getCurrentUser();
  if (!profile) return;

  document.getElementById("welcome-name").textContent = profile.fullName || "Agent";

  const uid = user.uid;

  try {
    const [totalSnap, buyerSnap, sellerSnap, contractSnap] = await Promise.all([
      getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", uid))),
      getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", uid), where("status", "==", "active_buyer"))),
      getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", uid), where("status", "==", "active_seller"))),
      getCountFromServer(query(collection(db, "clients"), where("realtorId", "==", uid), where("status", "==", "under_contract")))
    ]);

    document.getElementById("stat-total").textContent = totalSnap.data().count;
    document.getElementById("stat-buyers").textContent = buyerSnap.data().count;
    document.getElementById("stat-sellers").textContent = sellerSnap.data().count;
    document.getElementById("stat-contracts").textContent = contractSnap.data().count;
  } catch (e) {
    console.error("Stats error:", e);
  }

  try {
    const actQ = query(
      collection(db, "activities"),
      where("realtorId", "==", uid),
      orderBy("timestamp", "desc"),
      limit(10)
    );
    const actSnap = await getDocs(actQ);
    const feedEl = document.getElementById("activity-feed");

    if (!actSnap.empty) {
      const clientCache = {};
      const getClientName = async (clientId) => {
        if (clientCache[clientId]) return clientCache[clientId];
        const clientsQ = query(collection(db, "clients"), where("realtorId", "==", uid));
        const snap = await getDocs(clientsQ);
        snap.forEach(d => { clientCache[d.id] = d.data().fullName || "Unknown"; });
        return clientCache[clientId] || "Unknown";
      };

      let html = "";
      for (const d of actSnap.docs) {
        const a = d.data();
        const icons = { email: "&#128231;", call: "&#128222;", note: "&#128221;", sms: "&#128172;", file_share: "&#128193;", showing: "&#127968;" };
        const icon = icons[a.type] || "&#128221;";
        const clientName = await getClientName(a.clientId);
        html += `
          <div class="gd-activity-item">
            <div class="gd-activity-icon">${icon}</div>
            <div class="gd-activity-body">
              <div class="gd-activity-subject">
                <a href="/greendoor/app/client-detail?id=${a.clientId}">${clientName}</a> — ${a.subject || "Activity"}
              </div>
              <div class="gd-activity-meta">${timeAgo(a.timestamp)}</div>
            </div>
          </div>`;
      }
      feedEl.innerHTML = html;
    }
  } catch (e) {
    console.error("Activity feed error:", e);
  }

  try {
    const now = Timestamp.now();
    const showQ = query(
      collection(db, "bookmarkedProperties"),
      where("realtorId", "==", uid),
      where("showingDate", ">=", now),
      orderBy("showingDate", "asc"),
      limit(5)
    );
    const showSnap = await getDocs(showQ);
    const showEl = document.getElementById("showings-list");

    if (!showSnap.empty) {
      const clientCache = {};
      const clientsSnap = await getDocs(query(collection(db, "clients"), where("realtorId", "==", uid)));
      clientsSnap.forEach(d => { clientCache[d.id] = d.data().fullName; });

      let html = "";
      showSnap.forEach(d => {
        const p = d.data();
        html += `
          <div class="gd-showing-item">
            <span class="gd-showing-date">${formatDate(p.showingDate)}</span>
            <span class="gd-showing-address">${p.address || "—"}</span>
            <span class="gd-showing-client">${clientCache[p.clientId] || "—"}</span>
          </div>`;
      });
      showEl.innerHTML = html;
    }
  } catch (e) {
    console.error("Showings error:", e);
  }

  document.getElementById("dashboard-loading").classList.add("gd-hidden");
  document.getElementById("dashboard-content").classList.remove("gd-hidden");
});
