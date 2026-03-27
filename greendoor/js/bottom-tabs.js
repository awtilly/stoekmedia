/* ============================================================
   GreenDoor CRM — Mobile Bottom Tab Bar
   Injects a native-style bottom tab bar on mobile (≤768px)
   ============================================================ */

const TAB_CONFIG = [
  {
    id: "dashboard",
    label: "Home",
    href: "/greendoor/app/dashboard",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    iconFilled: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    pages: ["dashboard"]
  },
  {
    id: "clients",
    label: "Clients",
    href: "/greendoor/app/clients",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    iconFilled: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2h16z"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87A4 4 0 0 0 16 3.13a4 4 0 0 1 0 7.75 4 4 0 0 1 4 3.87v2h3z" opacity="0.6"/></svg>',
    pages: ["clients", "client-detail"]
  },
  {
    id: "ai",
    label: "Sage",
    isCenter: true
  },
  {
    id: "listings",
    label: "Listings",
    href: "/greendoor/app/listings",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    iconFilled: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect x="9" y="12" width="6" height="10" fill="white"/></svg>',
    pages: ["listings"]
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/greendoor/app/calendar",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    iconFilled: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="4" width="18" height="18" rx="2"/><rect x="3" y="4" width="18" height="6" rx="2" fill="currentColor"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3" y="10" width="18" height="12" rx="0" fill="currentColor" opacity="0.4"/></svg>',
    pages: ["calendar"]
  }
];

function detectCurrentPage() {
  const path = window.location.pathname;
  if (path.includes("client-detail")) return "client-detail";
  if (path.includes("dashboard")) return "dashboard";
  if (path.includes("clients")) return "clients";
  if (path.includes("calendar")) return "calendar";
  if (path.includes("listings")) return "listings";
  if (path.includes("settings")) return "settings";
  if (path.includes("admin")) return "admin";
  if (path.includes("faq")) return "faq";
  return "general";
}

function injectBottomTabs() {
  if (document.getElementById("gd-bottom-tabs")) return;

  const currentPage = detectCurrentPage();
  const nav = document.createElement("nav");
  nav.id = "gd-bottom-tabs";
  nav.className = "gd-bottom-tabs";
  nav.setAttribute("aria-label", "Main navigation");

  nav.innerHTML = TAB_CONFIG.map(tab => {
    if (tab.isCenter) {
      return `
        <button class="gd-tab-item gd-tab-ai" aria-label="Ask Sage">
          <span class="gd-tab-ai-circle">&#10024;</span>
          <span class="gd-tab-label">Sage</span>
        </button>`;
    }

    const isActive = tab.pages.includes(currentPage);
    const icon = isActive ? tab.iconFilled : tab.icon;
    return `
      <a href="${tab.href}" class="gd-tab-item${isActive ? " active" : ""}" data-tab="${tab.id}">
        <span class="gd-tab-icon">${icon}</span>
        <span class="gd-tab-label">${tab.label}</span>
      </a>`;
  }).join("");

  document.body.appendChild(nav);

  const aiTab = nav.querySelector(".gd-tab-ai");
  if (aiTab) {
    aiTab.addEventListener("click", () => {
      if (typeof window.toggleAiPanel === "function") {
        window.toggleAiPanel();
      }
    });
  }
}

/* Only inject on mobile-width screens */
const mq = window.matchMedia("(max-width: 768px)");

function handleViewport(e) {
  if (e.matches) {
    injectBottomTabs();
  } else {
    const existing = document.getElementById("gd-bottom-tabs");
    if (existing) existing.remove();
  }
}

mq.addEventListener("change", handleViewport);
if (mq.matches) injectBottomTabs();
