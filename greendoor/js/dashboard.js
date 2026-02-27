import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, getCountFromServer, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, timeAgo, formatDate, formatDateTime } from "./auth.js";

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

  // Load Today's Schedule
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayStartTs = Timestamp.fromDate(todayStart);
    const todayEndTs = Timestamp.fromDate(todayEnd);

    // Ensure we have client name cache
    const clientCache2 = {};
    const clientsSnap2 = await getDocs(query(collection(db, "clients"), where("realtorId", "==", uid)));
    clientsSnap2.forEach(d => { clientCache2[d.id] = d.data().fullName || "Unknown"; });

    const scheduleItems = [];

    // Showings today (new collection)
    const showingsQ = query(
      collection(db, "showings"),
      where("realtorId", "==", uid),
      where("showingDate", ">=", todayStartTs),
      where("showingDate", "<=", todayEndTs)
    );
    const showingsSnap = await getDocs(showingsQ);
    showingsSnap.forEach(d => {
      const s = d.data();
      if (s.status === "cancelled") return;
      scheduleItems.push({
        time: s.showingDate.toDate(),
        type: "showing",
        title: `Showing: ${s.address || "—"}`,
        subtitle: clientCache2[s.clientId] || "",
        clientId: s.clientId
      });
    });

    // Follow-ups due today
    const fuQ = query(
      collection(db, "followUps"),
      where("realtorId", "==", uid),
      where("dueDate", ">=", todayStartTs),
      where("dueDate", "<=", todayEndTs)
    );
    const fuSnap = await getDocs(fuQ);
    fuSnap.forEach(d => {
      const f = d.data();
      if (f.status !== "pending") return;
      scheduleItems.push({
        time: f.dueDate.toDate(),
        type: "followup",
        title: f.title || "Follow-up",
        subtitle: clientCache2[f.clientId] || "",
        clientId: f.clientId
      });
    });

    // Custom events today
    const evQ = query(
      collection(db, "events"),
      where("realtorId", "==", uid),
      where("startDate", ">=", todayStartTs),
      where("startDate", "<=", todayEndTs)
    );
    const evSnap = await getDocs(evQ);
    evSnap.forEach(d => {
      const e = d.data();
      scheduleItems.push({
        time: e.startDate.toDate(),
        type: "event",
        title: e.title || "Event",
        subtitle: e.clientId ? (clientCache2[e.clientId] || "") : "",
        clientId: e.clientId
      });
    });

    // Sort by time
    scheduleItems.sort((a, b) => a.time - b.time);

    const scheduleEl = document.getElementById("today-schedule");
    if (scheduleItems.length > 0) {
      scheduleEl.innerHTML = scheduleItems.map(item => {
        const timeStr = item.time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const clientLink = item.clientId
          ? `<a href="/greendoor/app/client-detail?id=${item.clientId}" class="gd-schedule-link">${item.subtitle}</a>`
          : "";
        return `
          <div class="gd-schedule-item">
            <div class="gd-schedule-dot ${item.type}"></div>
            <span class="gd-schedule-time">${timeStr}</span>
            <span class="gd-schedule-title">${item.title}</span>
            ${clientLink}
          </div>`;
      }).join("");
    }
  } catch (e) {
    console.error("Schedule error:", e);
  }

  // Load new listings
  try {
    const listingsQ = query(
      collection(db, "listings"),
      where("addedBy", "==", uid),
      orderBy("createdAt", "desc"),
      limit(5)
    );
    const listingsSnap = await getDocs(listingsQ);
    const listingsEl = document.getElementById("new-listings");

    if (!listingsSnap.empty) {
      let html = "";
      listingsSnap.forEach(d => {
        const l = d.data();
        const addr = l.address?.full || l.address?.street || "—";
        const price = l.listingPrice ? `$${Number(l.listingPrice).toLocaleString()}` : "";
        const meta = [l.bedrooms ? `${l.bedrooms}bd` : "", l.bathrooms ? `${l.bathrooms}ba` : "", l.squareFeet ? `${Number(l.squareFeet).toLocaleString()}sqft` : ""].filter(Boolean).join(" / ");
        html += `
          <div class="gd-new-listing-item" onclick="window.location.href='/greendoor/app/listings'" style="cursor:pointer;">
            <div class="gd-new-listing-addr">${addr}</div>
            <div class="gd-new-listing-meta">
              ${price ? `<span class="gd-new-listing-price">${price}</span>` : ""}
              ${meta ? `<span class="gd-text-muted">${meta}</span>` : ""}
              <span class="gd-badge gd-lst-${l.status || "active"}">${l.status || "active"}</span>
            </div>
          </div>`;
      });
      listingsEl.innerHTML = html;
    }
  } catch (e) {
    console.error("Listings error:", e);
  }

  document.getElementById("dashboard-loading").classList.add("gd-hidden");
  document.getElementById("dashboard-content").classList.remove("gd-hidden");

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
      question: "Give me my daily briefing. Summarize my current client pipeline, flag any clients I haven't contacted in over 14 days, note upcoming showings this week, and suggest 2-3 priority actions for today. Keep it concise.",
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
