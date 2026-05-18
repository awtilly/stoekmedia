/* ============================================================
   GreenDoor CRM — Dashboard (Claude-style command bar)
   ============================================================
   The dashboard is now a single conversational entry point.
   Realtor types or speaks intent → Sage replies with text and
   (when applicable) emits a `navigate` tool_use that this
   module turns into a route change.
   ============================================================ */

import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, addDoc, doc, updateDoc,
  Timestamp, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast, escapeHtml, safeToDate } from "./auth.js";

const askAssistantFn = httpsCallable(functions, "askAssistant");
const parseListingUrlFn = httpsCallable(functions, "parseListingUrl");
const sendComplianceDocFn = httpsCallable(functions, "sendComplianceDocV2");

let currentUser = null;
let recentClients = [];   // [{ id, name, status, email, phone, lastContactDays }]
let recentListings = [];  // [{ id, address }]
let templates = [];       // [{ id, name, category }]
let todayShowings = [];   // [{ time, address }]
let conversation = [];    // [{ role, content }] — passed back to Sage for follow-ups
let briefingShown = false;

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/greendoor/app/login";
    return;
  }
  currentUser = await getCurrentUser();
  renderGreeting();
  renderChips();  // static fallback while data loads
  autoGrowTextarea();
  // Load context, then refresh chips + show briefing as Sage's first message.
  await loadContextSnapshots(user.uid);
  renderChips();
  maybeShowBriefing();
});

function renderGreeting() {
  const h = new Date().getHours();
  const greeting = h < 5 ? "Hi" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = (currentUser?.fullName || "").split(/\s+/)[0] || "";
  document.getElementById("dash-greeting").textContent = first ? `${greeting}, ${first}.` : `${greeting}.`;
}

async function loadContextSnapshots(uid) {
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);

  try {
    const [cSnap, lSnap, tSnap, sSnap] = await Promise.all([
      getDocs(query(
        collection(db, "clients"),
        where("realtorId", "==", uid),
        orderBy("updatedAt", "desc"),
        limit(20)
      )),
      getDocs(query(
        collection(db, "listings"),
        where("addedBy", "==", uid),
        orderBy("updatedAt", "desc"),
        limit(20)
      )),
      getDocs(query(
        collection(db, "documentTemplates"),
        where("ownerId", "==", uid)
      )).catch(() => null), // No realtor templates yet is fine
      getDocs(query(
        collection(db, "showings"),
        where("realtorId", "==", uid),
        where("showingDate", ">=", Timestamp.fromDate(startOfToday)),
        where("showingDate", "<=", Timestamp.fromDate(endOfToday)),
        orderBy("showingDate", "asc")
      )).catch(() => null) // Index may not exist; non-fatal
    ]);

    recentClients = cSnap.docs.map(d => {
      const x = d.data();
      const lastContact = safeToDate(x.lastContactAt) || safeToDate(x.updatedAt);
      const lastContactDays = lastContact
        ? Math.floor((now - lastContact.getTime()) / 86400000)
        : null;
      return {
        id: d.id,
        name: x.fullName || "Unknown",
        status: x.status || null,
        email: x.email || null,
        phone: x.phone || null,
        lastContactDays
      };
    });

    recentListings = lSnap.docs.map(d => {
      const x = d.data();
      const a = x.address || {};
      return { id: d.id, address: a.full || a.street || d.id };
    });

    if (tSnap) {
      templates = tSnap.docs.map(d => {
        const x = d.data();
        return { id: d.id, name: x.name || "Untitled", category: x.category || "" };
      });
    }

    if (sSnap) {
      todayShowings = sSnap.docs
        .map(d => d.data())
        .filter(s => s.status !== "cancelled")
        .map(s => {
          const dt = safeToDate(s.showingDate);
          return {
            time: dt ? dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
            address: s.address || "TBD"
          };
        });
    }
  } catch (err) {
    console.warn("Recent context load failed (may need index):", err.message);
  }
}

/* ------------------------------------------------------------------ */
/*  Briefing — Sage's first proactive message                          */
/* ------------------------------------------------------------------ */
function buildBriefing() {
  const lines = [];

  if (todayShowings.length) {
    const first = todayShowings[0];
    if (todayShowings.length === 1) {
      lines.push(`You have a showing at ${first.time} — ${first.address}.`);
    } else {
      lines.push(`You have ${todayShowings.length} showings today, starting at ${first.time}.`);
    }
  }

  const stale = recentClients
    .filter(c => c.lastContactDays != null && c.lastContactDays >= 14)
    .sort((a, b) => (b.lastContactDays || 0) - (a.lastContactDays || 0))[0];
  if (stale) {
    lines.push(`${stale.name} hasn't been contacted in ${stale.lastContactDays} days — worth a check-in.`);
  }

  if (!lines.length) {
    // Nothing notable. Skip the briefing entirely on quiet days.
    return null;
  }

  return lines.join(" ");
}

function maybeShowBriefing() {
  if (briefingShown) return;
  const text = buildBriefing();
  if (!text) return;
  briefingShown = true;
  appendTranscript("assistant", "", null, /*stream*/ true, /*streamText*/ text);
}

/* ------------------------------------------------------------------ */
/*  Suggestion chips — data-aware                                      */
/* ------------------------------------------------------------------ */
const STATIC_CHIPS = [
  "Open my clients",
  "Show my listings",
  "Open Templates"
];

function buildChips() {
  const chips = [];

  // Data-driven chips first
  if (todayShowings.length === 1) {
    chips.push(`Open today's ${todayShowings[0].time} showing`);
  } else if (todayShowings.length > 1) {
    chips.push("Show today's calendar");
  }

  const stale = recentClients
    .filter(c => c.lastContactDays != null && c.lastContactDays >= 14)
    .sort((a, b) => (b.lastContactDays || 0) - (a.lastContactDays || 0))[0];
  if (stale) {
    chips.push(`Follow up with ${stale.name.split(" ")[0]}`);
  }

  // A recent client shortcut (most recently touched)
  if (recentClients.length && !stale) {
    chips.push(`Open ${recentClients[0].name.split(" ")[0]}'s profile`);
  }

  // Fill remaining slots with static chips, capped at 4 total
  for (const c of STATIC_CHIPS) {
    if (chips.length >= 4) break;
    chips.push(c);
  }
  return chips.slice(0, 4);
}

function renderChips() {
  const wrap = document.getElementById("dash-chips");
  if (!wrap) return;
  const chips = buildChips();
  wrap.innerHTML = chips.map(c =>
    `<button type="button" class="gd-dash-chip" onclick="fillDashPrompt('${escapeAttr(c)}')">${escapeHtml(c)}</button>`
  ).join("");
}

function escapeAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

window.fillDashPrompt = function (text) {
  const input = document.getElementById("dash-prompt-input");
  input.value = text;
  autoGrowTextarea();
  input.focus();
};

/* ------------------------------------------------------------------ */
/*  Textarea auto-grow + Enter-to-send                                 */
/* ------------------------------------------------------------------ */
function autoGrowTextarea() {
  const input = document.getElementById("dash-prompt-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("dash-prompt-input");
  if (!input) return;
  input.addEventListener("input", autoGrowTextarea);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitDashPrompt();
    }
  });

  // Cmd/Ctrl+K — focus the prompt from anywhere on the dashboard.
  // "/" also focuses, as long as the user isn't already typing in another field.
  document.addEventListener("keydown", (e) => {
    const isCmdK = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
    const isSlash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!isCmdK && !isSlash) return;
    const tag = (e.target?.tagName || "").toLowerCase();
    const inField = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
    if (isSlash && inField) return; // don't hijack "/" while user is typing
    e.preventDefault();
    const promptEl = document.getElementById("dash-prompt-input");
    const wrapEl = document.getElementById("dash-prompt-form");
    if (promptEl) promptEl.focus();
    if (wrapEl) {
      wrapEl.classList.add("gd-dash-pulse");
      setTimeout(() => wrapEl.classList.remove("gd-dash-pulse"), 600);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Submit                                                             */
/* ------------------------------------------------------------------ */
window.submitDashPrompt = async function () {
  const input = document.getElementById("dash-prompt-input");
  const sendBtn = document.getElementById("dash-send-btn");
  const question = (input.value || "").trim();
  if (!question) return;

  activateConversation();
  appendTranscript("user", question);
  input.value = "";
  autoGrowTextarea();
  sendBtn.disabled = true;
  showTyping();

  try {
    const contextData = {
      agentFirstName: (currentUser?.fullName || "").split(/\s+/)[0] || "",
      todayDate: new Date().toISOString().slice(0, 10),
      recentClients,
      recentListings,
      templates
    };
    const r = await askAssistantFn({
      question,
      context: "dashboard",
      contextData,
      history: conversation.slice(-6)
    });
    const { response, actions } = r.data || {};
    removeTyping();
    const finalText = response || "OK.";
    appendTranscript("assistant", "", actions || [], /*stream*/ true, /*streamText*/ finalText);
    conversation.push({ role: "user", content: question });
    conversation.push({ role: "assistant", content: finalText });

    // Auto-route on navigate — give the typewriter a beat to start animating
    // so the realtor reads the confirmation before the page swaps.
    const nav = (actions || []).find(a => a.name === "navigate");
    if (nav) {
      const navDelay = Math.min(1400, Math.max(700, finalText.length * 14));
      setTimeout(() => executeNavigate(nav.input || {}), navDelay);
    }
  } catch (err) {
    console.error("askAssistant error:", err);
    removeTyping();
    appendTranscript("assistant", `Sage isn't reachable right now (${err.message}). Try again in a moment.`);
  } finally {
    sendBtn.disabled = false;
  }
};

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */
const TARGET_ROUTES = {
  dashboard: () => "/greendoor/app/dashboard",
  client_list: () => "/greendoor/app/clients",
  client: (i) => i.clientId
    ? `/greendoor/app/client-detail?cid=${encodeURIComponent(i.clientId)}${i.tab ? `&tab=${encodeURIComponent(i.tab)}` : ""}`
    : "/greendoor/app/clients",
  listing_list: () => "/greendoor/app/listings",
  listing: (i) => i.listingId
    ? `/greendoor/app/listings?lid=${encodeURIComponent(i.listingId)}`
    : "/greendoor/app/listings",
  calendar: () => "/greendoor/app/calendar",
  templates: () => "/greendoor/app/templates",
  settings: () => "/greendoor/app/settings"
};

function executeNavigate(input) {
  const fn = TARGET_ROUTES[input.target];
  if (!fn) {
    showToast(`Sage tried to navigate to '${input.target}' but I don't know that page.`, "error");
    return;
  }
  window.location.href = fn(input);
}

/* ------------------------------------------------------------------ */
/*  Tool executors — confirm-before-execute action handlers           */
/* ------------------------------------------------------------------ */

function clientName(clientId) {
  const c = recentClients.find(x => x.id === clientId);
  return c ? c.name : "client";
}
function clientEmail(clientId) {
  const c = recentClients.find(x => x.id === clientId);
  return c?.email || null;
}
function listingAddress(listingId) {
  const l = recentListings.find(x => x.id === listingId);
  return l ? l.address : "listing";
}
function templateName(templateId) {
  const t = templates.find(x => x.id === templateId);
  return t ? t.name : "document";
}

function previewRow(label, value) {
  if (value == null || value === "") return "";
  return `<div class="gd-dash-card-row"><span class="gd-dash-card-label">${escapeHtml(label)}</span><span class="gd-dash-card-value">${escapeHtml(String(value))}</span></div>`;
}

const STATUS_LABELS = {
  lead: "Lead", active_buyer: "Active Buyer", active_seller: "Active Seller",
  under_contract: "Under Contract", closed: "Closed", inactive: "Inactive"
};

const TRANSACTION_TYPE_LABELS = {
  buyer: "Buyer", seller: "Seller", buyer_and_seller: "Buyer & Seller"
};

// Pretty-print client field updates for the confirm-card preview.
// Returns [{ label, value }] for the fields actually present in `input`.
// Combines range fields (budget, beds, baths, sqft) into one row each.
function previewClientUpdateRows(input) {
  const rows = [];
  const fmtMoney = (n) => `$${Number(n).toLocaleString()}`;
  const fmtRange = (min, max, formatter = String) => {
    if (min != null && max != null) return `${formatter(min)} – ${formatter(max)}`;
    if (min != null) return `${formatter(min)}+`;
    if (max != null) return `up to ${formatter(max)}`;
    return null;
  };

  const push = (label, value) => {
    if (value == null || value === "") return;
    rows.push({ label, value: String(value) });
  };

  push("Name", input.fullName);
  push("Email", input.email);
  push("Phone", input.phone);
  if (input.status) push("Status", STATUS_LABELS[input.status] || input.status);
  if (input.transactionType) push("Type", TRANSACTION_TYPE_LABELS[input.transactionType] || input.transactionType);
  push("Source", input.source);
  push("Timeline", input.timeline);

  const budget = fmtRange(input.budgetMin, input.budgetMax, fmtMoney);
  if (budget) push("Budget", budget);

  const beds = fmtRange(input.bedsMin, input.bedsMax);
  if (beds) push("Beds", beds);
  const baths = fmtRange(input.bathsMin, input.bathsMax);
  if (baths) push("Baths", baths);
  const sqft = fmtRange(input.sqftMin, input.sqftMax, (n) => `${Number(n).toLocaleString()} sq ft`);
  if (sqft) push("Sq ft", sqft);

  if (Array.isArray(input.preferredLocations) && input.preferredLocations.length)
    push("Locations", input.preferredLocations.join(", "));
  if (Array.isArray(input.propertyTypes) && input.propertyTypes.length)
    push("Property types", input.propertyTypes.join(", "));
  if (Array.isArray(input.mustHaveFeatures) && input.mustHaveFeatures.length)
    push("Must-haves", input.mustHaveFeatures.join(", "));
  if (Array.isArray(input.dealBreakers) && input.dealBreakers.length)
    push("Deal-breakers", input.dealBreakers.join(", "));

  if (input.preApprovalStatus) push("Pre-approval", input.preApprovalStatus);
  if (input.preApprovalAmount != null) push("Pre-approval amount", fmtMoney(input.preApprovalAmount));

  push("Notes", input.notes);
  push("Closing", input.closingDate);

  return rows;
}

const TOOL_EXECUTORS = {
  create_client: {
    title: "New Client",
    icon: "&#128100;", // person
    confirmLabel: "Create Client",
    preview: (input) => `
      ${previewRow("Name", input.fullName)}
      ${previewRow("Email", input.email)}
      ${previewRow("Phone", input.phone)}
      ${previewRow("Status", STATUS_LABELS[input.status] || "Lead")}
      ${previewRow("Type", input.transactionType ? input.transactionType.replace("_", " & ") : "")}
      ${previewRow("Notes", input.notes)}
    `,
    execute: async (input) => {
      const uid = auth.currentUser.uid;
      const data = {
        realtorId: uid,
        fullName: input.fullName,
        email: input.email || "",
        phone: input.phone || "",
        status: input.status || "lead",
        transactionType: input.transactionType || "",
        notes: input.notes || "",
        source: "Sage",
        budgetMin: null, budgetMax: null, timeline: "",
        preferredLocations: [], propertyTypes: [],
        bedsMin: null, bedsMax: null, bathsMin: null, bathsMax: null,
        sqftMin: null, sqftMax: null, mustHaveFeatures: [],
        preApprovalStatus: "", preApprovalAmount: null,
        lastActivityDate: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const ref = await addDoc(collection(db, "clients"), data);
      await addDoc(collection(db, "activities"), {
        clientId: ref.id, realtorId: uid, type: "note",
        subject: "Client added via Sage", body: "",
        timestamp: serverTimestamp()
      });
      return {
        message: `Added **${input.fullName}**.`,
        followUp: { label: `Open ${input.fullName}'s profile`, action: () => executeNavigate({ target: "client", clientId: ref.id }) }
      };
    }
  },

  create_followup: {
    title: "Follow-up reminder",
    icon: "&#9745;", // ballot box w/ check
    confirmLabel: "Create Follow-Up",
    preview: (input) => {
      const due = new Date(); due.setDate(due.getDate() + (input.days_from_now || 0));
      return `
        ${previewRow("Title", input.title)}
        ${previewRow("Due", due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}
        ${input.clientId ? previewRow("Client", clientName(input.clientId)) : ""}
        ${previewRow("Notes", input.notes)}
      `;
    },
    execute: async (input) => {
      const uid = auth.currentUser.uid;
      const due = new Date(); due.setDate(due.getDate() + (input.days_from_now || 0));
      await addDoc(collection(db, "followUps"), {
        realtorId: uid,
        clientId: input.clientId || null,
        title: input.title,
        dueDate: Timestamp.fromDate(due),
        priority: "medium",
        status: "pending",
        notes: input.notes || "",
        sourceType: "sage",
        createdAt: serverTimestamp()
      });
      return { message: `Reminder set for **${due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}**.` };
    }
  },

  schedule_event: {
    title: "Schedule",
    icon: "&#128197;", // calendar
    confirmLabel: "Add to Calendar",
    preview: (input) => `
      ${previewRow("Title", input.title)}
      ${previewRow("When", `${input.date} ${input.time}`)}
      ${input.clientId ? previewRow("Client", clientName(input.clientId)) : ""}
      ${previewRow("Address", input.address)}
      ${previewRow("Notes", input.notes)}
    `,
    execute: async (input) => {
      const uid = auth.currentUser.uid;
      const dt = new Date(`${input.date}T${input.time || "09:00"}:00`);
      if (isNaN(dt.getTime())) throw new Error("Couldn't parse the date/time. Try again.");
      const data = {
        realtorId: uid,
        clientId: input.clientId || null,
        address: input.address || input.title,
        showingDate: Timestamp.fromDate(dt),
        durationMinutes: 30,
        status: "scheduled",
        notes: input.notes || "",
        listingPrice: null, mlsNumber: "",
        createdAt: serverTimestamp(),
        clientRating: null, clientFeedback: "",
        disclosuresSent: false, followUpId: null
      };
      await addDoc(collection(db, "showings"), data);
      return {
        message: `Scheduled **${input.title}** on ${dt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
        followUp: { label: "Open calendar", action: () => executeNavigate({ target: "calendar" }) }
      };
    }
  },

  send_compliance_doc: {
    title: "Send document",
    icon: "&#128196;", // page
    confirmLabel: "Send for Signature",
    preview: (input) => `
      ${previewRow("Document", templateName(input.templateId))}
      ${previewRow("Recipient", `${clientName(input.clientId)}${clientEmail(input.clientId) ? ` <${clientEmail(input.clientId)}>` : ""}`)}
      ${input.listingId ? previewRow("Property", listingAddress(input.listingId)) : ""}
    `,
    execute: async (input) => {
      try {
        await sendComplianceDocFn({
          templateId: input.templateId,
          clientId: input.clientId,
          listingId: input.listingId || null
        });
        return {
          message: `Sent **${templateName(input.templateId)}** to ${clientName(input.clientId)}.`,
          followUp: { label: "Open client", action: () => executeNavigate({ target: "client", clientId: input.clientId, tab: "compliance" }) }
        };
      } catch (err) {
        // V2 not configured → route to compliance tab where the legacy fallback path lives.
        if (err.code === "failed-precondition" || (err.message || "").includes("DocuSeal")) {
          showToast("Routing you to the compliance tab to complete the send.", "info");
          executeNavigate({ target: "client", clientId: input.clientId, tab: "compliance" });
          return { message: "Opening the compliance tab to complete the send." };
        }
        throw err;
      }
    }
  },

  draft_email: {
    title: "Email draft",
    icon: "&#9993;", // envelope
    confirmLabel: "Open in client to send",
    preview: (input) => `
      ${previewRow("To", `${clientName(input.clientId)}${clientEmail(input.clientId) ? ` <${clientEmail(input.clientId)}>` : ""}`)}
      ${previewRow("Subject", input.subject)}
      <div class="gd-dash-card-body">${escapeHtml(input.body || "").replace(/\n/g, "<br>")}</div>
    `,
    execute: async (input) => {
      // Stash the draft in sessionStorage; client-detail.js can read & prefill the email modal.
      const draft = { subject: input.subject, body: input.body, ts: Date.now() };
      try { sessionStorage.setItem(`sage_email_draft_${input.clientId}`, JSON.stringify(draft)); } catch (_) {}
      executeNavigate({ target: "client", clientId: input.clientId, tab: "activity" });
      return { message: "Opening the client — your draft will appear in the email composer." };
    }
  },

  update_client: {
    title: "Update client",
    icon: "&#9999;", // pencil
    confirmLabel: "Save Changes",
    preview: (input) => {
      const rows = previewClientUpdateRows(input);
      const name = clientName(input.clientId);
      const header = previewRow("Client", name);
      if (!rows.length) {
        return `${header}<div class="gd-dash-card-body gd-text-muted">No fields specified — Sage didn't include any changes to apply.</div>`;
      }
      return header + rows.map(r => previewRow(r.label, r.value)).join("");
    },
    execute: async (input) => {
      const uid = auth.currentUser.uid;
      const allowed = [
        "fullName", "email", "phone", "status", "transactionType", "source",
        "timeline", "budgetMin", "budgetMax", "bedsMin", "bedsMax",
        "bathsMin", "bathsMax", "sqftMin", "sqftMax",
        "preferredLocations", "propertyTypes", "mustHaveFeatures", "dealBreakers",
        "preApprovalStatus", "preApprovalAmount", "notes"
      ];
      const update = {};
      const changedLabels = [];
      for (const key of allowed) {
        if (input[key] !== undefined && input[key] !== null) {
          update[key] = input[key];
          changedLabels.push(key);
        }
      }
      if (input.closingDate) {
        const dt = new Date(`${input.closingDate}T00:00:00`);
        if (!isNaN(dt.getTime())) {
          update.closingDate = Timestamp.fromDate(dt);
          changedLabels.push("closingDate");
        }
      }
      if (!changedLabels.length) {
        throw new Error("Sage didn't specify any fields to change.");
      }
      update.updatedAt = serverTimestamp();
      update.lastActivityDate = serverTimestamp();

      await updateDoc(doc(db, "clients", input.clientId), update);
      await addDoc(collection(db, "activities"), {
        clientId: input.clientId,
        realtorId: uid,
        type: "note",
        subject: "Client info updated via Sage",
        body: `Fields updated: ${changedLabels.join(", ")}`,
        timestamp: serverTimestamp()
      });

      // Keep the in-memory dashboard cache in sync so subsequent prompts see
      // the new values without a page reload.
      const cached = recentClients.find(c => c.id === input.clientId);
      if (cached) {
        if (update.fullName) cached.name = update.fullName;
        if (update.status) cached.status = update.status;
        if (update.email != null) cached.email = update.email;
        if (update.phone != null) cached.phone = update.phone;
      }

      const name = clientName(input.clientId);
      return {
        message: `Updated **${name}** — ${changedLabels.length} field${changedLabels.length === 1 ? "" : "s"} changed.`,
        followUp: { label: `Open ${name}'s profile`, action: () => executeNavigate({ target: "client", clientId: input.clientId }) }
      };
    }
  },

  add_listing: {
    title: "New Listing",
    icon: "&#127968;", // house
    confirmLabel: "Add Listing",
    preview: (input) => {
      if (input.source_url) {
        return `
          ${previewRow("Source", input.source_url)}
          <div class="gd-dash-card-body gd-text-muted">We'll fetch the details on confirm.</div>
        `;
      }
      return `
        ${previewRow("Address", input.address)}
        ${previewRow("Price", input.price ? `$${Number(input.price).toLocaleString()}` : "")}
        ${previewRow("Beds / Baths", input.beds || input.baths ? `${input.beds || "?"} / ${input.baths || "?"}` : "")}
        ${previewRow("Sq ft", input.sqft)}
        ${previewRow("Notes", input.notes)}
      `;
    },
    execute: async (input) => {
      const uid = auth.currentUser.uid;
      let data;
      if (input.source_url) {
        const r = await parseListingUrlFn({ url: input.source_url });
        const parsed = r.data || {};
        data = {
          address: parsed.address || { full: "", street: "", city: "", state: "", zip: "" },
          listingPrice: parsed.price || null,
          beds: parsed.beds || null,
          baths: parsed.baths || null,
          squareFeet: parsed.sqft || null,
          yearBuilt: parsed.yearBuilt || null,
          propertyType: parsed.propertyType || "",
          description: parsed.description || "",
          mlsNumber: parsed.mlsNumber || "",
          sourceUrl: input.source_url,
          notes: input.notes || ""
        };
      } else {
        data = {
          address: { full: input.address || "", street: input.address || "", city: "", state: "", zip: "" },
          listingPrice: input.price || null,
          beds: input.beds || null,
          baths: input.baths || null,
          squareFeet: input.sqft || null,
          notes: input.notes || ""
        };
      }
      data.addedBy = uid;
      data.source = "sage";
      data.status = "active";
      data.createdAt = serverTimestamp();
      data.updatedAt = serverTimestamp();
      data.photos = [];
      const ref = await addDoc(collection(db, "listings"), data);
      const label = data.address?.full || data.address?.street || "your new listing";
      return {
        message: `Added **${label}**.`,
        followUp: { label: "Open listing", action: () => executeNavigate({ target: "listing", listingId: ref.id }) }
      };
    }
  }
};

/* ------------------------------------------------------------------ */
/*  Transcript rendering + streaming (typewriter)                      */
/* ------------------------------------------------------------------ */

// Flip the dashboard into chat layout: greeting/subhead/chips collapse,
// transcript fills the height, prompt sticks to the bottom. Idempotent.
function activateConversation() {
  const content = document.querySelector(".gd-dash-content");
  if (content && !content.classList.contains("gd-dash-active")) {
    content.classList.add("gd-dash-active");
    // Keep the prompt's focus state intact across the layout shift.
    requestAnimationFrame(() => {
      const input = document.getElementById("dash-prompt-input");
      if (input && document.activeElement !== input) input.focus();
    });
  }
}

function appendTranscript(role, text, actions, stream, streamText) {
  const el = document.getElementById("dash-transcript");
  const msg = document.createElement("div");
  msg.className = `gd-dash-msg gd-dash-msg-${role}`;

  const textWrap = document.createElement("div");
  textWrap.className = "gd-dash-msg-text";
  msg.appendChild(textWrap);
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;

  const finalText = stream ? (streamText || "") : (text || "");

  const renderActions = () => {
    if (!Array.isArray(actions) || !actions.length) return;
    actions.forEach(a => {
      if (a.name === "navigate") {
        const row = document.createElement("div");
        row.className = "gd-dash-actions";
        const btn = document.createElement("button");
        btn.className = "gd-btn gd-btn-sm gd-btn-primary";
        btn.textContent = labelForNavigate(a.input || {});
        btn.onclick = () => executeNavigate(a.input || {});
        row.appendChild(btn);
        msg.appendChild(row);
      } else if (TOOL_EXECUTORS[a.name]) {
        msg.appendChild(renderConfirmCard(a.name, a.input || {}));
      }
    });
  };

  if (stream && role === "assistant") {
    typewriter(textWrap, finalText, renderActions);
  } else {
    textWrap.innerHTML = formatMessageHtml(finalText);
    renderActions();
  }
}

// Render an inline confirm-before-execute action card. Replaces itself
// with a status row once the user clicks Confirm (or Cancel).
function renderConfirmCard(toolName, input) {
  const def = TOOL_EXECUTORS[toolName];
  const card = document.createElement("div");
  card.className = "gd-dash-card";

  const header = `
    <div class="gd-dash-card-header">
      <span class="gd-dash-card-icon">${def.icon}</span>
      <span class="gd-dash-card-title">${escapeHtml(def.title)}</span>
    </div>
    <div class="gd-dash-card-rows">${def.preview(input)}</div>
  `;

  card.innerHTML = `
    ${header}
    <div class="gd-dash-card-footer">
      <button class="gd-btn gd-btn-sm gd-dash-card-cancel">Cancel</button>
      <button class="gd-btn gd-btn-sm gd-btn-primary gd-dash-card-confirm">${escapeHtml(def.confirmLabel)}</button>
    </div>
  `;

  const cancelBtn = card.querySelector(".gd-dash-card-cancel");
  const confirmBtn = card.querySelector(".gd-dash-card-confirm");

  cancelBtn.onclick = () => {
    card.innerHTML = `<div class="gd-dash-card-status gd-text-muted">Cancelled.</div>`;
  };

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = "Working…";
    try {
      const result = await def.execute(input);
      const followUpHtml = result?.followUp
        ? `<button class="gd-btn gd-btn-sm gd-dash-card-followup">${escapeHtml(result.followUp.label)}</button>`
        : "";
      card.innerHTML = `
        <div class="gd-dash-card-status gd-dash-card-status-ok">
          <span class="gd-dash-card-check">&#10003;</span>
          <span>${formatMessageHtml(result?.message || "Done.")}</span>
        </div>
        ${followUpHtml ? `<div class="gd-dash-card-footer">${followUpHtml}</div>` : ""}
      `;
      if (result?.followUp) {
        card.querySelector(".gd-dash-card-followup").onclick = result.followUp.action;
      }
    } catch (err) {
      console.error(`${toolName} execute error:`, err);
      card.innerHTML = `
        <div class="gd-dash-card-status gd-dash-card-status-err">
          <span>Couldn't complete: ${escapeHtml(err.message || "unknown error")}</span>
        </div>
      `;
    }
  };

  return card;
}

// Typewriter — paints text char-by-char with adaptive speed. We render into
// a hidden buffer first to keep the cursor anchored, then swap. Newlines and
// **bold** are honored at the end via formatMessageHtml.
function typewriter(target, fullText, onDone) {
  const total = fullText.length;
  // Adaptive speed: short messages slow & dramatic, long messages fast.
  const baseDelay = total < 60 ? 22 : total < 160 ? 14 : 8;
  let i = 0;

  function tick() {
    // Step a few characters per frame for long content so we never lag.
    const step = total > 200 ? 3 : total > 80 ? 2 : 1;
    i = Math.min(total, i + step);
    target.innerHTML = formatMessageHtml(fullText.slice(0, i)) + (i < total ? '<span class="gd-dash-caret"></span>' : "");
    const transcriptEl = document.getElementById("dash-transcript");
    if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
    if (i < total) {
      setTimeout(tick, baseDelay);
    } else if (typeof onDone === "function") {
      onDone();
    }
  }
  tick();
}

function labelForNavigate(input) {
  switch (input.target) {
    case "client":
      const c = recentClients.find(x => x.id === input.clientId);
      return c ? `Open ${c.name}` : "Open client";
    case "client_list": return "Open Clients";
    case "listing":
      const l = recentListings.find(x => x.id === input.listingId);
      return l ? `Open ${l.address}` : "Open listing";
    case "listing_list": return "Open Listings";
    case "calendar": return "Open Calendar";
    case "templates": return "Open Templates";
    case "settings": return "Open Settings";
    default: return "Open";
  }
}

function formatMessageHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function showTyping() {
  const el = document.getElementById("dash-transcript");
  const t = document.createElement("div");
  t.id = "dash-typing";
  t.className = "gd-dash-msg gd-dash-msg-assistant gd-dash-typing";
  t.innerHTML = '<span class="gd-dash-typing-dot"></span><span class="gd-dash-typing-dot"></span><span class="gd-dash-typing-dot"></span>';
  el.appendChild(t);
  el.scrollTop = el.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById("dash-typing");
  if (t) t.remove();
}

/* ------------------------------------------------------------------ */
/*  Voice input (parallel of chatbot.js, targets dashboard textarea)   */
/* ------------------------------------------------------------------ */
let dashRecognition = null;
let dashListening = false;

window.toggleDashVoice = function () {
  const micBtn = document.getElementById("dash-mic-btn");
  const input = document.getElementById("dash-prompt-input");

  if (dashListening) {
    if (dashRecognition) dashRecognition.stop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Voice input not supported in this browser.", "error");
    return;
  }

  dashRecognition = new SpeechRecognition();
  dashRecognition.lang = "en-US";
  dashRecognition.interimResults = true;
  dashRecognition.continuous = false;
  dashRecognition.maxAlternatives = 1;

  dashRecognition.onstart = () => {
    dashListening = true;
    micBtn.classList.add("listening");
    input.placeholder = "Listening…";
  };

  dashRecognition.onresult = (e) => {
    let transcript = "";
    for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
    input.value = transcript;
    autoGrowTextarea();
    if (e.results[e.results.length - 1].isFinal) {
      setTimeout(() => {
        if (input.value.trim()) submitDashPrompt();
      }, 400);
    }
  };

  dashRecognition.onerror = (e) => {
    console.error("Dash voice error:", e.error);
    if (e.error !== "aborted" && e.error !== "no-speech") {
      showToast("Couldn't hear you — try again.", "error");
    }
  };

  dashRecognition.onend = () => {
    dashListening = false;
    micBtn.classList.remove("listening");
    input.placeholder = "Ask Sage anything, or say what you want to do…";
  };

  dashRecognition.start();
};

/* ------------------------------------------------------------------ */
/*  Logout (referenced from sidebar)                                   */
/* ------------------------------------------------------------------ */
window.handleLogout = async function () {
  await auth.signOut();
  window.location.href = "/greendoor/app/login";
};
