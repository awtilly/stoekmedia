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
  collection, query, where, orderBy, limit, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast, escapeHtml, safeToDate } from "./auth.js";

const askAssistantFn = httpsCallable(functions, "askAssistant");

let currentUser = null;
let recentClients = [];   // [{ id, name, status, lastContactDays }]
let recentListings = [];  // [{ id, address }]
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
    const [cSnap, lSnap, sSnap] = await Promise.all([
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
        lastContactDays
      };
    });

    recentListings = lSnap.docs.map(d => {
      const x = d.data();
      const a = x.address || {};
      return { id: d.id, address: a.full || a.street || d.id };
    });

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
      recentListings
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
/*  Transcript rendering + streaming (typewriter)                      */
/* ------------------------------------------------------------------ */
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
    if (Array.isArray(actions) && actions.length) {
      const actionRow = document.createElement("div");
      actionRow.className = "gd-dash-actions";
      actions.forEach(a => {
        if (a.name === "navigate") {
          const btn = document.createElement("button");
          btn.className = "gd-btn gd-btn-sm gd-btn-primary";
          btn.textContent = labelForNavigate(a.input || {});
          btn.onclick = () => executeNavigate(a.input || {});
          actionRow.appendChild(btn);
        }
      });
      if (actionRow.children.length) msg.appendChild(actionRow);
    }
  };

  if (stream && role === "assistant") {
    typewriter(textWrap, finalText, renderActions);
  } else {
    textWrap.innerHTML = formatMessageHtml(finalText);
    renderActions();
  }
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
