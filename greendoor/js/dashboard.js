import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, getCountFromServer, Timestamp,
  addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, timeAgo, formatDate, formatDateTime, escapeHtml, showToast } from "./auth.js";
import { startTour, checkAndResumeTour } from "./tour.js";
import { calculateMatchScore } from "./match-engine.js";

const askAssistant = httpsCallable(functions, "askAssistant");
const seedEmailTemplates = httpsCallable(functions, "seedEmailTemplates");
const parseListingUrlFn = httpsCallable(functions, "parseListingUrl");

let dashboardClients = [];
let dlFeatureTags = [];

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
                <a href="/greendoor/app/client-detail?id=${a.clientId}">${escapeHtml(clientName)}</a> — ${escapeHtml(a.subject) || "Activity"}
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
          <span class="gd-showing-address">${escapeHtml(s.address) || "—"}</span>
          <span class="gd-showing-client">${escapeHtml(clientCache[s.clientId]) || "—"}</span>
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
    const user = auth.currentUser;
    if (!user) return;
    const uid = user.uid;

    // Gather real CRM data for the briefing
    const contextData = { staleClients: [], todayShowings: [], totalClients: 0, activeBuyers: 0, activeSellers: 0, underContract: 0 };

    // Stale clients: not contacted in 14+ days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const clientsSnap = await getDocs(query(collection(db, "clients"), where("realtorId", "==", uid)));
    contextData.totalClients = clientsSnap.size;
    clientsSnap.forEach(d => {
      const c = d.data();
      if (c.status === "active_buyer") contextData.activeBuyers++;
      if (c.status === "active_seller") contextData.activeSellers++;
      if (c.status === "under_contract") contextData.underContract++;
      const lastDate = c.lastActivityDate
        ? (typeof c.lastActivityDate.toDate === "function" ? c.lastActivityDate.toDate() : new Date(c.lastActivityDate))
        : null;
      if (!lastDate || lastDate < fourteenDaysAgo) {
        contextData.staleClients.push({ name: c.fullName || "Unknown", daysSince: lastDate ? Math.floor((Date.now() - lastDate.getTime()) / 86400000) : null });
      }
    });

    // Today's showings (wrapped separately so a missing index doesn't block the briefing)
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const showQ = query(
        collection(db, "showings"),
        where("realtorId", "==", uid),
        where("showingDate", ">=", Timestamp.fromDate(todayStart)),
        orderBy("showingDate", "asc"),
        limit(10)
      );
      const showSnap = await getDocs(showQ);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      showSnap.forEach(d => {
        const s = d.data();
        if (s.status === "cancelled") return;
        const dt = s.showingDate?.toDate ? s.showingDate.toDate() : null;
        if (dt && dt <= todayEnd) {
          contextData.todayShowings.push({ address: s.address || "TBD", time: dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) });
        }
      });
    } catch (showErr) {
      console.warn("Showings query failed (may need index):", showErr);
    }

    const result = await askAssistant({
      question: "3 bullet points max, one line each. 1) Any clients not contacted in 14+ days? 2) Today's showings? 3) One priority action. No headers, no intros, no sign-offs. Just the 3 bullets.",
      context: "dashboard",
      contextData
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

/* ===== ADD LISTING MODAL (Dashboard) ===== */

const DL_FEATURE_SUGGESTIONS = [
  "Pool", "Garage", "Fireplace", "Hardwood Floors", "Open Floor Plan",
  "Basement", "Deck", "Patio", "Fenced Yard", "Central Air",
  "Updated Kitchen", "Stainless Appliances", "Granite Counters",
  "Walk-in Closet", "Laundry Room", "Home Office", "Smart Home",
  "Solar Panels", "Corner Lot", "Cul-de-sac", "New Roof"
];

async function loadDashboardClients() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const snap = await getDocs(query(collection(db, "clients"), where("realtorId", "==", user.uid)));
    dashboardClients = [];
    snap.forEach(d => { dashboardClients.push({ id: d.id, ...d.data() }); });
  } catch (e) {
    console.error("Load clients error:", e);
  }
  renderDashboardClientCheckboxes();
}

function renderDashboardClientCheckboxes() {
  const container = document.getElementById("dl-client-checkboxes");
  if (!container) return;
  if (dashboardClients.length === 0) {
    container.innerHTML = '<span class="gd-muted">No clients found.</span>';
    return;
  }
  container.innerHTML = dashboardClients.map(c =>
    `<label style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;">
      <input type="checkbox" class="dl-client-check" value="${c.id}">
      <span>${escapeHtml(c.fullName || "Unnamed")} <small class="gd-muted">(${c.status || "lead"})</small></span>
    </label>`
  ).join("");
}

function renderDlTags() {
  const el = document.getElementById("dl-tag-list");
  if (!el) return;
  el.innerHTML = dlFeatureTags.map((tag, i) =>
    `<span class="gd-tag">${escapeHtml(tag)}<button class="gd-tag-remove" onclick="removeDlTag(${i})">&times;</button></span>`
  ).join("");
}

function renderDlTagSuggestions() {
  const el = document.getElementById("dl-tag-suggestions");
  if (!el) return;
  const available = DL_FEATURE_SUGGESTIONS.filter(s => !dlFeatureTags.includes(s));
  el.innerHTML = available.map(s =>
    `<button class="gd-tag-suggestion" onclick="addDlTag('${s}')">${s}</button>`
  ).join("");
}

window.addDlTag = function (tag) {
  if (!dlFeatureTags.includes(tag)) {
    dlFeatureTags.push(tag);
    renderDlTags();
    renderDlTagSuggestions();
  }
};

window.removeDlTag = function (index) {
  dlFeatureTags.splice(index, 1);
  renderDlTags();
  renderDlTagSuggestions();
};

// Wire tag input Enter key
document.addEventListener("DOMContentLoaded", () => {
  const tagInput = document.getElementById("dl-tag-input");
  if (tagInput) {
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val && !dlFeatureTags.includes(val)) {
          dlFeatureTags.push(val);
          renderDlTags();
          renderDlTagSuggestions();
        }
        e.target.value = "";
      }
    });
  }
});

window.openDashboardAddListing = function () {
  // Clear form
  ["dl-url", "dl-address", "dl-city", "dl-state", "dl-zip", "dl-county", "dl-neighborhood",
   "dl-price", "dl-beds", "dl-baths", "dl-sqft", "dl-yearBuilt", "dl-lotSize",
   "dl-garage", "dl-stories", "dl-mls", "dl-listingUrl", "dl-description", "dl-notes"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const typeEl = document.getElementById("dl-type");
  if (typeEl) typeEl.value = "";
  const statusEl = document.getElementById("dl-status");
  if (statusEl) statusEl.value = "active";
  document.getElementById("dl-fetch-status").innerHTML = "";
  document.getElementById("dl-fetch-btn").disabled = false;
  document.getElementById("dl-fetch-btn").textContent = "Fetch";
  const saveBtn = document.getElementById("dl-save-btn");
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Listing"; }
  dlFeatureTags = [];
  renderDlTags();
  renderDlTagSuggestions();
  loadDashboardClients();
  document.getElementById("dash-add-listing-modal").classList.add("active");
};

window.closeDashboardAddListing = function () {
  document.getElementById("dash-add-listing-modal").classList.remove("active");
};

window.fetchDashboardListingFromUrl = async function () {
  const url = document.getElementById("dl-url").value.trim();
  if (!url) { showToast("Enter a listing URL.", "error"); return; }

  const btn = document.getElementById("dl-fetch-btn");
  const statusEl = document.getElementById("dl-fetch-status");
  btn.disabled = true;
  btn.textContent = "Fetching...";
  statusEl.innerHTML = '<div class="gd-spinner" style="display:inline-block;vertical-align:middle;margin-right:0.5rem;"></div> Extracting property details...';
  statusEl.className = "gd-url-fetch-result gd-url-fetch-loading";

  try {
    const result = await parseListingUrlFn({ url });
    const listing = result.data.listing;

    if (listing.address) {
      document.getElementById("dl-address").value = listing.address.street || listing.address.full || "";
      document.getElementById("dl-city").value = listing.address.city || "";
      document.getElementById("dl-state").value = listing.address.state || "";
      document.getElementById("dl-zip").value = listing.address.zip || "";
      document.getElementById("dl-county").value = listing.address.county || "";
      document.getElementById("dl-neighborhood").value = listing.address.neighborhood || "";
    }
    if (listing.listingPrice) document.getElementById("dl-price").value = listing.listingPrice;
    if (listing.bedrooms != null) document.getElementById("dl-beds").value = listing.bedrooms;
    if (listing.bathrooms != null) document.getElementById("dl-baths").value = listing.bathrooms;
    if (listing.squareFeet) document.getElementById("dl-sqft").value = listing.squareFeet;
    if (listing.propertyType) document.getElementById("dl-type").value = listing.propertyType;
    if (listing.yearBuilt) document.getElementById("dl-yearBuilt").value = listing.yearBuilt;
    if (listing.lotSize) document.getElementById("dl-lotSize").value = listing.lotSize;
    if (listing.garageSpaces) document.getElementById("dl-garage").value = listing.garageSpaces;
    if (listing.stories) document.getElementById("dl-stories").value = listing.stories;
    if (listing.mlsNumber) document.getElementById("dl-mls").value = listing.mlsNumber;
    if (listing.status) document.getElementById("dl-status").value = listing.status;
    if (listing.description) document.getElementById("dl-description").value = listing.description;
    document.getElementById("dl-listingUrl").value = url;

    if (listing.features && Array.isArray(listing.features)) {
      dlFeatureTags = listing.features.slice(0, 30);
      renderDlTags();
      renderDlTagSuggestions();
    }

    statusEl.innerHTML = "&#10003; Property details extracted!";
    statusEl.className = "gd-url-fetch-result gd-url-fetch-success";
  } catch (err) {
    console.error("Fetch listing error:", err);
    statusEl.innerHTML = "&#10007; Failed to extract details. Enter manually below.";
    statusEl.className = "gd-url-fetch-result gd-url-fetch-error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Fetch";
  }
};

/* --- Add Client Modal (Dashboard) --- */
window.openDashboardAddClient = function () {
  document.getElementById("dash-add-client-modal").classList.add("active");
};

window.closeDashboardAddClient = function () {
  document.getElementById("dash-add-client-modal").classList.remove("active");
};

window.saveDashboardClient = async function () {
  const fullName = document.getElementById("dash-add-fullName").value.trim();
  const email = document.getElementById("dash-add-email").value.trim();

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
    phone: document.getElementById("dash-add-phone").value.trim(),
    status: document.getElementById("dash-add-status").value,
    budgetMin: Number(document.getElementById("dash-add-budgetMin").value) || null,
    budgetMax: Number(document.getElementById("dash-add-budgetMax").value) || null,
    timeline: document.getElementById("dash-add-timeline").value,
    source: document.getElementById("dash-add-source").value,
    notes: document.getElementById("dash-add-notes").value.trim(),
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
    closeDashboardAddClient();

    // Clear form
    ["dash-add-fullName", "dash-add-email", "dash-add-phone", "dash-add-budgetMin", "dash-add-budgetMax", "dash-add-notes"].forEach(id => {
      document.getElementById(id).value = "";
    });
    document.getElementById("dash-add-status").value = "lead";
    document.getElementById("dash-add-timeline").value = "";
    document.getElementById("dash-add-source").value = "";
  } catch (e) {
    console.error("Save client error:", e);
    showToast("Failed to save client.", "error");
  }
};

window.saveDashboardListing = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const addrFull = document.getElementById("dl-address").value.trim();
  if (!addrFull) { showToast("Address is required.", "error"); return; }

  const saveBtn = document.getElementById("dl-save-btn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving..."; }

  const price = Number(document.getElementById("dl-price").value) || null;
  const sqft = Number(document.getElementById("dl-sqft").value) || null;

  const address = {
    full: [addrFull, document.getElementById("dl-city").value.trim(), document.getElementById("dl-state").value.trim(), document.getElementById("dl-zip").value.trim()].filter(Boolean).join(", "),
    street: addrFull,
    city: document.getElementById("dl-city").value.trim(),
    state: document.getElementById("dl-state").value.trim(),
    zip: document.getElementById("dl-zip").value.trim(),
    county: document.getElementById("dl-county").value.trim(),
    neighborhood: document.getElementById("dl-neighborhood").value.trim()
  };

  const data = {
    address,
    listingPrice: price,
    bedrooms: Number(document.getElementById("dl-beds").value) || null,
    bathrooms: Number(document.getElementById("dl-baths").value) || null,
    squareFeet: sqft,
    propertyType: document.getElementById("dl-type").value,
    yearBuilt: Number(document.getElementById("dl-yearBuilt").value) || null,
    lotSize: document.getElementById("dl-lotSize").value.trim(),
    garageSpaces: Number(document.getElementById("dl-garage").value) || null,
    stories: Number(document.getElementById("dl-stories").value) || null,
    features: dlFeatureTags,
    mlsNumber: document.getElementById("dl-mls").value.trim(),
    status: document.getElementById("dl-status").value,
    listingUrl: document.getElementById("dl-listingUrl").value.trim(),
    description: document.getElementById("dl-description").value.trim(),
    notes: document.getElementById("dl-notes").value.trim(),
    photos: [],
    addedBy: user.uid,
    source: "manual",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (price && sqft) {
    data.pricePerSqft = Math.round(price / sqft);
  }

  try {
    const docRef = await addDoc(collection(db, "listings"), data);

    // Match to selected clients
    const selectedClients = document.querySelectorAll(".dl-client-check:checked");
    const listingForScore = { id: docRef.id, ...data };

    for (const cb of selectedClients) {
      const cid = cb.value;
      const clientObj = dashboardClients.find(c => c.id === cid);
      if (!clientObj) continue;

      const result = calculateMatchScore(listingForScore, clientObj);
      await addDoc(collection(db, "clientListingMatches"), {
        listingId: docRef.id,
        clientId: cid,
        realtorId: user.uid,
        matchScore: result.score,
        matchBreakdown: result.breakdown,
        dealBreakerHits: result.dealBreakerHits,
        status: "interested",
        clientRating: null,
        clientFeedback: "",
        realtorNotes: "",
        matchedAt: serverTimestamp()
      });
    }

    const matchCount = selectedClients.length;
    showToast(matchCount > 0 ? `Listing added and matched to ${matchCount} client${matchCount > 1 ? "s" : ""}!` : "Listing added!");
    closeDashboardAddListing();
  } catch (e) {
    console.error("Save listing error:", e);
    showToast("Failed to save listing.", "error");
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Listing"; }
  }
};
