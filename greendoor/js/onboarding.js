import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast, escapeHtml } from "./auth.js";

let currentStep = 1;
const TOTAL_STEPS = 3;

/* --- Helpers --- */
function getInitials(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}

function generateDefaultSignature() {
  const name = document.getElementById("onboard-name").value.trim();
  const company = document.getElementById("onboard-company").value.trim();
  const phone = document.getElementById("onboard-phone").value.trim();
  return `Best regards,\n${name}${company ? "\n" + company : ""}\n${phone}`;
}

/* --- Avatar + live preview --- */
function updateAvatar() {
  const name = document.getElementById("onboard-name").value.trim();
  const avatar = document.getElementById("onboard-avatar");
  const initials = getInitials(name);

  if (initials) {
    avatar.textContent = initials;
  } else {
    avatar.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/></svg>';
  }
}

function updateLivePreview() {
  const name = document.getElementById("onboard-name").value.trim();
  const phone = document.getElementById("onboard-phone").value.trim();
  const preview = document.getElementById("profile-preview");
  const previewAvatar = document.getElementById("preview-avatar");
  const previewName = document.getElementById("preview-name");
  const previewPhone = document.getElementById("preview-phone");

  if (name || phone) {
    preview.style.display = '';
    previewAvatar.textContent = getInitials(name) || '?';
    previewName.textContent = name || 'Your Name';
    previewPhone.textContent = phone || '';
  } else {
    preview.style.display = 'none';
  }
}

/* --- Signature preview --- */
function updateSigPreview() {
  const sig = document.getElementById("onboard-signature").value;
  const preview = document.getElementById("sig-preview");
  preview.textContent = sig || 'Your signature will appear here...';
}

/* --- Phone formatting --- */
function handlePhoneInput(e) {
  const input = e.target;
  const cursorPos = input.selectionStart;
  const prevLen = input.value.length;
  input.value = formatPhone(input.value);
  // Adjust cursor position after formatting
  const diff = input.value.length - prevLen;
  input.setSelectionRange(cursorPos + diff, cursorPos + diff);
  updateLivePreview();
}

/* --- Step navigation with transitions --- */
window.goToStep = function (step) {
  if (step < 1 || step > TOTAL_STEPS) return;
  if (step === currentStep) return;

  const oldStepEl = document.getElementById(`step-${currentStep}`);
  const newStepEl = document.getElementById(`step-${step}`);

  // Animate out old step
  oldStepEl.classList.remove("active");
  oldStepEl.classList.add("leaving");

  // After outgoing animation, show new step
  setTimeout(() => {
    oldStepEl.classList.remove("leaving");

    // Update stepper dots and lines
    document.querySelectorAll(".gd-step").forEach(el => {
      el.classList.remove("active", "completed");
    });
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const stepDot = document.querySelector(`.gd-step[data-step="${i}"]`);
      const dotEl = stepDot.querySelector('.gd-step-dot');
      if (i < step) {
        stepDot.classList.add("completed");
        dotEl.innerHTML = '&#10003;';
      } else if (i === step) {
        stepDot.classList.add("active");
        dotEl.textContent = i;
      } else {
        dotEl.textContent = i;
      }
    }
    // Fill step connector lines
    document.querySelectorAll('.gd-step-line').forEach(line => {
      const afterStep = parseInt(line.getAttribute('data-after'));
      if (afterStep < step) {
        line.classList.add('filled');
      } else {
        line.classList.remove('filled');
      }
    });

    // Show new step
    newStepEl.classList.add("active");
    currentStep = step;

    // Step-specific hooks
    if (step === 2) onEnterStep2();
    if (step === 3) onEnterStep3();
  }, 200);
};

/* --- Step 2: auto-populate signature on arrival --- */
function onEnterStep2() {
  const sigEl = document.getElementById("onboard-signature");
  if (!sigEl.value.trim()) {
    sigEl.value = generateDefaultSignature();
  }
  updateSigPreview();
}

/* --- Step 3: personalized heading + setup summary --- */
function onEnterStep3() {
  const name = document.getElementById("onboard-name").value.trim();
  const company = document.getElementById("onboard-company").value.trim();
  const firstName = name ? name.split(/\s+/)[0] : '';

  // Personalized title
  const title = document.getElementById("step3-title");
  title.textContent = firstName ? `You're all set, ${firstName}!` : "You're Ready";

  // Setup summary
  const summary = document.getElementById("setup-summary");
  summary.innerHTML = `
    <div class="gd-setup-summary-item">
      <span class="gd-setup-summary-check">&#10003;</span>
      <span>Profile: <strong>${escapeHtml(name) || 'Not set'}</strong></span>
    </div>
    <div class="gd-setup-summary-item">
      <span class="gd-setup-summary-check">&#10003;</span>
      <span>Company: ${company ? '<strong>' + escapeHtml(company) + '</strong>' : '<span class="gd-setup-summary-muted">Not set</span>'}</span>
    </div>
    <div class="gd-setup-summary-item">
      <span class="gd-setup-summary-check">&#10003;</span>
      <span>Signature: <strong>Configured</strong></span>
    </div>
  `;

  // Celebration glow
  const step3 = document.getElementById("step-3");
  step3.classList.remove("celebrate");
  void step3.offsetWidth;
  step3.classList.add("celebrate");
}

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

  goToStep(step);
};

/* --- Finish onboarding (with re-validation) --- */
window.finishOnboarding = async function () {
  const termsCheckbox = document.getElementById("terms-checkbox");
  if (!termsCheckbox.checked) {
    showToast("Please accept the Terms & Conditions.", "error");
    return;
  }

  // Re-validate name and phone
  const fullName = document.getElementById("onboard-name").value.trim();
  const phone = document.getElementById("onboard-phone").value.trim();
  if (!fullName || !phone) {
    showToast("Name and phone are required. Returning to Profile.", "error");
    goToStep(1);
    return;
  }

  const btn = document.getElementById("onboard-finish-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  const user = auth.currentUser;
  if (!user) return;

  const company = document.getElementById("onboard-company").value.trim();
  const emailSignature = document.getElementById("onboard-signature").value.trim();

  try {
    await setDoc(doc(db, "users", user.uid), {
      fullName: fullName || undefined,
      phone: phone || undefined,
      company: company || undefined,
      emailSignature: emailSignature || undefined,
      onboardingComplete: true,
      showTour: true,
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
    document.getElementById("onboard-phone").value = formatPhone(profile.phone);
  }

  // Initial avatar + preview update after pre-fill
  updateAvatar();
  updateLivePreview();
});

/* --- Event listeners --- */
document.getElementById("onboard-name").addEventListener("input", () => {
  updateAvatar();
  updateLivePreview();
});
document.getElementById("onboard-phone").addEventListener("input", handlePhoneInput);
document.getElementById("onboard-signature").addEventListener("input", updateSigPreview);
document.getElementById("sig-reset-btn").addEventListener("click", () => {
  document.getElementById("onboard-signature").value = generateDefaultSignature();
  updateSigPreview();
});
