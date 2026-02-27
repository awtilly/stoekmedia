import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  collection, query, where, orderBy, serverTimestamp, Timestamp, limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getCurrentUser, showToast, formatCurrency, formatDate, statusLabel } from "./auth.js";
import { calculateMatchScore, matchScoreColor, matchScoreLabel } from "./match-engine.js";
import { initAddressAutocomplete } from "./address-autocomplete.js";

let allListings = [];
let filteredListings = [];
let allClients = [];
let editingListingId = null;
let currentDetailListing = null;
let featureTags = [];
let pendingPhotos = [];
let viewMode = "grid"; // "grid" | "list"
let quickMatchScores = {}; // listingId → { score, label, color }
let autocompleteInstance = null;

const FEATURE_SUGGESTIONS = [
  "Pool", "Garage", "Fireplace", "Hardwood Floors", "Open Floor Plan",
  "Basement", "Deck", "Patio", "Fenced Yard", "Central Air",
  "Updated Kitchen", "Stainless Appliances", "Granite Counters",
  "Walk-in Closet", "Laundry Room", "Home Office", "Smart Home",
  "Solar Panels", "Corner Lot", "Cul-de-sac", "New Roof",
  "Finished Basement", "In-ground Pool", "Screened Porch"
];

/* ===== AUTH GATE ===== */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const profile = await getCurrentUser();
  if (!profile) return;

  await loadListings(user.uid);
  await loadClients(user.uid);
  initFilters();
  initTagInput();
  initPhotoUpload();
  autocompleteInstance = initAddressAutocomplete("lst-address", onAddressSelected);
  initViewToggle();
  importBookmarkedPropertiesOnce(user.uid);

  document.getElementById("listings-loading").classList.add("gd-hidden");
  document.getElementById("listings-content").classList.remove("gd-hidden");
});

/* ===== LOAD DATA ===== */
async function loadListings(uid) {
  try {
    // Load all listings (shared collection — any auth user can read)
    const q = query(collection(db, "listings"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    allListings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    applyFilters();
  } catch (e) {
    console.error("Load listings error:", e);
    showToast("Failed to load listings.", "error");
  }
}

async function loadClients(uid) {
  try {
    const q = query(collection(db, "clients"), where("realtorId", "==", uid));
    const snap = await getDocs(q);
    allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Populate Quick Match client dropdown
    const select = document.getElementById("qm-client");
    select.innerHTML = '<option value="">— Choose a client —</option>';
    allClients.forEach(c => {
      select.innerHTML += `<option value="${c.id}">${c.fullName || "Unknown"}</option>`;
    });
  } catch (e) {
    console.error("Load clients error:", e);
  }
}

/* ===== FILTERS ===== */
function initFilters() {
  const inputs = ["filter-address", "filter-price-min", "filter-price-max", "filter-beds", "filter-baths", "filter-status", "filter-sort"];
  inputs.forEach(id => {
    document.getElementById(id).addEventListener("input", applyFilters);
    document.getElementById(id).addEventListener("change", applyFilters);
  });
  document.querySelectorAll(".filter-type-cb").forEach(cb => cb.addEventListener("change", applyFilters));
}

window.applyFilters = function applyFilters() {
  const search = (document.getElementById("filter-address").value || "").toLowerCase();
  const priceMin = Number(document.getElementById("filter-price-min").value) || 0;
  const priceMax = Number(document.getElementById("filter-price-max").value) || Infinity;
  const beds = Number(document.getElementById("filter-beds").value) || 0;
  const baths = Number(document.getElementById("filter-baths").value) || 0;
  const status = document.getElementById("filter-status").value;
  const sort = document.getElementById("filter-sort").value;
  const onlyMatches = document.getElementById("qm-only-matches").checked;

  const selectedTypes = [];
  document.querySelectorAll(".filter-type-cb:checked").forEach(cb => selectedTypes.push(cb.value));

  filteredListings = allListings.filter(l => {
    const addrStr = [l.address?.full, l.address?.city, l.address?.state, l.mlsNumber]
      .filter(Boolean).join(" ").toLowerCase();
    if (search && !addrStr.includes(search)) return false;
    if (l.listingPrice && (l.listingPrice < priceMin || l.listingPrice > priceMax)) return false;
    if (beds && (l.bedrooms || 0) < beds) return false;
    if (baths && (l.bathrooms || 0) < baths) return false;
    if (status && l.status !== status) return false;
    if (selectedTypes.length > 0 && !selectedTypes.includes(l.propertyType)) return false;
    if (onlyMatches && quickMatchScores[l.id] && quickMatchScores[l.id].score < 60) return false;
    return true;
  });

  // Sort
  filteredListings.sort((a, b) => {
    switch (sort) {
      case "price_asc": return (a.listingPrice || 0) - (b.listingPrice || 0);
      case "price_desc": return (b.listingPrice || 0) - (a.listingPrice || 0);
      case "dom": return calcDOM(a) - calcDOM(b);
      default: return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
    }
  });

  renderListings();
  logSearch(search);
};

window.clearFilters = function () {
  document.getElementById("filter-address").value = "";
  document.getElementById("filter-price-min").value = "";
  document.getElementById("filter-price-max").value = "";
  document.getElementById("filter-beds").value = "";
  document.getElementById("filter-baths").value = "";
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-sort").value = "newest";
  document.querySelectorAll(".filter-type-cb").forEach(cb => cb.checked = false);
  document.getElementById("qm-only-matches").checked = false;
  applyFilters();
};

function calcDOM(listing) {
  const listDate = listing.listDate?.toDate?.() || listing.createdAt?.toDate?.();
  if (!listDate) return 0;
  return Math.floor((Date.now() - listDate.getTime()) / 86400000);
}

/* ===== RENDER ===== */
function renderListings() {
  renderGrid();
  renderList();
}

function renderGrid() {
  const el = document.getElementById("listings-grid");
  if (filteredListings.length === 0) {
    el.innerHTML = `<div class="gd-empty" style="grid-column:1/-1;"><div class="gd-empty-icon">&#127968;</div><div class="gd-empty-text">No listings match your filters</div></div>`;
    return;
  }

  el.innerHTML = filteredListings.map(l => {
    const addr = l.address?.full || l.address?.street || "—";
    const photo = (l.photos && l.photos.length > 0) ? l.photos[0] : null;
    const dom = calcDOM(l);
    const qm = quickMatchScores[l.id];

    return `
      <div class="gd-listing-card" onclick="openListingDetail('${l.id}')">
        <div class="gd-listing-photo" ${photo ? `style="background-image:url('${photo}')"` : ""}>
          ${!photo ? '<span class="gd-listing-no-photo">&#127968;</span>' : ""}
          <span class="gd-listing-status-badge gd-lst-${l.status || "active"}">${statusLabelListing(l.status)}</span>
          ${qm ? `<span class="gd-match-badge-float" style="background:${qm.color}">${qm.score}%</span>` : ""}
        </div>
        <div class="gd-listing-card-body">
          <div class="gd-listing-price">${l.listingPrice ? formatCurrency(l.listingPrice) : "—"}</div>
          <div class="gd-listing-address">${addr}</div>
          <div class="gd-listing-meta">
            ${l.bedrooms != null ? `<span>${l.bedrooms} bd</span>` : ""}
            ${l.bathrooms != null ? `<span>${l.bathrooms} ba</span>` : ""}
            ${l.squareFeet ? `<span>${Number(l.squareFeet).toLocaleString()} sqft</span>` : ""}
          </div>
          <div class="gd-listing-footer">
            ${dom > 0 ? `<span class="gd-text-muted">${dom} DOM</span>` : ""}
            ${l.mlsNumber ? `<span class="gd-text-muted">MLS: ${l.mlsNumber}</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
}

function renderList() {
  const tbody = document.getElementById("listings-table-body");
  if (filteredListings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="gd-text-muted" style="text-align:center;padding:2rem;">No listings match your filters</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredListings.map(l => {
    const addr = l.address?.full || l.address?.street || "—";
    const dom = calcDOM(l);
    const qm = quickMatchScores[l.id];

    return `
      <tr onclick="openListingDetail('${l.id}')" style="cursor:pointer;">
        <td>
          ${addr}
          ${qm ? `<span class="gd-match-badge-inline" style="background:${qm.color}">${qm.score}%</span>` : ""}
        </td>
        <td>${l.listingPrice ? formatCurrency(l.listingPrice) : "—"}</td>
        <td>${l.bedrooms ?? "—"}</td>
        <td>${l.bathrooms ?? "—"}</td>
        <td>${l.squareFeet ? Number(l.squareFeet).toLocaleString() : "—"}</td>
        <td><span class="gd-badge gd-lst-${l.status || "active"}">${statusLabelListing(l.status)}</span></td>
        <td>${dom > 0 ? dom : "—"}</td>
        <td>${l.mlsNumber || "—"}</td>
      </tr>`;
  }).join("");
}

function statusLabelListing(status) {
  const map = {
    active: "Active",
    pending: "Pending",
    sold: "Sold",
    coming_soon: "Coming Soon",
    withdrawn: "Withdrawn"
  };
  return map[status] || "Active";
}

/* ===== VIEW TOGGLE ===== */
function initViewToggle() {
  document.querySelectorAll(".gd-view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      viewMode = btn.dataset.view;
      document.querySelectorAll(".gd-view-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("listings-grid").classList.toggle("gd-hidden", viewMode !== "grid");
      document.getElementById("listings-list").classList.toggle("gd-hidden", viewMode !== "list");
    });
  });
}

/* ===== ADDRESS AUTOCOMPLETE CALLBACK ===== */
function onAddressSelected(place) {
  document.getElementById("lst-address").value = place.full;
  document.getElementById("lst-city").value = place.city;
  document.getElementById("lst-state").value = place.state;
  document.getElementById("lst-zip").value = place.zip;
  document.getElementById("lst-county").value = place.county;
  document.getElementById("lst-neighborhood").value = place.neighborhood;
}

/* ===== TAG INPUT ===== */
function initTagInput() {
  const input = document.getElementById("lst-features-input");
  const sugEl = document.getElementById("lst-features-suggestions");

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !featureTags.includes(val)) {
        featureTags.push(val);
        renderTags();
      }
      input.value = "";
      sugEl.innerHTML = "";
    }
  });

  input.addEventListener("input", () => {
    const val = input.value.toLowerCase();
    if (val.length < 2) { sugEl.innerHTML = ""; return; }
    const matches = FEATURE_SUGGESTIONS.filter(s =>
      s.toLowerCase().includes(val) && !featureTags.includes(s)
    ).slice(0, 5);
    sugEl.innerHTML = matches.map(s =>
      `<button type="button" class="gd-tag-suggestion" onclick="addFeatureTag('${s}')">${s}</button>`
    ).join("");
  });
}

window.addFeatureTag = function (tag) {
  if (!featureTags.includes(tag)) {
    featureTags.push(tag);
    renderTags();
  }
  document.getElementById("lst-features-input").value = "";
  document.getElementById("lst-features-suggestions").innerHTML = "";
};

window.removeFeatureTag = function (tag) {
  featureTags = featureTags.filter(t => t !== tag);
  renderTags();
};

function renderTags() {
  const el = document.getElementById("lst-features-tags");
  el.innerHTML = featureTags.map(t =>
    `<span class="gd-tag">${t}<button type="button" class="gd-tag-remove" onclick="removeFeatureTag('${t}')">&times;</button></span>`
  ).join("");
}

/* ===== PHOTO UPLOAD ===== */
function initPhotoUpload() {
  const zone = document.getElementById("lst-photo-zone");
  const input = document.getElementById("lst-photo-input");

  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("dragover");
    handlePhotoFiles(e.dataTransfer.files);
  });

  input.addEventListener("change", () => {
    handlePhotoFiles(input.files);
    input.value = "";
  });
}

function handlePhotoFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    pendingPhotos.push(file);
  }
  renderPhotoPreview();
}

function renderPhotoPreview() {
  const el = document.getElementById("lst-photo-preview");
  el.innerHTML = pendingPhotos.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div class="gd-photo-thumb">
      <img src="${url}" alt="Photo">
      <button type="button" class="gd-photo-remove" onclick="removePendingPhoto(${i})">&times;</button>
    </div>`;
  }).join("");
}

window.removePendingPhoto = function (index) {
  pendingPhotos.splice(index, 1);
  renderPhotoPreview();
};

async function uploadPhotos(listingId) {
  const urls = [];
  for (const file of pendingPhotos) {
    const path = `listings/${listingId}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    const snap = await uploadBytesResumable(storageRef, file);
    const url = await getDownloadURL(snap.ref);
    urls.push(url);
  }
  return urls;
}

/* ===== ADD/EDIT LISTING MODAL ===== */
window.openAddListingModal = function (listingId) {
  editingListingId = listingId || null;
  document.getElementById("add-listing-title").textContent = listingId ? "Edit Listing" : "Add Listing";

  if (listingId) {
    const l = allListings.find(x => x.id === listingId);
    if (l) {
      document.getElementById("lst-address").value = l.address?.full || "";
      document.getElementById("lst-city").value = l.address?.city || "";
      document.getElementById("lst-state").value = l.address?.state || "";
      document.getElementById("lst-zip").value = l.address?.zip || "";
      document.getElementById("lst-county").value = l.address?.county || "";
      document.getElementById("lst-neighborhood").value = l.address?.neighborhood || "";
      document.getElementById("lst-price").value = l.listingPrice || "";
      document.getElementById("lst-beds").value = l.bedrooms ?? "";
      document.getElementById("lst-baths").value = l.bathrooms ?? "";
      document.getElementById("lst-sqft").value = l.squareFeet || "";
      document.getElementById("lst-type").value = l.propertyType || "";
      document.getElementById("lst-yearBuilt").value = l.yearBuilt || "";
      document.getElementById("lst-lotSize").value = l.lotSize || "";
      document.getElementById("lst-garage").value = l.garageSpaces ?? "";
      document.getElementById("lst-stories").value = l.stories ?? "";
      document.getElementById("lst-schoolDistrict").value = l.schoolDistrict || "";
      document.getElementById("lst-schoolRating").value = l.schoolRating || "";
      document.getElementById("lst-mlsNumber").value = l.mlsNumber || "";
      document.getElementById("lst-status").value = l.status || "active";
      document.getElementById("lst-listingUrl").value = l.listingUrl || "";
      document.getElementById("lst-virtualTour").value = l.virtualTourUrl || "";
      document.getElementById("lst-notes").value = l.notes || "";
      featureTags = [...(l.features || [])];
      renderTags();

      if (l.listDate?.toDate) {
        document.getElementById("lst-listDate").value = l.listDate.toDate().toISOString().slice(0, 10);
      }

      // Auto-calc price/sqft
      updatePricePerSqft();
    }
  } else {
    clearListingForm();
  }

  document.getElementById("add-listing-modal").classList.add("active");
};

window.closeAddListingModal = function () {
  document.getElementById("add-listing-modal").classList.remove("active");
};

function clearListingForm() {
  const ids = ["lst-address", "lst-city", "lst-state", "lst-zip", "lst-county", "lst-neighborhood",
    "lst-price", "lst-pricePerSqft", "lst-beds", "lst-baths", "lst-sqft", "lst-type",
    "lst-yearBuilt", "lst-lotSize", "lst-garage", "lst-stories", "lst-schoolDistrict",
    "lst-schoolRating", "lst-mlsNumber", "lst-listingUrl", "lst-virtualTour", "lst-notes", "lst-listDate"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("lst-status").value = "active";
  featureTags = [];
  pendingPhotos = [];
  renderTags();
  renderPhotoPreview();
}

function updatePricePerSqft() {
  const price = Number(document.getElementById("lst-price").value) || 0;
  const sqft = Number(document.getElementById("lst-sqft").value) || 0;
  const el = document.getElementById("lst-pricePerSqft");
  el.value = (price && sqft) ? Math.round(price / sqft) : "";
}

// Auto-calc price/sqft on change
document.getElementById("lst-price")?.addEventListener("input", updatePricePerSqft);
document.getElementById("lst-sqft")?.addEventListener("input", updatePricePerSqft);

window.saveListing = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const addrFull = document.getElementById("lst-address").value.trim();
  if (!addrFull) { showToast("Address is required.", "error"); return; }

  const price = Number(document.getElementById("lst-price").value) || null;

  const address = {
    full: addrFull,
    street: addrFull.split(",")[0]?.trim() || addrFull,
    city: document.getElementById("lst-city").value.trim(),
    state: document.getElementById("lst-state").value.trim(),
    zip: document.getElementById("lst-zip").value.trim(),
    county: document.getElementById("lst-county").value.trim(),
    neighborhood: document.getElementById("lst-neighborhood").value.trim(),
    lat: null,
    lng: null
  };

  const data = {
    address,
    listingPrice: price,
    bedrooms: Number(document.getElementById("lst-beds").value) || null,
    bathrooms: Number(document.getElementById("lst-baths").value) || null,
    squareFeet: Number(document.getElementById("lst-sqft").value) || null,
    propertyType: document.getElementById("lst-type").value,
    yearBuilt: Number(document.getElementById("lst-yearBuilt").value) || null,
    lotSize: document.getElementById("lst-lotSize").value.trim(),
    garageSpaces: Number(document.getElementById("lst-garage").value) || null,
    stories: Number(document.getElementById("lst-stories").value) || null,
    features: featureTags,
    schoolDistrict: document.getElementById("lst-schoolDistrict").value.trim(),
    schoolRating: Number(document.getElementById("lst-schoolRating").value) || null,
    mlsNumber: document.getElementById("lst-mlsNumber").value.trim(),
    status: document.getElementById("lst-status").value,
    listingUrl: document.getElementById("lst-listingUrl").value.trim(),
    virtualTourUrl: document.getElementById("lst-virtualTour").value.trim(),
    notes: document.getElementById("lst-notes").value.trim(),
    updatedAt: serverTimestamp()
  };

  const listDateVal = document.getElementById("lst-listDate").value;
  if (listDateVal) {
    data.listDate = Timestamp.fromDate(new Date(listDateVal));
  }

  if (price && data.squareFeet) {
    data.pricePerSqft = Math.round(price / data.squareFeet);
  }

  try {
    let listingId;
    if (editingListingId) {
      listingId = editingListingId;
      await updateDoc(doc(db, "listings", editingListingId), data);
    } else {
      data.addedBy = user.uid;
      data.source = "manual";
      data.createdAt = serverTimestamp();
      data.photos = [];
      const docRef = await addDoc(collection(db, "listings"), data);
      listingId = docRef.id;
    }

    // Upload photos
    if (pendingPhotos.length > 0) {
      const photoUrls = await uploadPhotos(listingId);
      const existing = allListings.find(x => x.id === listingId)?.photos || [];
      await updateDoc(doc(db, "listings", listingId), {
        photos: [...existing, ...photoUrls]
      });
    }

    showToast(editingListingId ? "Listing updated!" : "Listing added!");
    closeAddListingModal();
    await loadListings(user.uid);
  } catch (e) {
    console.error("Save listing error:", e);
    showToast("Failed to save listing.", "error");
  }
};

/* ===== LISTING DETAIL MODAL ===== */
window.openListingDetail = function (id) {
  const listing = allListings.find(l => l.id === id);
  if (!listing) return;
  currentDetailListing = listing;

  document.getElementById("detail-listing-address").textContent = listing.address?.full || "Listing Detail";

  // Photos gallery
  const gallery = document.getElementById("detail-photo-gallery");
  if (listing.photos && listing.photos.length > 0) {
    gallery.innerHTML = listing.photos.map(url =>
      `<div class="gd-gallery-img" style="background-image:url('${url}')"></div>`
    ).join("");
  } else {
    gallery.innerHTML = '<div class="gd-empty-sm">No photos</div>';
  }

  // Info
  const info = document.getElementById("detail-info");
  const dom = calcDOM(listing);
  info.innerHTML = `
    <div class="gd-detail-price">${listing.listingPrice ? formatCurrency(listing.listingPrice) : "—"}</div>
    <div class="gd-detail-row">
      <span class="gd-badge gd-lst-${listing.status || "active"}">${statusLabelListing(listing.status)}</span>
      ${dom > 0 ? `<span class="gd-text-muted">${dom} days on market</span>` : ""}
      ${listing.mlsNumber ? `<span class="gd-text-muted">MLS: ${listing.mlsNumber}</span>` : ""}
    </div>
    <div class="gd-detail-specs">
      ${listing.bedrooms != null ? `<div class="gd-detail-spec"><span class="num">${listing.bedrooms}</span><span class="lbl">Beds</span></div>` : ""}
      ${listing.bathrooms != null ? `<div class="gd-detail-spec"><span class="num">${listing.bathrooms}</span><span class="lbl">Baths</span></div>` : ""}
      ${listing.squareFeet ? `<div class="gd-detail-spec"><span class="num">${Number(listing.squareFeet).toLocaleString()}</span><span class="lbl">Sq Ft</span></div>` : ""}
      ${listing.yearBuilt ? `<div class="gd-detail-spec"><span class="num">${listing.yearBuilt}</span><span class="lbl">Year Built</span></div>` : ""}
      ${listing.lotSize ? `<div class="gd-detail-spec"><span class="num">${listing.lotSize}</span><span class="lbl">Lot</span></div>` : ""}
      ${listing.garageSpaces ? `<div class="gd-detail-spec"><span class="num">${listing.garageSpaces}</span><span class="lbl">Garage</span></div>` : ""}
    </div>
    ${listing.propertyType ? `<div class="gd-detail-field"><strong>Type:</strong> ${listing.propertyType}</div>` : ""}
    ${listing.features?.length ? `<div class="gd-detail-field"><strong>Features:</strong> ${listing.features.map(f => `<span class="gd-tag">${f}</span>`).join(" ")}</div>` : ""}
    ${listing.schoolDistrict ? `<div class="gd-detail-field"><strong>School:</strong> ${listing.schoolDistrict}${listing.schoolRating ? ` (${listing.schoolRating}/10)` : ""}</div>` : ""}
    ${listing.description ? `<div class="gd-detail-field"><strong>Description:</strong> ${listing.description}</div>` : ""}
    ${listing.notes ? `<div class="gd-detail-field"><strong>Notes:</strong> ${listing.notes}</div>` : ""}
    ${listing.listingUrl ? `<div class="gd-detail-field"><a href="${listing.listingUrl}" target="_blank" class="gd-property-link">View Original Listing &rarr;</a></div>` : ""}
    ${listing.virtualTourUrl ? `<div class="gd-detail-field"><a href="${listing.virtualTourUrl}" target="_blank" class="gd-property-link">Virtual Tour &rarr;</a></div>` : ""}
  `;

  // Client Matches tab
  renderDetailMatches(listing);

  // Reset tabs
  switchDetailTab("details");
  document.getElementById("listing-detail-modal").classList.add("active");
};

function renderDetailMatches(listing) {
  const el = document.getElementById("detail-matches");
  if (allClients.length === 0) {
    el.innerHTML = '<div class="gd-empty-sm">No clients to match against</div>';
    return;
  }

  const matches = allClients.map(c => {
    const result = calculateMatchScore(listing, c);
    return { client: c, ...result };
  }).filter(m => m.score > 0).sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    el.innerHTML = '<div class="gd-empty-sm">No matching clients</div>';
    return;
  }

  el.innerHTML = matches.map(m => `
    <div class="gd-match-row">
      <div class="gd-match-score-circle" style="border-color:${matchScoreColor(m.score)}">
        <span>${m.score}%</span>
      </div>
      <div class="gd-match-info">
        <a href="/greendoor/app/client-detail?id=${m.client.id}" class="gd-match-name">${m.client.fullName || "Unknown"}</a>
        <span class="gd-text-muted">${matchScoreLabel(m.score)}</span>
        ${m.dealBreakerHits.length > 0 ? `<span class="gd-match-dealbreaker">Deal breaker: ${m.dealBreakerHits.join(", ")}</span>` : ""}
      </div>
      <button class="gd-btn gd-btn-sm" onclick="matchListingToClient('${listing.id}', '${m.client.id}')">Match</button>
    </div>
  `).join("");
}

window.switchDetailTab = function (tab) {
  document.querySelectorAll(".gd-listing-detail-tabs .gd-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.dtab === tab);
  });
  document.querySelectorAll(".gd-dtab").forEach(t => {
    t.classList.toggle("active", t.id === "dtab-" + tab);
  });
};

window.closeListingDetail = function () {
  document.getElementById("listing-detail-modal").classList.remove("active");
  currentDetailListing = null;
};

window.editListingFromDetail = function () {
  if (!currentDetailListing) return;
  closeListingDetail();
  openAddListingModal(currentDetailListing.id);
};

window.deleteListingFromDetail = async function () {
  if (!currentDetailListing) return;
  if (!confirm("Delete this listing? This cannot be undone.")) return;

  const user = auth.currentUser;
  if (!user) return;

  try {
    await deleteDoc(doc(db, "listings", currentDetailListing.id));
    showToast("Listing deleted.");
    closeListingDetail();
    await loadListings(user.uid);
  } catch (e) {
    console.error("Delete listing error:", e);
    showToast("Failed to delete listing.", "error");
  }
};

/* ===== QUICK MATCH SIDEBAR ===== */
window.toggleQuickMatch = function () {
  document.getElementById("quick-match-sidebar").classList.toggle("active");
};

window.runQuickMatch = function () {
  const clientId = document.getElementById("qm-client").value;
  const prefsEl = document.getElementById("qm-prefs");
  const resultsEl = document.getElementById("qm-results");
  quickMatchScores = {};

  if (!clientId) {
    prefsEl.classList.add("gd-hidden");
    resultsEl.innerHTML = "";
    applyFilters();
    return;
  }

  const client = allClients.find(c => c.id === clientId);
  if (!client) return;

  // Show preferences summary
  prefsEl.classList.remove("gd-hidden");
  const prefs = [];
  if (client.budgetMin || client.budgetMax) prefs.push(`Budget: ${formatCurrency(client.budgetMin || 0)} — ${formatCurrency(client.budgetMax || 0)}`);
  if (client.preferredLocations?.length) prefs.push(`Locations: ${client.preferredLocations.join(", ")}`);
  if (client.propertyTypes?.length) prefs.push(`Types: ${client.propertyTypes.join(", ")}`);
  if (client.bedsMin || client.bedsMax) prefs.push(`Beds: ${client.bedsMin || "?"}-${client.bedsMax || "?"}`);
  if (client.bathsMin || client.bathsMax) prefs.push(`Baths: ${client.bathsMin || "?"}-${client.bathsMax || "?"}`);
  prefsEl.innerHTML = prefs.length > 0
    ? prefs.map(p => `<div class="gd-qm-pref">${p}</div>`).join("")
    : '<div class="gd-text-muted">No preferences set for this client</div>';

  // Score all listings
  allListings.forEach(l => {
    const result = calculateMatchScore(l, client);
    quickMatchScores[l.id] = {
      score: result.score,
      label: matchScoreLabel(result.score),
      color: matchScoreColor(result.score)
    };
  });

  // Show top matches in sidebar
  const sorted = Object.entries(quickMatchScores)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10);

  resultsEl.innerHTML = sorted.map(([lid, m]) => {
    const l = allListings.find(x => x.id === lid);
    if (!l) return "";
    return `
      <div class="gd-qm-result" onclick="openListingDetail('${lid}')">
        <span class="gd-match-badge-inline" style="background:${m.color}">${m.score}%</span>
        <span>${l.address?.full || "—"}</span>
        <span class="gd-text-muted">${l.listingPrice ? formatCurrency(l.listingPrice) : ""}</span>
      </div>`;
  }).join("");

  applyFilters();
};

window.matchListingToClient = async function (listingId, clientId) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    // Check if match already exists
    const q = query(
      collection(db, "clientListingMatches"),
      where("listingId", "==", listingId),
      where("clientId", "==", clientId),
      where("realtorId", "==", user.uid)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      showToast("This listing is already matched to this client.");
      return;
    }

    const listing = allListings.find(l => l.id === listingId);
    const client = allClients.find(c => c.id === clientId);
    const matchResult = calculateMatchScore(listing, client);

    await addDoc(collection(db, "clientListingMatches"), {
      listingId,
      clientId,
      realtorId: user.uid,
      matchScore: matchResult.score,
      matchBreakdown: matchResult.breakdown,
      dealBreakerHits: matchResult.dealBreakerHits,
      status: "interested",
      clientRating: null,
      clientFeedback: "",
      realtorNotes: "",
      matchedAt: serverTimestamp()
    });

    showToast(`Listing matched to ${client?.fullName || "client"}!`);
  } catch (e) {
    console.error("Match listing error:", e);
    showToast("Failed to match listing.", "error");
  }
};

/* ===== SEARCH HISTORY (silent) ===== */
let searchDebounce = null;
function logSearch(searchTerm) {
  if (!searchTerm || searchTerm.length < 3) return;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await addDoc(collection(db, "searchHistory"), {
        realtorId: user.uid,
        query: searchTerm,
        resultCount: filteredListings.length,
        filters: {
          priceMin: Number(document.getElementById("filter-price-min").value) || null,
          priceMax: Number(document.getElementById("filter-price-max").value) || null,
          beds: document.getElementById("filter-beds").value,
          baths: document.getElementById("filter-baths").value,
          status: document.getElementById("filter-status").value
        },
        searchedAt: serverTimestamp()
      });
    } catch (e) {
      // Silent — don't disrupt UX
    }
  }, 2000);
}

/* ===== IMPORT BOOKMARKED PROPERTIES (one-time migration) ===== */
async function importBookmarkedPropertiesOnce(uid) {
  const flagKey = "gd_listings_imported";
  if (localStorage.getItem(flagKey)) return;

  try {
    const q = query(collection(db, "bookmarkedProperties"), where("realtorId", "==", uid));
    const snap = await getDocs(q);
    if (snap.empty) {
      localStorage.setItem(flagKey, "1");
      return;
    }

    let imported = 0;
    for (const d of snap.docs) {
      const bp = d.data();

      // Check if listing already exists with same address
      const existing = allListings.find(l =>
        l.address?.full?.toLowerCase() === (bp.address || "").toLowerCase()
      );

      let listingId;
      if (existing) {
        listingId = existing.id;
      } else {
        // Create new listing
        const listingData = {
          address: { full: bp.address || "", street: bp.address || "", city: "", state: "", zip: "", county: "", neighborhood: "", lat: null, lng: null },
          listingPrice: bp.listingPrice || null,
          mlsNumber: bp.mlsNumber || "",
          status: "active",
          source: "import",
          addedBy: uid,
          photos: bp.photos || [],
          features: [],
          notes: bp.realtorNotes || "",
          listingUrl: bp.listingUrl || "",
          createdAt: bp.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        const ref = await addDoc(collection(db, "listings"), listingData);
        listingId = ref.id;
      }

      // Create clientListingMatch
      if (bp.clientId) {
        const matchQ = query(
          collection(db, "clientListingMatches"),
          where("listingId", "==", listingId),
          where("clientId", "==", bp.clientId),
          where("realtorId", "==", uid)
        );
        const matchSnap = await getDocs(matchQ);
        if (matchSnap.empty) {
          await addDoc(collection(db, "clientListingMatches"), {
            listingId,
            clientId: bp.clientId,
            realtorId: uid,
            matchScore: null,
            status: bp.status || "interested",
            clientRating: bp.clientRating || null,
            clientFeedback: bp.clientFeedback || "",
            realtorNotes: bp.realtorNotes || "",
            matchedAt: bp.createdAt || serverTimestamp()
          });
        }
      }
      imported++;
    }

    localStorage.setItem(flagKey, "1");
    if (imported > 0) {
      showToast(`Imported ${imported} properties to listings.`);
      await loadListings(uid);
    }
  } catch (e) {
    console.error("Import bookmarked properties error:", e);
  }
}
