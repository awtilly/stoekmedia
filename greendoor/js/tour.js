import { auth, db } from "./firebase-config.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const TOUR_PAGES = ["dashboard", "clients", "calendar", "settings"];

const TOUR_STEPS = {
  dashboard: [
    { target: ".gd-sidebar-nav", title: "Navigation", description: "Jump between Dashboard, Clients, Listings, Calendar, and Settings." },
    { target: ".gd-quick-actions", title: "Quick Actions", description: "Add new clients and listings from here." },
    { target: ".gd-ai-fab", title: "Sage", description: "Click this anytime to chat with Sage — draft emails, schedule showings, or get suggestions." }
  ],
  clients: [
    { target: "#search-input", title: "Search Clients", description: "Quickly find any client by name, email, or phone number." },
    { target: "#status-filter", title: "Filter by Status", description: "Narrow your list to leads, active buyers, sellers, or clients under contract." },
    { target: ".gd-table-wrap", title: "Client List", description: "All your clients at a glance — click any row to view their full profile, activity, and documents." }
  ],
  calendar: [
    { target: ".gd-calendar-header", title: "Calendar", description: "See all your showings, follow-ups, and events in one place." },
    { target: ".gd-calendar-view-toggle", title: "Month & Week Views", description: "Switch between month and week views to plan your schedule." },
    { target: ".gd-calendar-legend", title: "Event Types", description: "Showings, follow-ups, and events are color-coded so you can scan at a glance." }
  ],
  settings: [
    { target: "#set-emailSignature", title: "Email Signature", description: "Your signature is appended to every outgoing email. Update it anytime here." },
    { target: "#template-list", title: "Document Templates", description: "Upload contracts and disclosures here for quick e-signature workflows with clients.", useParent: true },
    { target: ".gd-support-link", title: "Help & Support", description: "Questions? Visit the FAQ or reach out to our support team.", useParent: true }
  ]
};

const PAGE_URLS = {
  dashboard: "/greendoor/app/dashboard",
  clients: "/greendoor/app/clients",
  calendar: "/greendoor/app/calendar",
  settings: "/greendoor/app/settings"
};

const TOTAL_STEPS = TOUR_PAGES.reduce((sum, p) => sum + TOUR_STEPS[p].length, 0);

let currentPage = null;
let currentIdx = 0;
let overlayEl = null;
let tooltipEl = null;
let resizeHandler = null;

function globalStepNumber() {
  let count = 0;
  for (const p of TOUR_PAGES) {
    if (p === currentPage) return count + currentIdx + 1;
    count += TOUR_STEPS[p].length;
  }
  return count + 1;
}

export function startTour(page) {
  currentPage = page || "dashboard";
  currentIdx = 0;
  localStorage.setItem("gd_tour_page", currentPage);
  localStorage.setItem("gd_tour_step", "0");
  createOverlay();
  showStep();
}

export function checkAndResumeTour() {
  const savedPage = localStorage.getItem("gd_tour_page");
  if (!savedPage) return;

  // Determine which page we're currently on
  const path = window.location.pathname.replace(/\/$/, "");
  let thisPage = null;
  for (const [key, url] of Object.entries(PAGE_URLS)) {
    if (path === url || path === url + ".html") { thisPage = key; break; }
  }
  if (!thisPage || thisPage !== savedPage) return;

  currentPage = savedPage;
  currentIdx = parseInt(localStorage.getItem("gd_tour_step") || "0", 10);
  createOverlay();
  showStep();
}

function createOverlay() {
  // Clean up any existing overlay first
  if (overlayEl) overlayEl.remove();
  if (tooltipEl) tooltipEl.remove();
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);

  overlayEl = document.createElement("div");
  overlayEl.className = "gd-tour-overlay";
  document.body.appendChild(overlayEl);

  tooltipEl = document.createElement("div");
  tooltipEl.className = "gd-tour-tooltip";
  document.body.appendChild(tooltipEl);

  resizeHandler = () => showStep();
  window.addEventListener("resize", resizeHandler);
}

function showStep() {
  const steps = TOUR_STEPS[currentPage];
  if (!steps || currentIdx >= steps.length) {
    advanceToNextPage();
    return;
  }

  const step = steps[currentIdx];
  let targetEl = document.querySelector(step.target);
  if (!targetEl) {
    // Skip missing elements
    if (currentIdx < steps.length - 1) {
      currentIdx++;
      localStorage.setItem("gd_tour_step", String(currentIdx));
      showStep();
    } else {
      advanceToNextPage();
    }
    return;
  }
  if (step.useParent && targetEl.parentElement) {
    targetEl = targetEl.parentElement;
  }

  targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => positionSpotlight(targetEl, step), 350);
}

function positionSpotlight(targetEl, step) {
  const rect = targetEl.getBoundingClientRect();
  const pad = 8;

  overlayEl.style.top = (rect.top - pad + window.scrollY) + "px";
  overlayEl.style.left = (rect.left - pad) + "px";
  overlayEl.style.width = (rect.width + pad * 2) + "px";
  overlayEl.style.height = (rect.height + pad * 2) + "px";
  overlayEl.style.borderRadius = "12px";

  const globalIdx = globalStepNumber();
  const isFirst = globalIdx === 1;
  const isLast = globalIdx === TOTAL_STEPS;

  tooltipEl.innerHTML = `
    <div class="gd-tour-tooltip-header">
      <span class="gd-tour-tooltip-title">${step.title}</span>
      <button class="gd-tour-skip" onclick="window.__gdTourSkip()">Skip</button>
    </div>
    <p class="gd-tour-tooltip-desc">${step.description}</p>
    <div class="gd-tour-tooltip-footer">
      <span class="gd-tour-tooltip-counter">${globalIdx} / ${TOTAL_STEPS}</span>
      <div class="gd-tour-tooltip-btns">
        ${isFirst ? "" : '<button class="gd-btn gd-btn-ghost gd-btn-sm" onclick="window.__gdTourPrev()">Back</button>'}
        <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="window.__gdTourNext()">${isLast ? "Finish" : "Next"}</button>
      </div>
    </div>
  `;

  // Position tooltip
  const tooltipRect = tooltipEl.getBoundingClientRect();
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  let top = rect.bottom + pad + 12;
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let arrowPos = "top";

  if (top + tooltipRect.height > viewH - 20) {
    top = rect.top - pad - 12 - tooltipRect.height + window.scrollY;
    arrowPos = "bottom";
  } else {
    top += window.scrollY;
  }

  if (left < 12) left = 12;
  if (left + tooltipRect.width > viewW - 12) left = viewW - 12 - tooltipRect.width;

  tooltipEl.style.top = top + "px";
  tooltipEl.style.left = left + "px";
  tooltipEl.setAttribute("data-arrow", arrowPos);

  tooltipEl.classList.remove("gd-tour-tooltip-enter");
  void tooltipEl.offsetWidth;
  tooltipEl.classList.add("gd-tour-tooltip-enter");
}

function advanceToNextPage() {
  const pageIdx = TOUR_PAGES.indexOf(currentPage);
  if (pageIdx < TOUR_PAGES.length - 1) {
    const nextPage = TOUR_PAGES[pageIdx + 1];
    localStorage.setItem("gd_tour_page", nextPage);
    localStorage.setItem("gd_tour_step", "0");
    cleanup();
    window.location.href = PAGE_URLS[nextPage];
  } else {
    endTour();
  }
}

function goToPrevPage() {
  const pageIdx = TOUR_PAGES.indexOf(currentPage);
  if (pageIdx > 0) {
    const prevPage = TOUR_PAGES[pageIdx - 1];
    const lastStep = TOUR_STEPS[prevPage].length - 1;
    localStorage.setItem("gd_tour_page", prevPage);
    localStorage.setItem("gd_tour_step", String(lastStep));
    cleanup();
    window.location.href = PAGE_URLS[prevPage];
  }
}

function endTour() {
  cleanup();
  localStorage.removeItem("gd_tour_page");
  localStorage.removeItem("gd_tour_step");

  const user = auth.currentUser;
  if (user) {
    updateDoc(doc(db, "users", user.uid), { showTour: false }).catch(() => {});
  }
}

function cleanup() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
  if (resizeHandler) { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
}

// Global handlers for inline onclick
window.__gdTourNext = function () {
  const steps = TOUR_STEPS[currentPage];
  if (currentIdx < steps.length - 1) {
    currentIdx++;
    localStorage.setItem("gd_tour_step", String(currentIdx));
    showStep();
  } else {
    advanceToNextPage();
  }
};

window.__gdTourPrev = function () {
  if (currentIdx > 0) {
    currentIdx--;
    localStorage.setItem("gd_tour_step", String(currentIdx));
    showStep();
  } else {
    goToPrevPage();
  }
};

window.__gdTourSkip = function () {
  endTour();
};
