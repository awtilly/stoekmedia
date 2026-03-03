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
  if (nameEl) nameEl.textContent = profile.fullName || profile.email;
  if (adminTab) {
    adminTab.style.display = profile.role === "admin" ? "" : "none";
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

/* --- Toast notifications --- */
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
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* --- Formatting helpers --- */
export function formatCurrency(num) {
  if (num == null || isNaN(num)) return "—";
  return "$" + Number(num).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatDate(ts) {
  if (!ts) return "—";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(ts) {
  if (!ts) return "—";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " at " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function timeAgo(ts) {
  if (!ts) return "—";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
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
