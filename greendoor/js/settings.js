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

  try {
    const profile = await getCurrentUser();
    if (!profile) return;

    document.getElementById("set-fullName").value = profile.fullName || "";
    document.getElementById("set-phone").value = profile.phone || "";
    document.getElementById("set-company").value = profile.company || "";
    document.getElementById("set-emailSignature").value = profile.emailSignature || "";
    renderSignatureImage(profile.emailSignatureImageUrl || "");

    // Load templates and sequences — don't block page if they fail
    const results = await Promise.allSettled([
      loadTemplates(user.uid),
      loadSequences(user.uid)
    ]);
    results.forEach((r, i) => {
      if (r.status === "rejected") console.error(`Settings loader ${i} failed:`, r.reason);
    });
    renderEmailSenderStatus(profile);
    renderGmailConnection(profile);
    renderShowingTimeIntegration(profile);

    setTimeout(() => checkAndResumeTour(), 400);
  } catch (e) {
    console.error("Settings init error:", e);
    showToast("Failed to load settings. Please refresh.", "error");
  } finally {
    document.getElementById("settings-loading").classList.add("gd-hidden");
    document.getElementById("settings-content").classList.remove("gd-hidden");
  }
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

/* ===== SIGNATURE IMAGE ===== */
function renderSignatureImage(url) {
  const preview = document.getElementById("set-signatureImage-preview");
  const empty = document.getElementById("set-signatureImage-empty");
  const removeBtn = document.getElementById("set-signatureImage-remove");
  if (!preview) return;
  if (url) {
    preview.src = url;
    preview.style.display = "";
    empty.style.display = "none";
    removeBtn.style.display = "";
  } else {
    preview.src = "";
    preview.style.display = "none";
    empty.style.display = "";
    removeBtn.style.display = "none";
  }
}

window.uploadSignatureImage = async function (file) {
  const user = auth.currentUser;
  if (!user || !file) return;
  if (file.size > 200 * 1024) {
    showToast("Image too large — keep it under 200 KB.", "error");
    return;
  }
  if (!/^image\/(png|jpe?g|gif)$/i.test(file.type)) {
    showToast("Only PNG, JPG, or GIF images are allowed.", "error");
    return;
  }
  try {
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, "png"])[1].toLowerCase();
    const path = `users/${user.uid}/signature/image.${ext}`;
    const storageRef = ref(storage, path);
    await uploadBytesResumable(storageRef, file);
    const url = await getDownloadURL(storageRef);
    await setDoc(doc(db, "users", user.uid), {
      emailSignatureImageUrl: url,
      emailSignatureImagePath: path
    }, { merge: true });
    renderSignatureImage(url);
    showToast("Signature image uploaded.");
  } catch (err) {
    console.error("Signature upload error:", err);
    showToast("Failed to upload image.", "error");
  }
};

window.removeSignatureImage = async function () {
  const user = auth.currentUser;
  if (!user) return;
  if (!confirm("Remove your signature image?")) return;
  try {
    const profile = await getCurrentUser();
    const path = profile?.emailSignatureImagePath;
    if (path) {
      await deleteObject(ref(storage, path)).catch(() => {});
    }
    await setDoc(doc(db, "users", user.uid), {
      emailSignatureImageUrl: null,
      emailSignatureImagePath: null
    }, { merge: true });
    renderSignatureImage("");
    showToast("Signature image removed.");
  } catch (err) {
    console.error("Signature remove error:", err);
    showToast("Failed to remove image.", "error");
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

/* ===== EMAIL SENDER STATUS ===== */

function renderEmailSenderStatus(profile) {
  const el = document.getElementById("email-sender-status");
  if (!el) return;

  const userEmail = profile.email || auth.currentUser?.email || "";

  el.innerHTML = `
    <div class="gd-email-sender-row">
      <div class="gd-email-sender-info">
        <span class="gd-settings-status-dot gd-connected"></span>
        <div>
          <div class="gd-email-sender-label">Sending from <strong>greendoor@stoekmedia.com</strong></div>
          <div class="gd-text-muted" style="font-size: 0.8rem;">Replies route to <strong>${escapeHtml(userEmail)}</strong>. Your name appears in the From line so clients still recognize you.</div>
        </div>
      </div>
    </div>`;
}

/* ===== GMAIL OAUTH CONNECTION ===== */

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send openid email";

function gmailRedirectUri() {
  return `${window.location.origin}/greendoor/app/oauth-callback.html`;
}

function renderGmailConnection(profile) {
  const el = document.getElementById("gmail-connection-status");
  if (!el) return;

  const oauth = profile.gmailOAuth || null;
  if (oauth && oauth.email) {
    el.innerHTML = `
      <div class="gd-email-sender-row">
        <div class="gd-email-sender-info">
          <span class="gd-settings-status-dot gd-connected"></span>
          <div>
            <div class="gd-email-sender-label">Connected as <strong>${escapeHtml(oauth.email)}</strong></div>
            <div class="gd-text-muted" style="font-size: 0.8rem;">Emails to your clients now send from your Gmail account with proper authentication.</div>
          </div>
        </div>
        <button class="gd-btn gd-btn-outline gd-btn-sm" onclick="disconnectGmail()">Disconnect</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="gd-email-sender-row">
        <div class="gd-email-sender-info">
          <span class="gd-settings-status-dot" style="background: #9ca3af;"></span>
          <div>
            <div class="gd-email-sender-label">Not connected</div>
            <div class="gd-text-muted" style="font-size: 0.8rem;">Connect Gmail to send as your real email address. Otherwise we send via GreenDoor with replies routed to you.</div>
          </div>
        </div>
        <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="connectGmail()">Connect Gmail</button>
      </div>`;
  }
}

window.connectGmail = async function () {
  try {
    showToast("Opening Google sign-in...");
    const getConfig = httpsCallable(functions, "getGoogleOAuthConfig");
    const { data } = await getConfig();
    if (!data.configured) {
      showToast("Gmail connection is not configured yet. Please contact support.", "error");
      return;
    }
    // Stash the current location so the callback can return us here.
    sessionStorage.setItem("oauthReturnTo", window.location.pathname + window.location.search);

    const params = new URLSearchParams({
      client_id: data.clientId,
      redirect_uri: gmailRedirectUri(),
      response_type: "code",
      scope: GMAIL_SEND_SCOPE,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent" // force refresh_token issuance
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  } catch (e) {
    console.error("connectGmail error:", e);
    showToast("Failed to start Gmail connection.", "error");
  }
};

window.disconnectGmail = async function () {
  if (!confirm("Disconnect your Gmail account? Emails will revert to sending via GreenDoor.")) return;
  try {
    const fn = httpsCallable(functions, "disconnectGmail");
    await fn();
    showToast("Gmail disconnected.");
    const profile = await getCurrentUser();
    if (profile) renderGmailConnection(profile);
  } catch (e) {
    console.error("disconnectGmail error:", e);
    showToast("Failed to disconnect Gmail.", "error");
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

  // Soft check: ShowingTime feeds end in .ics or contain "showingtime" in the host
  const looksLikeFeed = /\.ics(\?|$)/i.test(url) || /showingtime/i.test(url);
  if (!looksLikeFeed && !confirm("This URL doesn't look like a ShowingTime .ics feed. Save anyway?")) {
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

/* ===== FOLLOW-UP SEQUENCES ===== */
const createSequenceFn = httpsCallable(functions, "createSequence");
const getCalendarFeedUrlFn = httpsCallable(functions, "getCalendarFeedUrl");

let stepCounter = 1;

async function loadSequences(uid) {
  const q = query(collection(db, "followUpSequences"), where("realtorId", "==", uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const container = document.getElementById("sequences-list");
  if (!container) return;

  if (snap.empty) {
    container.innerHTML = '<p class="gd-text-muted-sm">No sequences yet. Create one to start automating follow-ups.</p>';
    return;
  }

  container.innerHTML = snap.docs.map(d => {
    const s = d.data();
    const stepCount = s.steps?.length || 0;
    return `
      <div class="gd-card gd-settings-card" style="margin-bottom:0.75rem;padding:14px 18px;">
        <div class="gd-flex-between">
          <div>
            <strong>${escapeHtml(s.name)}</strong>
            <span class="gd-text-muted-xs" style="margin-left:8px;">${stepCount} step${stepCount !== 1 ? "s" : ""}</span>
          </div>
          <button class="gd-btn gd-btn-sm" style="color:var(--gd-red);" onclick="deleteSequence('${d.id}')">Delete</button>
        </div>
        <div class="gd-text-muted-xs gd-mt-sm">
          ${(s.steps || []).map((step, i) => `Day ${step.delayDays}: ${escapeHtml(step.subject)}`).join(" &rarr; ")}
        </div>
      </div>`;
  }).join("");
}

function makeStepEl(idx) {
  const div = document.createElement("div");
  div.className = "gd-seq-step";
  div.dataset.step = idx;
  if (idx > 0) {
    div.style.cssText = "border-top:1px solid #e5e7eb;padding-top:12px;margin-top:12px;";
  }
  div.innerHTML = `
    <div class="gd-form-row gd-gap-sm">
      <div class="gd-form-group" style="max-width:100px;">
        <label>Delay (days)</label>
        <input type="number" class="gd-input seq-delay" value="${idx === 0 ? 0 : idx * 3}" min="0">
      </div>
      <div class="gd-form-group gd-flex-1">
        <label>Subject</label>
        <input type="text" class="gd-input seq-subject" placeholder="Email subject line">
      </div>
    </div>
    <div class="gd-form-group">
      <label>Body</label>
      <textarea class="gd-input seq-body" rows="3" placeholder="Use {{clientName}}, {{clientFirstName}}, {{realtorName}}"></textarea>
    </div>`;
  return div;
}

window.openCreateSequenceModal = function () {
  document.getElementById("seq-name").value = "";
  const container = document.getElementById("seq-steps");
  container.innerHTML = "";
  container.appendChild(makeStepEl(0));
  stepCounter = 1;
  document.getElementById("sequence-modal").classList.add("active");
};

window.closeCreateSequenceModal = function () {
  document.getElementById("sequence-modal").classList.remove("active");
};

window.addSequenceStep = function () {
  document.getElementById("seq-steps").appendChild(makeStepEl(stepCounter));
  stepCounter++;
};

window.saveSequence = async function () {
  const name = document.getElementById("seq-name").value.trim();
  if (!name) { showToast("Sequence name is required.", "error"); return; }

  const stepEls = document.querySelectorAll(".gd-seq-step");
  const steps = [];
  for (const el of stepEls) {
    const delay = parseInt(el.querySelector(".seq-delay").value) || 0;
    const subject = el.querySelector(".seq-subject").value.trim();
    const body = el.querySelector(".seq-body").value.trim();
    if (!subject) { showToast("Each step needs a subject line.", "error"); return; }
    steps.push({ delayDays: delay, subject, body });
  }

  if (!steps.length) { showToast("Add at least one step.", "error"); return; }

  for (let i = 1; i < steps.length; i++) {
    if (steps[i].delayDays < steps[i - 1].delayDays) {
      showToast("Step delays must be in increasing order (day 1 → day 7, not day 7 → day 1).", "error");
      return;
    }
  }

  try {
    await createSequenceFn({ name, steps });
    showToast("Sequence created!");
    closeCreateSequenceModal();
    const user = auth.currentUser;
    if (user) await loadSequences(user.uid);
  } catch (e) {
    console.error("Save sequence error:", e);
    showToast("Failed to create sequence.", "error");
  }
};

window.deleteSequence = async function (id) {
  if (!confirm("Delete this sequence? Active enrollments will be cancelled.")) return;
  try {
    await updateDoc(doc(db, "followUpSequences", id), { isActive: false });

    // Cancel active enrollments
    const enrollSnap = await getDocs(query(
      collection(db, "sequenceEnrollments"),
      where("sequenceId", "==", id),
      where("status", "==", "active")
    ));
    for (const d of enrollSnap.docs) {
      await updateDoc(d.ref, { status: "cancelled" });
    }

    showToast("Sequence deleted.");
    const user = auth.currentUser;
    if (user) await loadSequences(user.uid);
  } catch (e) {
    console.error("Delete sequence error:", e);
    showToast("Failed to delete sequence.", "error");
  }
};

/* ===== CALENDAR FEED ===== */
window.generateCalendarFeed = async function () {
  const section = document.getElementById("calendar-feed-section");
  if (!section) return;
  section.innerHTML = '<div class="gd-spinner"></div>';

  try {
    const result = await getCalendarFeedUrlFn();
    const url = result.data.feedUrl;
    section.innerHTML = `
      <div class="gd-form-group">
        <label>Your Calendar Feed URL</label>
        <div class="gd-flex gd-gap-sm">
          <input type="text" class="gd-input gd-flex-1" value="${escapeHtml(url)}" readonly onclick="this.select()">
          <button class="gd-btn" onclick="navigator.clipboard.writeText('${url}'); showToast('Copied!');">Copy</button>
        </div>
      </div>
      <p class="gd-text-muted-xs gd-mt-sm">
        <strong>Google Calendar:</strong> Settings &rarr; Add calendar &rarr; From URL &rarr; paste the URL above.<br>
        <strong>Apple Calendar:</strong> File &rarr; New Calendar Subscription &rarr; paste the URL.<br>
        <strong>Outlook:</strong> Add calendar &rarr; Subscribe from web &rarr; paste the URL.
      </p>`;
  } catch (e) {
    console.error("Calendar feed error:", e);
    section.innerHTML = '<p class="gd-text-muted-sm" style="color:var(--gd-red);">Failed to generate feed URL. Please try again.</p>';
  }
};
