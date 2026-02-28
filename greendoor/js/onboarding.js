import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast } from "./auth.js";

let currentStep = 1;
const TOTAL_STEPS = 4;

/* --- Pre-fill from invite data --- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const profile = await getCurrentUser();
  if (!profile) return;

  if (profile.fullName) {
    document.getElementById("onboard-name").value = profile.fullName;
  }
  if (profile.company) {
    document.getElementById("onboard-company").value = profile.company;
  }
  if (profile.phone) {
    document.getElementById("onboard-phone").value = profile.phone;
  }
});

/* --- Step navigation --- */
window.goToStep = function (step) {
  if (step < 1 || step > TOTAL_STEPS) return;

  // Hide all steps
  document.querySelectorAll(".gd-onboard-step").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".gd-step").forEach(el => {
    el.classList.remove("active", "completed");
  });

  // Mark completed and active steps
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const stepEl = document.querySelector(`.gd-step[data-step="${i}"]`);
    if (i < step) stepEl.classList.add("completed");
    if (i === step) stepEl.classList.add("active");
  }

  // Show target step
  document.getElementById(`step-${step}`).classList.add("active");
  currentStep = step;
};

/* --- Validate Step 1 before proceeding --- */
window.validateAndGoToStep = function (step) {
  const name = document.getElementById("onboard-name").value.trim();
  const phone = document.getElementById("onboard-phone").value.trim();

  if (!name) {
    showToast("Please enter your full name.", "error");
    document.getElementById("onboard-name").focus();
    return;
  }
  if (!phone) {
    showToast("Please enter your phone number.", "error");
    document.getElementById("onboard-phone").focus();
    return;
  }

  // Auto-generate email signature if empty
  const sigEl = document.getElementById("onboard-signature");
  if (!sigEl.value.trim()) {
    const company = document.getElementById("onboard-company").value.trim();
    sigEl.value = `Best regards,\n${name}${company ? "\n" + company : ""}\n${phone}`;
  }

  goToStep(step);
};

/* --- Finish onboarding --- */
window.finishOnboarding = async function () {
  const termsCheckbox = document.getElementById("terms-checkbox");
  if (!termsCheckbox.checked) {
    showToast("Please accept the Terms & Conditions.", "error");
    return;
  }

  const btn = document.getElementById("onboard-finish-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  const user = auth.currentUser;
  if (!user) return;

  const fullName = document.getElementById("onboard-name").value.trim();
  const phone = document.getElementById("onboard-phone").value.trim();
  const company = document.getElementById("onboard-company").value.trim();
  const emailSignature = document.getElementById("onboard-signature").value.trim();

  try {
    await setDoc(doc(db, "users", user.uid), {
      fullName: fullName || undefined,
      phone: phone || undefined,
      company: company || undefined,
      emailSignature: emailSignature || undefined,
      onboardingComplete: true,
      onboardingCompletedAt: serverTimestamp(),
      termsAcceptedAt: serverTimestamp()
    }, { merge: true });

    window.location.href = "/greendoor/app/dashboard";
  } catch (err) {
    console.error("Onboarding save error:", err);
    showToast("Failed to save profile. Please try again.", "error");
    btn.disabled = false;
    btn.textContent = "Go to Dashboard";
  }
};
