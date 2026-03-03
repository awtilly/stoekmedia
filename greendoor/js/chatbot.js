/**
 * GreenDoor AI Chatbot — shared module
 * Auto-injects the floating AI bubble + slide-in chat panel on every CRM page.
 * Detects page context and sets appropriate quick actions.
 */
import { auth, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { showToast } from "./auth.js";

const askAssistant = httpsCallable(functions, "askAssistant");

/* ---------- page detection ---------- */
function detectPage() {
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

function getClientId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function getContext(page) {
  if (page === "client-detail" && getClientId()) return "client_detail";
  if (page === "dashboard") return "dashboard";
  return "general";
}

const QUICK_ACTIONS = {
  "dashboard": [
    "Daily briefing",
    "Who needs follow-up?",
    "What's this week look like?"
  ],
  "clients": [
    "Who hasn't been contacted?",
    "Summarize my pipeline",
    "Any new leads this week?"
  ],
  "client-detail": [
    "Summarize this client",
    "Draft follow-up email",
    "Suggest next steps",
    "Schedule a showing"
  ],
  "calendar": [
    "What's coming up?",
    "Schedule a showing",
    "Any scheduling conflicts?"
  ],
  "listings": [
    "Match listings to my buyers",
    "What's new on the market?"
  ],
  "settings": [
    "How do I set up templates?",
    "Help me get started"
  ],
  "admin": [
    "How do I set up templates?",
    "Help me get started"
  ],
  "faq": [
    "How do I set up templates?",
    "Help me get started"
  ]
};

/* ---------- HTML injection ---------- */
function injectChatHTML(page) {
  const actions = QUICK_ACTIONS[page] || QUICK_ACTIONS["settings"];
  const quickBtns = actions
    .map(a => `<button class="gd-ai-quick-btn" onclick="sendQuickAction('${a.replace(/'/g, "\\'")}')">${a}</button>`)
    .join("");

  const fab = document.createElement("button");
  fab.className = "gd-ai-fab";
  fab.onclick = () => window.toggleAiPanel();
  fab.title = "GreenDoor AI";
  fab.setAttribute("aria-label", "Open AI assistant");
  fab.innerHTML = "&#10024;";
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.id = "ai-panel";
  panel.className = "gd-ai-panel";
  panel.innerHTML = `
    <div class="gd-ai-panel-header">
      <div class="gd-ai-panel-title"><span>&#10024;</span> GreenDoor AI</div>
      <button class="gd-ai-panel-close" onclick="toggleAiPanel()" aria-label="Close AI panel">&times;</button>
    </div>
    <div class="gd-ai-quick-actions">${quickBtns}</div>
    <div id="ai-messages" class="gd-ai-messages"></div>
    <div class="gd-ai-input-area">
      <button id="ai-mic-btn" class="gd-ai-mic" onclick="toggleVoiceInput()" aria-label="Voice input" title="Speak to GreenDoor AI">&#127908;</button>
      <input type="text" id="ai-input" class="gd-ai-input" placeholder="Ask or speak to your AI assistant..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAiMessage();}">
      <button id="ai-send-btn" class="gd-ai-send" onclick="sendAiMessage()" aria-label="Send message">&#10148;</button>
    </div>`;
  document.body.appendChild(panel);
}

/* ---------- formatting ---------- */
function formatAiResponse(text) {
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

/* ---------- message rendering ---------- */
function addAiMessage(text, type, page) {
  const el = document.getElementById("ai-messages");
  const div = document.createElement("div");
  if (type === "user") {
    div.className = "gd-ai-msg gd-ai-msg-user";
    div.textContent = text;
  } else if (type === "error") {
    div.className = "gd-ai-msg gd-ai-msg-error";
    div.textContent = text;
  } else {
    div.className = "gd-ai-msg gd-ai-msg-ai";
    div.innerHTML = formatAiResponse(text);

    // On client-detail, detect email drafts and add "Open in Email" button
    if (page === "client-detail") {
      const lc = text.toLowerCase();
      if (lc.includes("subject:") || lc.includes("dear ") || lc.includes("hi ")) {
        const btn = document.createElement("button");
        btn.className = "gd-btn gd-btn-sm gd-btn-ai-email";
        btn.textContent = "Open in Email";
        btn.onclick = () => {
          document.dispatchEvent(new CustomEvent("ai-email-draft", { detail: { text } }));
        };
        div.appendChild(btn);
      }
    }
  }
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

/* ---------- typing indicator ---------- */
function showTypingIndicator() {
  const el = document.getElementById("ai-messages");
  const div = document.createElement("div");
  div.className = "gd-ai-typing";
  div.id = "ai-typing";
  div.innerHTML = '<div class="gd-ai-typing-dot"></div><div class="gd-ai-typing-dot"></div><div class="gd-ai-typing-dot"></div>';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function removeTypingIndicator() {
  const t = document.getElementById("ai-typing");
  if (t) t.remove();
}

/* ---------- toggle panel ---------- */
window.toggleAiPanel = function () {
  document.getElementById("ai-panel").classList.toggle("open");
};

/* ---------- quick action ---------- */
window.sendQuickAction = function (text) {
  document.getElementById("ai-input").value = text;
  window.sendAiMessage();
};

/* ---------- send message ---------- */
window.sendAiMessage = async function () {
  const page = detectPage();
  const context = getContext(page);
  const clientId = getClientId();
  const input = document.getElementById("ai-input");
  const btn = document.getElementById("ai-send-btn");
  const question = input.value.trim();
  if (!question) return;

  addAiMessage(question, "user", page);
  input.value = "";
  btn.disabled = true;
  showTypingIndicator();

  try {
    const payload = { question, context };
    if (context === "client_detail" && clientId) {
      payload.clientId = clientId;
    }
    const result = await askAssistant(payload);
    removeTypingIndicator();
    addAiMessage(result.data.response, "ai", page);

    // If the AI performed actions on client-detail, notify page to refresh
    if (result.data.actionsPerformed && result.data.actionsPerformed.length > 0 && page === "client-detail") {
      document.dispatchEvent(new CustomEvent("ai-actions-performed"));
    }
  } catch (err) {
    removeTypingIndicator();
    const msg = err.message || "Something went wrong. Please try again.";
    addAiMessage(msg, "error", page);
  }
  btn.disabled = false;
};

/* ---------- voice input ---------- */
let recognition = null;
let isListening = false;

window.toggleVoiceInput = function () {
  const micBtn = document.getElementById("ai-mic-btn");

  if (isListening) {
    if (recognition) recognition.stop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Voice input not supported in this browser.", "error");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  const input = document.getElementById("ai-input");

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("listening");
    input.placeholder = "Listening...";
  };

  recognition.onresult = (e) => {
    let transcript = "";
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    input.value = transcript;

    if (e.results[e.results.length - 1].isFinal) {
      setTimeout(() => {
        if (input.value.trim()) {
          window.sendAiMessage();
        }
      }, 400);
    }
  };

  recognition.onerror = (e) => {
    console.error("Speech error:", e.error);
    if (e.error !== "aborted" && e.error !== "no-speech") {
      showToast("Couldn't hear you — try again.", "error");
    }
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening");
    input.placeholder = "Ask or speak to your AI assistant...";
    recognition = null;
  };

  recognition.start();
};

/* ---------- auto-init on auth ---------- */
onAuthStateChanged(auth, (user) => {
  if (user && !document.getElementById("ai-panel")) {
    const page = detectPage();
    injectChatHTML(page);
  }
});
