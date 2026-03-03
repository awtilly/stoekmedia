import { auth, db } from "./firebase-config.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const TOUR_STEPS = [
  {
    target: ".nav-links",
    title: "Navigation",
    description: "This is your main navigation. Jump between Dashboard, Clients, Calendar, and Settings."
  },
  {
    target: ".gd-quick-actions",
    title: "Quick Actions",
    description: "Add new clients and listings from here."
  },
  {
    target: "#ai-briefing",
    title: "AI Daily Briefing",
    description: "Your AI assistant generates a daily briefing with follow-up reminders and insights."
  },
  {
    target: ".gd-stats-row",
    title: "Stats Overview",
    description: "See your pipeline at a glance \u2014 total clients, active buyers/sellers, and contracts."
  },
  {
    target: "#activity-feed",
    title: "Recent Activity",
    description: "Every client interaction is logged here automatically.",
    useParent: true
  },
  {
    target: "#showings-list",
    title: "Upcoming Showings",
    description: "Your next property showings appear here. Schedule them from any client\u2019s page.",
    useParent: true
  },
  {
    target: ".gd-ai-fab",
    title: "AI Assistant",
    description: "Click this anytime to chat with your AI assistant \u2014 draft emails, schedule showings, or get suggestions."
  }
];

let currentIdx = 0;
let overlayEl = null;
let tooltipEl = null;
let resizeHandler = null;

export function startTour() {
  currentIdx = 0;
  createOverlay();
  showStep(currentIdx);
}

function createOverlay() {
  overlayEl = document.createElement("div");
  overlayEl.className = "gd-tour-overlay";
  document.body.appendChild(overlayEl);

  tooltipEl = document.createElement("div");
  tooltipEl.className = "gd-tour-tooltip";
  document.body.appendChild(tooltipEl);

  resizeHandler = () => showStep(currentIdx);
  window.addEventListener("resize", resizeHandler);
}

function showStep(idx) {
  const step = TOUR_STEPS[idx];
  let targetEl = document.querySelector(step.target);
  if (!targetEl) {
    // Skip missing elements
    if (idx < TOUR_STEPS.length - 1) { currentIdx++; showStep(currentIdx); }
    else endTour();
    return;
  }
  if (step.useParent && targetEl.parentElement) {
    targetEl = targetEl.parentElement;
  }

  // Scroll target into view
  targetEl.scrollIntoView({ behavior: "smooth", block: "center" });

  // Wait for scroll to settle, then position
  setTimeout(() => positionSpotlight(targetEl, step, idx), 350);
}

function positionSpotlight(targetEl, step, idx) {
  const rect = targetEl.getBoundingClientRect();
  const pad = 8;

  // Spotlight cutout via box-shadow
  overlayEl.style.top = (rect.top - pad + window.scrollY) + "px";
  overlayEl.style.left = (rect.left - pad) + "px";
  overlayEl.style.width = (rect.width + pad * 2) + "px";
  overlayEl.style.height = (rect.height + pad * 2) + "px";
  overlayEl.style.borderRadius = "12px";

  // Build tooltip content
  const isFirst = idx === 0;
  const isLast = idx === TOUR_STEPS.length - 1;

  tooltipEl.innerHTML = `
    <div class="gd-tour-tooltip-header">
      <span class="gd-tour-tooltip-title">${step.title}</span>
      <button class="gd-tour-skip" onclick="window.__gdTourSkip()">Skip</button>
    </div>
    <p class="gd-tour-tooltip-desc">${step.description}</p>
    <div class="gd-tour-tooltip-footer">
      <span class="gd-tour-tooltip-counter">${idx + 1} / ${TOUR_STEPS.length}</span>
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

  // Default: below the target
  let top = rect.bottom + pad + 12;
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let arrowPos = "top";

  // If not enough space below, place above
  if (top + tooltipRect.height > viewH - 20) {
    top = rect.top - pad - 12 - tooltipRect.height + window.scrollY;
    arrowPos = "bottom";
  } else {
    top += window.scrollY;
  }

  // Clamp horizontal
  if (left < 12) left = 12;
  if (left + tooltipRect.width > viewW - 12) left = viewW - 12 - tooltipRect.width;

  tooltipEl.style.top = top + "px";
  tooltipEl.style.left = left + "px";
  tooltipEl.setAttribute("data-arrow", arrowPos);

  // Animate in
  tooltipEl.classList.remove("gd-tour-tooltip-enter");
  void tooltipEl.offsetWidth;
  tooltipEl.classList.add("gd-tour-tooltip-enter");
}

function endTour() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
  if (resizeHandler) { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }

  // Mark tour complete in Firestore
  const user = auth.currentUser;
  if (user) {
    updateDoc(doc(db, "users", user.uid), { showTour: false }).catch(() => {});
  }
}

// Global handlers for inline onclick
window.__gdTourNext = function () {
  if (currentIdx < TOUR_STEPS.length - 1) {
    currentIdx++;
    showStep(currentIdx);
  } else {
    endTour();
  }
};

window.__gdTourPrev = function () {
  if (currentIdx > 0) {
    currentIdx--;
    showStep(currentIdx);
  }
};

window.__gdTourSkip = function () {
  endTour();
};
