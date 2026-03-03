import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, getCountFromServer, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, timeAgo, formatDate, formatDateTime } from "./auth.js";
import { startTour, checkAndResumeTour } from "./tour.js";

const askAssistant = httpsCallable(functions, "askAssistant");
const seedEmailTemplates = httpsCallable(functions, "seedEmailTemplates");

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
      limit(3)
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

  // --- Upcoming Showings ---
  try {
    const now = Timestamp.now();
    const clientCache = {};
    const clientsSnap = await getDocs(query(collection(db, "clients"), where("realtorId", "==", uid)));
    clientsSnap.forEach(d => { clientCache[d.id] = d.data().fullName || "Unknown"; });

    const showQ = query(
      collection(db, "showings"),
      where("realtorId", "==", uid),
      where("showingDate", ">=", now),
      orderBy("showingDate", "asc"),
      limit(5)
    );
    const showSnap = await getDocs(showQ);
    const showEl = document.getElementById("showings-list");

    const rows = [];
    showSnap.forEach(d => {
      const s = d.data();
      if (s.status === "cancelled") return;
      rows.push(`
        <div class="gd-showing-item">
          <span class="gd-showing-date">${formatDateTime(s.showingDate)}</span>
          <span class="gd-showing-address">${s.address || "—"}</span>
          <span class="gd-showing-client">${clientCache[s.clientId] || "—"}</span>
        </div>`);
    });
    if (rows.length > 0) showEl.innerHTML = rows.join("");
  } catch (e) {
    console.error("Showings error:", e);
  }

  document.getElementById("dashboard-loading").classList.add("gd-hidden");
  document.getElementById("dashboard-content").classList.remove("gd-hidden");

  // Start interactive tour for new users, or resume if mid-tour
  if (profile.showTour === true) {
    setTimeout(() => startTour("dashboard"), 600);
  } else {
    setTimeout(() => checkAndResumeTour(), 600);
  }

  // Seed email templates (no-op if already exist)
  seedEmailTemplates().catch(() => {});

  // Load AI briefing
  loadBriefing();
});

/* ===== AI DAILY BRIEFING ===== */
function formatBriefingHtml(text) {
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

async function loadBriefing() {
  const contentEl = document.getElementById("ai-briefing-content");
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = "gd_briefing_" + today;

  // Check sessionStorage cache
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    contentEl.innerHTML = formatBriefingHtml(cached);
    return;
  }

  contentEl.innerHTML = '<div class="gd-ai-briefing-loading"><div class="gd-spinner"></div><span>Generating your daily briefing...</span></div>';

  try {
    const result = await askAssistant({
      question: "3 bullet points max, one line each. 1) Any clients not contacted in 14+ days? 2) Today's showings? 3) One priority action. No headers, no intros, no sign-offs. Just the 3 bullets.",
      context: "dashboard"
    });
    const text = result.data.response;
    sessionStorage.setItem(cacheKey, text);
    contentEl.innerHTML = formatBriefingHtml(text);
  } catch (err) {
    console.error("Briefing error:", err);
    contentEl.innerHTML = '<div class="gd-ai-briefing-error">Could not load briefing. <button class="gd-btn gd-btn-sm" onclick="refreshBriefing()">Try Again</button></div>';
  }
}

window.refreshBriefing = function () {
  const today = new Date().toISOString().slice(0, 10);
  sessionStorage.removeItem("gd_briefing_" + today);
  loadBriefing();
};
