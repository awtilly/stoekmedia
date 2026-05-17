import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let cachedProfile = null;

/* --- Auth state listener (runs on every CRM page) --- */
onAuthStateChanged(auth, async (user) => {
  const path = window.location.pathname;
  const isLoginPage = path.includes("/app/login");
  const isOnboardingPage = path.includes("/app/onboarding");
  const isSetPasswordPage = path.includes("/app/set-password");
  const isCrmPage = path.includes("/greendoor/app/");

  if (user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        cachedProfile = { uid: user.uid, ...userDoc.data() };
        updateDoc(doc(db, "users", user.uid), { lastLogin: serverTimestamp() }).catch(() => {});

        // Onboarding redirect: strict === false so existing users (without field) are unaffected
        if (cachedProfile.onboardingComplete === false) {
          if (!isOnboardingPage) {
            window.location.href = "/greendoor/app/onboarding";
            return;
          }
        } else if (isLoginPage) {
          window.location.href = "/greendoor/app/dashboard";
          return;
        }

        renderNavUser(cachedProfile);
      } else if (isLoginPage) {
        window.location.href = "/greendoor/app/dashboard";
        return;
      }
    } catch (e) {
      console.error("Failed to load user profile:", e);
    }
  } else {
    cachedProfile = null;
    if (isCrmPage && !isLoginPage && !isSetPasswordPage) {
      window.location.href = "/greendoor/app/login";
      return;
    }
  }
});

/* --- Render user info in nav --- */
function renderNavUser(profile) {
  const nameEl = document.getElementById("nav-user-name");
  const adminTab = document.getElementById("nav-admin-tab");
  const avatarEl = document.getElementById("sidebar-avatar");
  if (nameEl) nameEl.textContent = profile.fullName || profile.email;
  if (adminTab) {
    adminTab.style.display = profile.role === "admin" ? "" : "none";
  }
  if (avatarEl) {
    const name = profile.fullName || profile.email || "";
    const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    avatarEl.textContent = initials;
  }
}

/* --- Login handler --- */
window.handleLogin = async function () {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  errorEl.style.display = "none";
  if (!email || !password) {
    errorEl.textContent = "Please enter email and password.";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Logging in...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    let msg = "Login failed. Please try again.";
    if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      msg = "Invalid email or password.";
    } else if (err.code === "auth/too-many-requests") {
      msg = "Too many attempts. Please try again later.";
    }
    errorEl.textContent = msg;
    errorEl.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Log In";
  }
};

/* --- Forgot password handler --- */
window.handleForgotPassword = async function () {
  const email = document.getElementById("login-email").value.trim();
  const errorEl = document.getElementById("login-error");

  if (!email) {
    errorEl.textContent = "Enter your email above first.";
    errorEl.style.display = "block";
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email, {
      url: "https://stoekmedia.com/greendoor/app/set-password",
      handleCodeInApp: false
    });
    errorEl.style.color = "#22c55e";
    errorEl.textContent = "Password reset email sent. Check your inbox.";
    errorEl.style.display = "block";
    setTimeout(() => { errorEl.style.color = ""; }, 5000);
  } catch (err) {
    errorEl.textContent = "Could not send reset email. Check the address.";
    errorEl.style.display = "block";
  }
};

/* --- Logout handler --- */
window.handleLogout = async function () {
  await signOut(auth);
  window.location.href = "/greendoor/app/login";
};

/* --- Get current user profile (cached) --- */
export async function getCurrentUser() {
  if (cachedProfile) return cachedProfile;
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) { resolve(null); return; }
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          cachedProfile = { uid: user.uid, ...userDoc.data() };
          resolve(cachedProfile);
        } else {
          resolve({ uid: user.uid, email: user.email, role: "realtor" });
        }
      } catch {
        resolve({ uid: user.uid, email: user.email, role: "realtor" });
      }
    });
  });
}

/* --- Toast notifications (stacking queue) --- */
export function showToast(message, type = "success") {
  let container = document.querySelector(".gd-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "gd-toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `gd-toast ${type}`;
  toast.textContent = message;
  toast.style.transition = "opacity 0.3s, transform 0.3s";
  container.appendChild(toast);

  // Reflow existing toasts to stack properly
  const toasts = container.querySelectorAll(".gd-toast");
  toasts.forEach((t, i) => {
    t.style.transform = `translateY(-${(toasts.length - 1 - i) * 4}px)`;
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* --- Safe timestamp conversion utility --- */
export function safeToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") {
    try { return ts.toDate(); } catch { return null; }
  }
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

/* --- Formatting helpers --- */
export function formatCurrency(num) {
  if (num == null || isNaN(num)) return "—";
  return "$" + Number(num).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatDate(ts) {
  const date = safeToDate(ts);
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(ts) {
  const date = safeToDate(ts);
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " at " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function timeAgo(ts) {
  const date = safeToDate(ts);
  if (!date) return "—";
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hours / 24);
  if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
  return formatDate(ts);
}

export function formatFileSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export function statusLabel(status) {
  if (!status) return "";
  return status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function sanitizeUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── PWA: Service Worker & Install Banner ── */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

// Service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/greendoor/app/sw.js', { scope: '/greendoor/app/' })
    .then(reg => {
      // If a worker is already waiting on load, surface the banner immediately.
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(reg.waiting);
      }
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newSW);
          }
        });
      });
    })
    .catch(err => console.warn('SW registration failed:', err));

  // When the new SW takes over, reload once to pick up the new assets.
  let reloadOnce = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnce) return;
    reloadOnce = true;
    window.location.reload();
  });
}

// Update banner
function showUpdateBanner(waitingWorker) {
  if (document.getElementById('gd-update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'gd-update-banner';
  banner.className = 'gd-update-banner';
  banner.innerHTML = 'A new version is available <button type="button">Refresh</button>';
  document.body.appendChild(banner);
  banner.querySelector('button').addEventListener('click', () => {
    if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  });
}

// Install banner
let deferredInstallPrompt = null;

function showInstallBanner() {
  if (isStandalone()) return;
  if (document.getElementById('gd-install-banner')) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const banner = document.createElement('div');
  banner.id = 'gd-install-banner';
  banner.className = 'gd-install-banner';
  banner.innerHTML = `
    <img class="gd-install-banner-icon" src="/greendoor/app/icons/icon-192.png" alt="GreenDoor">
    <div class="gd-install-banner-text">
      Install GreenDoor CRM
      <small>${isIOS ? 'Tap Share, then scroll down and tap "Add to Home Screen"' : 'Add to your home screen for quick access'}</small>
    </div>
    ${!isIOS ? '<button class="gd-btn-install" id="gd-install-btn">Install</button>' : ''}
    <button class="gd-btn-dismiss" id="gd-dismiss-btn">&times;</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('gd-dismiss-btn').addEventListener('click', dismissInstallBanner);
  const installBtn = document.getElementById('gd-install-btn');
  if (installBtn) installBtn.addEventListener('click', installApp);
}

function dismissInstallBanner() {
  const banner = document.getElementById('gd-install-banner');
  if (banner) banner.remove();
  localStorage.setItem('gd-install-dismissed', '1');
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  dismissInstallBanner();
  if (result.outcome === 'accepted') showToast('App installed!');
}

// Android/Chrome install prompt
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem('gd-install-dismissed')) {
    showInstallBanner();
  }
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  dismissInstallBanner();
  showToast('App installed!');
});

// iOS: show install banner after short delay
if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !isStandalone() && !localStorage.getItem('gd-install-dismissed')) {
  setTimeout(showInstallBanner, 6000);
}
