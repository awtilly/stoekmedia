import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  collection, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getCurrentUser, showToast, formatFileSize } from "./auth.js";
import { checkAndResumeTour } from "./tour.js";

let allTemplates = [];

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

  await loadTemplates(user.uid);
  renderEmailSenderStatus(profile);

  document.getElementById("settings-loading").classList.add("gd-hidden");
  document.getElementById("settings-content").classList.remove("gd-hidden");

  setTimeout(() => checkAndResumeTour(), 400);
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

/* ===== DOCUMENT TEMPLATES ===== */

async function loadTemplates(uid) {
  try {
    const q = query(
      collection(db, "templateFiles"),
      where("realtorId", "==", uid),
      orderBy("uploadedAt", "desc")
    );
    const snap = await getDocs(q);
    allTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTemplates();
  } catch (e) {
    console.error("Load templates error:", e);
  }
}

function renderTemplates() {
  const el = document.getElementById("template-list");
  if (allTemplates.length === 0) {
    el.innerHTML = '<p class="gd-text-muted" style="font-size:0.85rem;">No templates uploaded yet. Upload documents above to build your template library.</p>';
    return;
  }
  el.innerHTML = allTemplates.map(t => `
    <div class="gd-tpl-row" data-id="${t.id}">
      <input type="text" class="gd-tpl-name-input" value="${(t.templateName || t.fileName || "").replace(/"/g, '&quot;')}" data-id="${t.id}" title="Click to rename">
      <span class="gd-badge gd-badge-${t.category || 'other'}" style="font-size:0.7rem;">${t.category || 'other'}</span>
      <span class="gd-text-muted" style="font-size:0.75rem; white-space:nowrap;">${formatFileSize(t.fileSize)}</span>
      <button class="gd-tpl-delete" onclick="deleteTemplate('${t.id}', '${(t.storagePath || "").replace(/'/g, "\\'")}')" title="Delete template">&times;</button>
    </div>`).join("");

  // Attach rename blur listeners
  el.querySelectorAll(".gd-tpl-name-input").forEach(input => {
    input.addEventListener("blur", () => {
      const newName = input.value.trim();
      const id = input.dataset.id;
      const tpl = allTemplates.find(t => t.id === id);
      if (tpl && newName && newName !== (tpl.templateName || tpl.fileName)) {
        renameTemplate(id, newName);
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });
}

async function renameTemplate(id, newName) {
  try {
    await updateDoc(doc(db, "templateFiles", id), { templateName: newName });
    const tpl = allTemplates.find(t => t.id === id);
    if (tpl) tpl.templateName = newName;
    showToast("Template renamed.");
  } catch (e) {
    console.error("Rename template error:", e);
    showToast("Failed to rename template.", "error");
  }
}

window.deleteTemplate = async function (id, storagePath) {
  if (!confirm("Delete this template? This cannot be undone.")) return;
  try {
    if (storagePath) {
      await deleteObject(ref(storage, storagePath));
    }
    await deleteDoc(doc(db, "templateFiles", id));
    allTemplates = allTemplates.filter(t => t.id !== id);
    renderTemplates();
    showToast("Template deleted.");
  } catch (e) {
    console.error("Delete template error:", e);
    showToast("Failed to delete template.", "error");
  }
};

// Upload handler
document.getElementById("tpl-file-input").addEventListener("change", async (e) => {
  const user = auth.currentUser;
  if (!user) return;

  const files = e.target.files;
  if (!files.length) return;

  const category = document.getElementById("tpl-category").value;
  const progressEl = document.getElementById("tpl-progress");
  const progressFill = document.getElementById("tpl-progress-fill");
  const progressText = document.getElementById("tpl-progress-text");
  progressEl.classList.remove("gd-hidden");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    progressText.textContent = `Uploading ${i + 1} of ${files.length}...`;
    progressFill.style.width = "0%";

    try {
      const storagePath = `templates/${user.uid}/${category}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      await new Promise((resolve, reject) => {
        uploadTask.on("state_changed",
          (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            progressFill.style.width = pct + "%";
          },
          reject,
          resolve
        );
      });

      const downloadUrl = await getDownloadURL(storageRef);

      await addDoc(collection(db, "templateFiles"), {
        realtorId: user.uid,
        templateName: file.name.replace(/\.[^/.]+$/, ""),
        fileName: file.name,
        category,
        storagePath,
        downloadUrl,
        fileSize: file.size,
        mimeType: file.type,
        uploadedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Template upload error:", err);
      showToast(`Failed to upload ${file.name}`, "error");
    }
  }

  progressEl.classList.add("gd-hidden");
  await loadTemplates(user.uid);
  e.target.value = "";
});

/* ===== BOLDSIGN DIAGNOSTICS ===== */

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

/* ===== EMAIL SENDER VERIFICATION ===== */

function renderEmailSenderStatus(profile) {
  const el = document.getElementById("email-sender-status");
  if (!el) return;

  const verified = profile.senderVerified === true;
  const pending = profile.sendgridSenderId && !verified;
  const userEmail = profile.email || auth.currentUser?.email || "";

  if (verified) {
    el.innerHTML = `
      <div class="gd-email-sender-row">
        <div class="gd-email-sender-info">
          <span class="gd-settings-status-dot gd-connected"></span>
          <div>
            <div class="gd-email-sender-label">Sending as <strong>${userEmail}</strong></div>
            <div class="gd-text-muted" style="font-size: 0.8rem;">Clients see your email address as the sender.</div>
          </div>
        </div>
        <button class="gd-btn gd-btn-outline gd-btn-sm" onclick="removeSenderVerification()">Remove</button>
      </div>`;
  } else if (pending) {
    el.innerHTML = `
      <div class="gd-email-sender-row">
        <div class="gd-email-sender-info">
          <span class="gd-settings-status-dot" style="background: #f59e0b;"></span>
          <div>
            <div class="gd-email-sender-label">Verification pending for <strong>${userEmail}</strong></div>
            <div class="gd-text-muted" style="font-size: 0.8rem;">Check your inbox and click the verification link from SendGrid.</div>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="checkVerificationStatus()">Check Status</button>
          <button class="gd-btn gd-btn-outline gd-btn-sm" onclick="requestVerification()">Resend</button>
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="gd-email-sender-row">
        <div class="gd-email-sender-info">
          <span class="gd-settings-status-dot gd-connected"></span>
          <div>
            <div class="gd-email-sender-label">Sending from <strong>greendoor@stoekmedia.com</strong></div>
            <div class="gd-text-muted" style="font-size: 0.8rem;">Your email (${userEmail}) is set as Reply-To. Verify your email to send directly from your address.</div>
          </div>
        </div>
        <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="requestVerification()">Verify My Email</button>
      </div>`;
  }
}

window.requestVerification = async function () {
  try {
    showToast("Sending verification email...");
    const fn = httpsCallable(functions, "requestSenderVerification");
    const { data } = await fn();

    if (data.alreadyVerified) {
      showToast("Your email is already verified!");
    } else {
      showToast("Verification email sent — check your inbox.");
    }

    const profile = await getCurrentUser();
    if (profile) renderEmailSenderStatus(profile);
  } catch (e) {
    console.error("Request verification error:", e);
    showToast("Failed to send verification email.", "error");
  }
};

window.checkVerificationStatus = async function () {
  try {
    const fn = httpsCallable(functions, "checkSenderVerification");
    const { data } = await fn();

    if (data.verified) {
      showToast("Email verified! Emails will now send from your address.");
    } else {
      showToast("Not yet verified. Check your inbox for the verification link.", "error");
    }

    const profile = await getCurrentUser();
    if (profile) renderEmailSenderStatus(profile);
  } catch (e) {
    console.error("Check verification error:", e);
    showToast("Failed to check verification status.", "error");
  }
};

window.removeSenderVerification = async function () {
  if (!confirm("Remove email verification? Emails will revert to sending from greendoor@stoekmedia.com.")) return;

  try {
    const fn = httpsCallable(functions, "removeSenderVerification");
    await fn();
    showToast("Sender verification removed.");

    const profile = await getCurrentUser();
    if (profile) renderEmailSenderStatus(profile);
  } catch (e) {
    console.error("Remove verification error:", e);
    showToast("Failed to remove verification.", "error");
  }
};
