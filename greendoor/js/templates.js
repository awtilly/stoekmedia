/* ============================================================
   GreenDoor CRM — Templates (My Templates + Compliance Forms)
   ============================================================
   Lets realtors upload PDFs they use a lot, place fields with
   DocuSeal's in-app builder, and confirm auto-fill mappings.
   ============================================================ */

import { auth, db, storage, functions, httpsCallable } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, setDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getCurrentUser, showToast, escapeHtml } from "./auth.js";

const createDocuSealBuilderTokenFn = httpsCallable(functions, "createDocuSealBuilderToken");
const suggestFieldMappingsFn = httpsCallable(functions, "suggestFieldMappings");

let currentUser = null;
let myTemplates = [];
let seededTemplates = [];

// Builder + mapping state — set by the modal flow, consumed by saveTemplateFromMapping
let pendingUpload = null;   // { templateId, name, storagePath, downloadUrl, checklist }
let pendingBuilder = null;  // { docusealTemplateId, fields: [{name, type, ...}] }
let pendingMappings = [];   // [{ fieldName, source, confidence }]

const DOCUSEAL_BUILDER_SCRIPT = "https://cdn.docuseal.com/js/builder.js";

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/greendoor/app/login";
    return;
  }
  currentUser = await getCurrentUser();
  await loadTemplates();
});

async function loadTemplates() {
  try {
    document.getElementById("templates-loading").classList.remove("gd-hidden");
    document.getElementById("templates-content").classList.add("gd-hidden");

    // Realtor's own private templates
    const mineSnap = await getDocs(query(
      collection(db, "documentTemplates"),
      where("ownerId", "==", currentUser.uid)
    ));
    myTemplates = mineSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Seeded compliance forms (visibility==seeded). State scoped to MO for now.
    const seededSnap = await getDocs(query(
      collection(db, "documentTemplates"),
      where("visibility", "==", "seeded")
    ));
    seededTemplates = seededSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderMyTemplates();
    renderSeededTemplates();
  } catch (err) {
    console.error("loadTemplates error:", err);
    showToast("Could not load templates", "error");
  } finally {
    document.getElementById("templates-loading").classList.add("gd-hidden");
    document.getElementById("templates-content").classList.remove("gd-hidden");
  }
}

function renderMyTemplates() {
  const list = document.getElementById("my-templates-list");
  const empty = document.getElementById("my-templates-empty");
  if (!myTemplates.length) {
    list.innerHTML = "";
    empty.classList.remove("gd-hidden");
    return;
  }
  empty.classList.add("gd-hidden");
  list.innerHTML = myTemplates.map(renderTemplateCard).join("");
}

function renderSeededTemplates() {
  const list = document.getElementById("seeded-templates-list");
  if (!seededTemplates.length) {
    list.innerHTML = `<div class="gd-empty"><div class="gd-empty-text">No compliance forms available.</div></div>`;
    return;
  }
  // Sort by sortOrder when present, fall back to name
  const sorted = [...seededTemplates].sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    return (a.name || "").localeCompare(b.name || "");
  });
  list.innerHTML = sorted.map(renderTemplateCard).join("");
}

function renderTemplateCard(t) {
  const isMine = t.ownerId === currentUser.uid;
  const setupOk = !!t.docusealTemplateId;
  const fields = (t.mergeFields || []).length;
  const required = t.required ? `<span class="gd-badge gd-badge-warn">Required</span>` : "";
  const setup = setupOk
    ? `<span class="gd-badge gd-badge-success">Ready</span>`
    : `<span class="gd-badge gd-badge-muted">Setup pending</span>`;
  return `
    <div class="gd-card gd-template-card">
      <div class="gd-template-name">${escapeHtml(t.name || t.id)}</div>
      ${t.description ? `<div class="gd-template-desc gd-text-muted" style="font-size:.85rem; margin-top:.25rem;">${escapeHtml(t.description)}</div>` : ""}
      <div class="gd-template-meta" style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.5rem;">
        ${setup}
        ${required}
        <span class="gd-badge gd-badge-info">${fields} field${fields === 1 ? "" : "s"}</span>
      </div>
      ${isMine ? `
        <div class="gd-template-actions" style="display:flex; gap:.5rem; margin-top:.75rem;">
          <button class="gd-btn gd-btn-sm" onclick="editTemplate('${t.id}')">Edit</button>
          <button class="gd-btn gd-btn-sm gd-btn-danger" onclick="deleteTemplate('${t.id}')">Delete</button>
        </div>
      ` : ""}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Upload flow                                                        */
/* ------------------------------------------------------------------ */
window.openUploadTemplate = function () {
  document.getElementById("upload-template-name").value = "";
  document.getElementById("upload-template-file").value = "";
  document.getElementById("upload-template-checklist").checked = false;
  document.getElementById("upload-status").textContent = "";
  document.getElementById("upload-modal").classList.remove("gd-hidden");
};

window.closeUploadTemplate = function () {
  document.getElementById("upload-modal").classList.add("gd-hidden");
};

window.startUploadTemplate = async function () {
  const name = (document.getElementById("upload-template-name").value || "").trim();
  const fileInput = document.getElementById("upload-template-file");
  const file = fileInput.files?.[0];
  const checklist = document.getElementById("upload-template-checklist").checked;
  const statusEl = document.getElementById("upload-status");
  const goBtn = document.getElementById("upload-template-go");

  if (!name) {
    statusEl.textContent = "Give the template a name.";
    return;
  }
  if (!file) {
    statusEl.textContent = "Pick a PDF file to upload.";
    return;
  }
  if (file.type !== "application/pdf") {
    statusEl.textContent = "Only PDF files are supported.";
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    statusEl.textContent = "PDF is too large (20 MB max).";
    return;
  }

  goBtn.disabled = true;
  statusEl.textContent = "Uploading PDF…";

  try {
    const templateId = doc(collection(db, "documentTemplates")).id;
    const storagePath = `users/${currentUser.uid}/templates/${templateId}/source.pdf`;
    const fileRef = storageRef(storage, storagePath);
    await uploadBytes(fileRef, file, { contentType: "application/pdf" });
    const downloadUrl = await getDownloadURL(fileRef);

    pendingUpload = { templateId, name, storagePath, downloadUrl, checklist };

    statusEl.textContent = "Opening field builder…";
    closeUploadTemplate();
    await openBuilder({ templateName: name, documentUrls: [downloadUrl] });
  } catch (err) {
    console.error("startUploadTemplate error:", err);
    statusEl.textContent = `Upload failed: ${err.message}`;
    goBtn.disabled = false;
  }
};

/* ------------------------------------------------------------------ */
/*  DocuSeal builder integration                                       */
/* ------------------------------------------------------------------ */
async function ensureBuilderScriptLoaded() {
  if (window.customElements && window.customElements.get("docuseal-builder")) return;
  if (document.querySelector(`script[src="${DOCUSEAL_BUILDER_SCRIPT}"]`)) {
    // Already loading — wait for it
    await new Promise((resolve) => {
      const check = () => {
        if (window.customElements && window.customElements.get("docuseal-builder")) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
    return;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = DOCUSEAL_BUILDER_SCRIPT;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load DocuSeal builder script"));
    document.head.appendChild(s);
  });
}

async function openBuilder({ templateName, documentUrls, templateId }) {
  await ensureBuilderScriptLoaded();

  let tokenResp;
  try {
    const r = await createDocuSealBuilderTokenFn({ templateName, documentUrls, templateId });
    tokenResp = r.data;
  } catch (err) {
    console.error("createDocuSealBuilderToken error:", err);
    showToast(err?.message?.includes("not yet configured")
      ? "DocuSeal is not configured yet — ask Joe to flip the secret."
      : `Could not start the builder: ${err.message}`, "error");
    return;
  }

  const mount = document.getElementById("builder-mount");
  mount.innerHTML = "";

  const builder = document.createElement("docuseal-builder");
  builder.setAttribute("data-token", tokenResp.token);
  if (tokenResp.host) builder.setAttribute("data-host", tokenResp.host);
  builder.style.cssText = "display:block; width:100%; height:100%;";

  // DocuSeal builder fires `save` and `load` CustomEvents on the element.
  builder.addEventListener("save", onBuilderSave);
  builder.addEventListener("load", onBuilderLoad);

  mount.appendChild(builder);
  document.getElementById("builder-modal").classList.remove("gd-hidden");
}

window.closeBuilder = function () {
  document.getElementById("builder-modal").classList.add("gd-hidden");
  document.getElementById("builder-mount").innerHTML = "";
};

function onBuilderLoad(evt) {
  // Reserved for future use — DocuSeal exposes the loaded template here.
  // For now we only care about save events.
}

async function onBuilderSave(evt) {
  // CustomEvent.detail contains the template payload with `id` and `fields` (or `submitters[0].fields`).
  const detail = evt.detail || {};
  const docusealTemplateId = detail.id || detail.template_id || detail.templateId;
  const rawFields = Array.isArray(detail.fields)
    ? detail.fields
    : Array.isArray(detail.submitters?.[0]?.fields)
      ? detail.submitters[0].fields
      : [];

  // De-duplicate by name (DocuSeal can repeat a field across pages).
  const seen = new Set();
  const fieldNames = [];
  for (const f of rawFields) {
    const n = (f.name || f.title || "").trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    fieldNames.push(n);
  }

  pendingBuilder = { docusealTemplateId, fields: fieldNames };
  closeBuilder();

  if (!fieldNames.length) {
    // No fields placed — save the template anyway so the realtor can use it for
    // blind sends without auto-fill.
    pendingMappings = [];
    await persistTemplate();
    return;
  }

  // Ask Sage for suggested mappings
  showToast("Suggesting auto-fill mappings…", "info");
  try {
    const r = await suggestFieldMappingsFn({ fieldNames });
    pendingMappings = r.data?.mappings || fieldNames.map(n => ({ fieldName: n, source: "manual", confidence: 0 }));
  } catch (err) {
    console.warn("suggestFieldMappings failed:", err.message);
    pendingMappings = fieldNames.map(n => ({ fieldName: n, source: "manual", confidence: 0 }));
  }

  renderMappingModal();
}

/* ------------------------------------------------------------------ */
/*  Mapping confirmation modal                                         */
/* ------------------------------------------------------------------ */
const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual entry (fill at send time)" },
  { value: "date", label: "Today's date" },
  { value: "client.fullName", label: "Client — Full name" },
  { value: "client.firstName", label: "Client — First name" },
  { value: "client.lastName", label: "Client — Last name" },
  { value: "client.email", label: "Client — Email" },
  { value: "client.phone", label: "Client — Phone" },
  { value: "listing.address.full", label: "Listing — Full address" },
  { value: "listing.address.street", label: "Listing — Street" },
  { value: "listing.address.city", label: "Listing — City" },
  { value: "listing.address.state", label: "Listing — State" },
  { value: "listing.address.zip", label: "Listing — Zip" },
  { value: "listing.listingPrice", label: "Listing — Price" },
  { value: "listing.mlsNumber", label: "Listing — MLS #" },
  { value: "listing.beds", label: "Listing — Beds" },
  { value: "listing.baths", label: "Listing — Baths" },
  { value: "listing.sqft", label: "Listing — Square feet" },
  { value: "listing.yearBuilt", label: "Listing — Year built" },
  { value: "agent.fullName", label: "Agent — Your name" },
  { value: "agent.email", label: "Agent — Your email" },
  { value: "agent.phone", label: "Agent — Your phone" },
  { value: "agent.brokerage", label: "Agent — Brokerage" },
  { value: "agent.licenseNumber", label: "Agent — License #" }
];

function renderMappingModal() {
  const wrap = document.getElementById("mapping-list");
  wrap.innerHTML = pendingMappings.map((m, i) => {
    const options = SOURCE_OPTIONS.map(o =>
      `<option value="${o.value}" ${o.value === m.source ? "selected" : ""}>${escapeHtml(o.label)}</option>`
    ).join("");
    const conf = m.confidence >= 0.8 ? "high"
      : m.confidence >= 0.5 ? "medium"
      : "low";
    return `
      <div class="gd-form-group" style="display:grid; grid-template-columns: 1fr 1fr; gap:.5rem; align-items:center; padding:.5rem 0; border-bottom:1px solid var(--gd-border, #e5e7eb);">
        <div>
          <div style="font-weight:500;">${escapeHtml(m.fieldName)}</div>
          <div class="gd-text-muted" style="font-size:.75rem;">Suggested confidence: ${conf}</div>
        </div>
        <select class="gd-input" data-mapping-idx="${i}">${options}</select>
      </div>
    `;
  }).join("");

  // Wire up change handlers
  wrap.querySelectorAll("select[data-mapping-idx]").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.mappingIdx);
      pendingMappings[idx].source = e.target.value;
    });
  });

  document.getElementById("mapping-modal").classList.remove("gd-hidden");
}

window.closeMappingModal = function () {
  document.getElementById("mapping-modal").classList.add("gd-hidden");
};

window.saveTemplateFromMapping = async function () {
  const btn = document.getElementById("mapping-save-btn");
  btn.disabled = true;
  try {
    await persistTemplate();
  } finally {
    btn.disabled = false;
  }
};

async function persistTemplate() {
  if (!pendingUpload || !pendingBuilder) {
    showToast("Missing template data — please try uploading again.", "error");
    return;
  }
  try {
    const mergeFields = (pendingMappings || [])
      .filter(m => m.source && m.source !== "manual")
      .map(m => ({ docusealFieldName: m.fieldName, source: m.source }));

    const docRef = doc(db, "documentTemplates", pendingUpload.templateId);
    await setDoc(docRef, {
      ownerId: currentUser.uid,
      visibility: "private",
      name: pendingUpload.name,
      description: "",
      category: "uploaded",
      docusealTemplateId: String(pendingBuilder.docusealTemplateId || ""),
      mergeFields,
      checklistEnabled: !!pendingUpload.checklist,
      sourcePdfPath: pendingUpload.storagePath,
      state: null,
      transactionTypes: [],
      required: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Template saved", "success");
    closeMappingModal();
    pendingUpload = null;
    pendingBuilder = null;
    pendingMappings = [];
    await loadTemplates();
  } catch (err) {
    console.error("persistTemplate error:", err);
    showToast(`Could not save template: ${err.message}`, "error");
  }
}

/* ------------------------------------------------------------------ */
/*  Edit / delete                                                      */
/* ------------------------------------------------------------------ */
window.editTemplate = async function (templateId) {
  const t = myTemplates.find(x => x.id === templateId);
  if (!t) return;
  pendingUpload = {
    templateId: t.id,
    name: t.name,
    storagePath: t.sourcePdfPath || null,
    downloadUrl: null,
    checklist: !!t.checklistEnabled
  };
  // Re-open builder loaded with the existing template id so realtor can adjust fields.
  await openBuilder({
    templateName: t.name,
    templateId: t.docusealTemplateId,
    documentUrls: t.sourcePdfPath ? [await getDownloadURL(storageRef(storage, t.sourcePdfPath))] : undefined
  });
};

window.deleteTemplate = async function (templateId) {
  const t = myTemplates.find(x => x.id === templateId);
  if (!t) return;
  if (!confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "documentTemplates", templateId));
    if (t.sourcePdfPath) {
      try {
        await deleteObject(storageRef(storage, t.sourcePdfPath));
      } catch (err) {
        console.warn("Could not delete source PDF:", err.message);
      }
    }
    showToast("Template deleted", "success");
    await loadTemplates();
  } catch (err) {
    console.error("deleteTemplate error:", err);
    showToast(`Could not delete: ${err.message}`, "error");
  }
};

window.handleLogout = async function () {
  await auth.signOut();
  window.location.href = "/greendoor/app/login";
};
