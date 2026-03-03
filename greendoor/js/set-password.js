import { auth } from "./firebase-config.js";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const loadingEl = document.getElementById("sp-loading");
const errorEl = document.getElementById("sp-error");
const errorMsg = document.getElementById("sp-error-msg");
const formEl = document.getElementById("sp-form");
const successEl = document.getElementById("sp-success");
const emailEl = document.getElementById("sp-email");
const passwordInput = document.getElementById("sp-password");
const confirmInput = document.getElementById("sp-confirm");
const submitBtn = document.getElementById("sp-submit");
const formError = document.getElementById("sp-form-error");
const strengthFill = document.getElementById("sp-strength-fill");
const strengthLabel = document.getElementById("sp-strength-label");
const matchEl = document.getElementById("sp-match");

const reqLength = document.getElementById("req-length");
const reqUpper = document.getElementById("req-upper");
const reqLower = document.getElementById("req-lower");
const reqNumber = document.getElementById("req-number");

// Extract oobCode from URL
const params = new URLSearchParams(window.location.search);
const oobCode = params.get("oobCode");
let userEmail = "";

function showState(state) {
  loadingEl.style.display = state === "loading" ? "" : "none";
  errorEl.style.display = state === "error" ? "" : "none";
  formEl.style.display = state === "form" ? "" : "none";
  successEl.style.display = state === "success" ? "" : "none";
}

// Validate the oobCode on page load
async function init() {
  if (!oobCode) {
    errorMsg.textContent = "No reset code found. Please use the link from your email.";
    showState("error");
    return;
  }

  try {
    userEmail = await verifyPasswordResetCode(auth, oobCode);
    emailEl.textContent = userEmail;
    showState("form");
    passwordInput.focus();
  } catch (err) {
    if (err.code === "auth/expired-action-code") {
      errorMsg.textContent = "This link has expired. Please request a new invite from your admin.";
    } else if (err.code === "auth/invalid-action-code") {
      errorMsg.textContent = "This link is invalid or has already been used.";
    } else {
      errorMsg.textContent = "Something went wrong. Please try again or contact support.";
    }
    showState("error");
  }
}

// Password strength checker
function checkStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 2) return { level: "weak", label: "Weak", percent: 25, color: "#ef4444" };
  if (score <= 4) return { level: "fair", label: "Fair", percent: 60, color: "#f59e0b" };
  return { level: "strong", label: "Strong", percent: 100, color: "#22c55e" };
}

function updateRequirements(pw) {
  const checks = [
    { el: reqLength, pass: pw.length >= 8 },
    { el: reqUpper, pass: /[A-Z]/.test(pw) },
    { el: reqLower, pass: /[a-z]/.test(pw) },
    { el: reqNumber, pass: /[0-9]/.test(pw) }
  ];

  checks.forEach(({ el, pass }) => {
    el.classList.toggle("met", pass);
  });

  return checks.every(c => c.pass);
}

function updateStrength(pw) {
  if (!pw) {
    strengthFill.style.width = "0";
    strengthLabel.textContent = "";
    return;
  }
  const s = checkStrength(pw);
  strengthFill.style.width = s.percent + "%";
  strengthFill.style.background = s.color;
  strengthLabel.textContent = s.label;
  strengthLabel.style.color = s.color;
}

function updateMatch() {
  const pw = passwordInput.value;
  const confirm = confirmInput.value;
  if (!confirm) {
    matchEl.textContent = "";
    return;
  }
  if (pw === confirm) {
    matchEl.textContent = "Passwords match";
    matchEl.className = "gd-pw-match match";
  } else {
    matchEl.textContent = "Passwords do not match";
    matchEl.className = "gd-pw-match no-match";
  }
}

passwordInput.addEventListener("input", () => {
  updateStrength(passwordInput.value);
  updateRequirements(passwordInput.value);
  if (confirmInput.value) updateMatch();
});

confirmInput.addEventListener("input", updateMatch);

// Submit handler
submitBtn.addEventListener("click", async () => {
  const pw = passwordInput.value;
  const confirm = confirmInput.value;
  formError.style.display = "none";

  if (!updateRequirements(pw)) {
    formError.textContent = "Password does not meet all requirements.";
    formError.style.display = "block";
    return;
  }

  if (pw !== confirm) {
    formError.textContent = "Passwords do not match.";
    formError.style.display = "block";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Setting password...";

  try {
    await confirmPasswordReset(auth, oobCode, pw);
    showState("success");

    // Auto sign in
    await signInWithEmailAndPassword(auth, userEmail, pw);

    // Redirect after brief delay so user sees success message
    setTimeout(() => {
      window.location.href = "/greendoor/app/dashboard";
    }, 1000);
  } catch (err) {
    showState("form");
    submitBtn.disabled = false;
    submitBtn.textContent = "Set Password & Continue";

    if (err.code === "auth/expired-action-code") {
      formError.textContent = "This link has expired. Please request a new one.";
    } else if (err.code === "auth/weak-password") {
      formError.textContent = "Password is too weak. Please choose a stronger password.";
    } else {
      formError.textContent = "Something went wrong. Please try again.";
    }
    formError.style.display = "block";
  }
});

init();
