import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  collection, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getCurrentUser, showToast, formatFileSize, escapeHtml, formatDateTime } from "./auth.js";
import { checkAndResumeTour } from "./tour.js";

let allTemplates = [];

/* ===== SETTINGS TAB SWITCHING ===== */

function switchSettingsTab(tabName) {
  document.querySelectorAll(".gd-settings-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === tabName)
  );
  document.querySelectorAll(".gd-settings-main .gd-tab-content").forEach(c =>
    c.classList.toggle("active", c.id === `tab-${tabName}`)
  );
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".gd-settings-tab").forEach(tab => {
    tab.addEventListener("click", () => switchSettingsTab(tab.dataset.tab));
  });
});

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
  renderShowingTimeIntegration(profile);

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
    resultsEl.innerHTML = `<div class="gd-diag-row"><span class="gd-diag-badge gd-diag-fail">ERROR</span> ${escapeHtml(e.message)}</div>`;
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
            <div class="gd-email-sender-label">Sending as <strong>${escapeHtml(userEmail)}</strong></div>
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
            <div class="gd-email-sender-label">Verification pending for <strong>${escapeHtml(userEmail)}</strong></div>
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
            <div class="gd-text-muted" style="font-size: 0.8rem;">Your email (${escapeHtml(userEmail)}) is set as Reply-To. Verify your email to send directly from your address.</div>
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

/* ===== SHOWINGTIME INTEGRATION ===== */

function renderShowingTimeIntegration(profile) {
  const el = document.getElementById("showingtime-integration");
  if (!el) return;

  const feedUrl = profile.showingTimeFeedUrl;

  if (!feedUrl) {
    // Disconnected state: setup guide + feed URL input
    el.innerHTML = `
      <div style="margin-bottom: 1rem;">
        <strong>ShowingTime Calendar Sync</strong>
        <p class="gd-text-muted" style="font-size: 0.85rem; margin: 0.5rem 0;">
          Connect your ShowingTime feed to automatically import showings into your GreenDoor calendar.
        </p>
        <div style="background: var(--gd-bg-secondary, #f8f9fa); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.85rem;">
          <strong style="display: block; margin-bottom: 0.5rem;">How to find your iCal feed URL:</strong>
          <ol style="margin: 0; padding-left: 1.25rem; line-height: 1.7;">
            <li>Log in to your ShowingTime account</li>
            <li>Go to <strong>Menu &gt; Profile &gt; Calendar Sync</strong></li>
            <li>Choose your feed options (All Appointments recommended)</li>
            <li>Copy the iCal/webcal feed URL</li>
            <li>Paste the URL below and click Save</li>
          </ol>
        </div>
        <div class="gd-form-group" style="margin-bottom: 0.75rem;">
          <input type="text" id="st-feed-url" class="gd-input" placeholder="webcal://... or https://... feed URL">
        </div>
        <button class="gd-btn gd-btn-primary" onclick="saveShowingTimeFeed()">Save</button>
      </div>`;
  } else {
    // Connected state
    const truncatedUrl = feedUrl.length > 50 ? feedUrl.substring(0, 50) + "..." : feedUrl;
    const lastSynced = profile.showingTimeLastSyncedAt
      ? formatDateTime(profile.showingTimeLastSyncedAt)
      : "Never synced";
    const syncCountText = profile.showingTimeSyncCount != null
      ? ` (${profile.showingTimeSyncCount} showings)`
      : "";
    const syncError = profile.showingTimeSyncError;

    let errorHtml = "";
    if (syncError) {
      errorHtml = `
        <div style="border: 1px solid #ef4444; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; background: #fef2f2;">
          <strong style="color: #ef4444; display: block; margin-bottom: 0.25rem;">Sync Error</strong>
          <p style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #991b1b;">${escapeHtml(syncError)}</p>
          <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.8rem; color: #7f1d1d; line-height: 1.6;">
            <li>Check that your URL starts with webcal:// or https://</li>
            <li>Verify your ShowingTime feed is still active</li>
            <li>Try re-copying the URL from ShowingTime &gt; Profile &gt; Calendar Sync</li>
          </ul>
        </div>`;
    }

    el.innerHTML = `
      <div>
        <strong>ShowingTime Calendar Sync</strong>
        <div class="gd-email-sender-row" style="margin-top: 0.5rem;">
          <div class="gd-email-sender-info">
            <span class="gd-settings-status-dot gd-connected"></span>
            <div>
              <div class="gd-email-sender-label">Connected</div>
              <div class="gd-text-muted" style="font-size: 0.8rem;">${escapeHtml(truncatedUrl)}</div>
            </div>
          </div>
        </div>
        <div class="gd-text-muted" style="font-size: 0.8rem; margin: 0.5rem 0;">
          Last synced: ${escapeHtml(lastSynced)}${escapeHtml(syncCountText)}
        </div>
        ${errorHtml}
        <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
          <button id="btn-sync-st" class="gd-btn gd-btn-primary gd-btn-sm" onclick="syncShowingTimeNow()">Sync Now</button>
          <button class="gd-btn gd-btn-outline gd-btn-sm" onclick="disconnectShowingTime()">Disconnect</button>
        </div>
      </div>`;
  }
}

window.saveShowingTimeFeed = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const urlInput = document.getElementById("st-feed-url");
  const url = (urlInput?.value || "").trim();

  if (!url) {
    showToast("Please enter a feed URL.", "error");
    return;
  }

  if (!url.startsWith("webcal://") && !url.startsWith("https://") && !url.startsWith("http://")) {
    showToast("Feed URL must start with webcal://, https://, or http://", "error");
    return;
  }

  try {
    await setDoc(doc(db, "users", user.uid), { showingTimeFeedUrl: url }, { merge: true });
    showToast("Feed URL saved! Click Sync Now to import showings.");
    const profile = await getCurrentUser();
    if (profile) renderShowingTimeIntegration(profile);
  } catch (e) {
    console.error("Save feed URL error:", e);
    showToast("Failed to save feed URL.", "error");
  }
};

window.syncShowingTimeNow = async function () {
  const btn = document.getElementById("btn-sync-st");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="gd-spinner gd-spinner-sm" style="margin-right:0.5rem;"></span>Syncing...';
  }

  try {
    const syncFn = httpsCallable(functions, "syncShowingTime");
    const { data } = await syncFn();

    let msg = `Synced ${data.synced} showings`;
    if (data.removed > 0) {
      msg += `, removed ${data.removed}`;
    }
    showToast(msg);
  } catch (e) {
    console.error("Sync ShowingTime error:", e);
    const errMsg = e.message || "Sync failed.";
    showToast(errMsg, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "Sync Now";
    }
    // Re-render to show updated timestamp/error
    const profile = await getCurrentUser();
    if (profile) renderShowingTimeIntegration(profile);
  }
};

window.disconnectShowingTime = async function () {
  if (!confirm("Disconnect ShowingTime? This will stop syncing and remove all imported showings from your calendar.")) return;

  const user = auth.currentUser;
  if (!user) return;

  try {
    // Clear feed URL and sync metadata
    await setDoc(doc(db, "users", user.uid), {
      showingTimeFeedUrl: null,
      showingTimeLastSyncedAt: null,
      showingTimeSyncError: null,
      showingTimeSyncCount: null
    }, { merge: true });

    // Delete all ST showings for this user
    const q = query(
      collection(db, "showings"),
      where("realtorId", "==", user.uid),
      where("source", "==", "showingtime")
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      // Delete in batches (client-side uses individual deleteDoc)
      const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);
    }

    showToast("ShowingTime disconnected.");
    const profile = await getCurrentUser();
    if (profile) renderShowingTimeIntegration(profile);
  } catch (e) {
    console.error("Disconnect ShowingTime error:", e);
    showToast("Failed to disconnect ShowingTime.", "error");
  }
};
