import { auth, db, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast } from "./auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const profile = await getCurrentUser();
  if (!profile) return;

  document.getElementById("set-fullName").value = profile.fullName || "";
  document.getElementById("set-phone").value = profile.phone || "";
  document.getElementById("set-company").value = profile.company || "";
  document.getElementById("set-emailSignature").value = profile.emailSignature || "";

  // Show diagnostics button for admins
  if (profile.role === "admin") {
    const diagEl = document.getElementById("boldsign-diagnostics");
    if (diagEl) diagEl.style.display = "";
  }

  document.getElementById("settings-loading").classList.add("gd-hidden");
  document.getElementById("settings-content").classList.remove("gd-hidden");
});

window.saveProfile = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const data = {
    fullName: document.getElementById("set-fullName").value.trim(),
    phone: document.getElementById("set-phone").value.trim(),
    company: document.getElementById("set-company").value.trim(),
    emailSignature: document.getElementById("set-emailSignature").value
  };

  try {
    await setDoc(doc(db, "users", user.uid), data, { merge: true });
    showToast("Profile saved!");
  } catch (e) {
    console.error("Save profile error:", e);
    showToast("Failed to save profile.", "error");
  }
};

window.runBoldSignTest = async function () {
  const btn = document.getElementById("btn-run-diagnostics");
  const resultsEl = document.getElementById("diagnostics-results");
  btn.disabled = true;
  btn.textContent = "Running...";
  resultsEl.style.display = "block";
  resultsEl.innerHTML = '<div class="gd-spinner gd-spinner-sm"></div> Running 7 tests...';

  try {
    const stressTest = httpsCallable(functions, "stressTestBoldSign");
    const { data } = await stressTest();

    let html = `<div class="gd-diag-summary">${data.summary}</div>`;
    html += data.results.map(r =>
      `<div class="gd-diag-row">` +
        `<span class="gd-diag-badge ${r.passed ? "gd-diag-pass" : "gd-diag-fail"}">${r.passed ? "PASS" : "FAIL"}</span>` +
        `<span class="gd-diag-name">${r.test}</span>` +
        `<span class="gd-diag-detail">${r.details}</span>` +
      `</div>`
    ).join("");

    resultsEl.innerHTML = html;
  } catch (e) {
    console.error("Stress test error:", e);
    resultsEl.innerHTML = `<div class="gd-diag-row"><span class="gd-diag-badge gd-diag-fail">ERROR</span> ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Run Diagnostics";
  }
};
