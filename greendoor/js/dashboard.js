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
  collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast, escapeHtml } from "./auth.js";

const askAssistantFn = httpsCallable(functions, "askAssistant");

let currentUser = null;
let recentClients = [];   // [{ id, name, status }]
let recentListings = [];  // [{ id, address }]
let conversation = [];    // [{ role, content }] — passed back to Sage for follow-ups

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
  renderChips();
  autoGrowTextarea();
  // Load recent clients/listings in the background so the prompt is usable immediately.
  loadContextSnapshots(user.uid);
});

function renderGreeting() {
  const h = new Date().getHours();
  const greeting = h < 5 ? "Hi" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = (currentUser?.fullName || "").split(/\s+/)[0] || "";
  document.getElementById("dash-greeting").textContent = first ? `${greeting}, ${first}.` : `${greeting}.`;
}

async function loadContextSnapshots(uid) {
  try {
    const [cSnap, lSnap] = await Promise.all([
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
      ))
    ]);
    recentClients = cSnap.docs.map(d => {
      const x = d.data();
      return { id: d.id, name: x.fullName || "Unknown", status: x.status || null };
    });
    recentListings = lSnap.docs.map(d => {
      const x = d.data();
      const a = x.address || {};
      return { id: d.id, address: a.full || a.street || d.id };
    });
  } catch (err) {
    console.warn("Recent context load failed (may need index):", err.message);
  }
}

/* ------------------------------------------------------------------ */
/*  Suggestion chips                                                   */
/* ------------------------------------------------------------------ */
const CHIPS = [
  "Show today's calendar",
  "Open my clients",
  "Show my listings",
  "Open Templates",
  "What should I focus on today?"
];

function renderChips() {
  const wrap = document.getElementById("dash-chips");
  if (!wrap) return;
  wrap.innerHTML = CHIPS.map(c =>
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
    appendTranscript("assistant", response || "OK.", actions || []);
    conversation.push({ role: "user", content: question });
    conversation.push({ role: "assistant", content: response || "OK." });

    // Auto-route on navigate
    const nav = (actions || []).find(a => a.name === "navigate");
    if (nav) executeNavigate(nav.input || {});
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
  const url = fn(input);
  // Brief delay so the user reads the confirmation text before the page changes.
  setTimeout(() => { window.location.href = url; }, 600);
}

/* ------------------------------------------------------------------ */
/*  Transcript rendering                                               */
/* ------------------------------------------------------------------ */
function appendTranscript(role, text, actions) {
  const el = document.getElementById("dash-transcript");
  const msg = document.createElement("div");
  msg.className = `gd-dash-msg gd-dash-msg-${role}`;
  msg.innerHTML = formatMessageHtml(text || "");

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

  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
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
