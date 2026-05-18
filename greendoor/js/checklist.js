/**
 * checklist.js — Closing checklist data model, seeding, rendering, and interactions
 *
 * Provides the MO residential transaction checklist template, category
 * constants, seeding/update functions, and the full UI rendering with
 * toggle, N/A, custom items, notes, and real-time Firestore sync.
 *
 * Exports:
 *   - CHECKLIST_CATEGORIES   — Category enum for checklist grouping
 *   - CATEGORY_LABELS        — Human-readable labels for each category
 *   - MO_CLOSING_CHECKLIST_TEMPLATE — Missouri residential checklist template (42 items)
 *   - parseTransactionType   — Parses "SFH - Buyer" into { propType, side }
 *   - seedChecklist          — Seeds applicable items to Firestore subcollection
 *   - recalculateDeadlines   — Recalculates deadline fields when closing date changes
 *   - initChecklist          — Initializes checklist tab with real-time listener
 *   - renderChecklist        — Renders checklist items grouped by category
 *   - destroyChecklist       — Cleans up listener and module state
 */

import { db, auth } from "./firebase-config.js";
import {
  writeBatch, doc, collection, getDocs, serverTimestamp,
  updateDoc, addDoc, deleteDoc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast, escapeHtml, formatDate } from "./auth.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const CHECKLIST_CATEGORIES = {
  PRE_CONTRACT: "pre_contract",
  UNDER_CONTRACT: "under_contract",
  CLOSING: "closing",
  POST_CLOSING: "post_closing"
};

export const CATEGORY_LABELS = {
  pre_contract: "Pre-Contract",
  under_contract: "Under Contract",
  closing: "Closing",
  post_closing: "Post-Closing"
};

/* ------------------------------------------------------------------ */
/*  Property type shorthand arrays                                     */
/* ------------------------------------------------------------------ */

const ALL_TYPES = ["SFH", "Condo", "Multi-Family", "Land"];
const SFH_CONDO_MF = ["SFH", "Condo", "Multi-Family"];
const SFH_CONDO = ["SFH", "Condo"];

/* ------------------------------------------------------------------ */
/*  MO Closing Checklist Template (42 items)                           */
/* ------------------------------------------------------------------ */

export const MO_CLOSING_CHECKLIST_TEMPLATE = [
  // ── Pre-Contract (7 items) ──────────────────────────────────────
  {
    id: "agency_disclosure",
    task: "Sign Agency Disclosure",
    category: "pre_contract",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: "mo-agency-disclosure",
    deadlineOffsetDays: null,
    sortOrder: 1
  },
  {
    id: "buyer_rep_agreement",
    task: "Sign Buyer Representation Agreement",
    category: "pre_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: "mo-buyer-representation-agreement",
    deadlineOffsetDays: null,
    sortOrder: 2
  },
  {
    id: "listing_agreement",
    task: "Sign Listing Agreement",
    category: "pre_contract",
    transactionSide: "seller",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: "mo-listing-agreement",
    deadlineOffsetDays: null,
    sortOrder: 3
  },
  {
    id: "pre_approval",
    task: "Obtain Mortgage Pre-Approval Letter",
    category: "pre_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: null,
    sortOrder: 4
  },
  {
    id: "property_search",
    task: "Complete Property Search",
    category: "pre_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: null,
    sortOrder: 5
  },
  {
    id: "listing_prep",
    task: "Prepare Property for Listing (staging, photos)",
    category: "pre_contract",
    transactionSide: "seller",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: null,
    sortOrder: 6
  },
  {
    id: "purchase_offer",
    task: "Submit/Accept Purchase Offer",
    category: "pre_contract",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: null,
    sortOrder: 7
  },
  {
    id: "fair_housing_ack",
    task: "Sign Fair Housing Acknowledgment",
    category: "pre_contract",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: null,
    sortOrder: 8
  },
  {
    id: "buyer_broker_comp_disclosure",
    task: "Buyer Broker Compensation Disclosure (NAR Settlement)",
    category: "pre_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: null,
    sortOrder: 9
  },

  // ── Under Contract ──────────────────────────────────────────────
  {
    id: "earnest_money",
    task: "Deposit Earnest Money",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -35,
    sortOrder: 1
  },
  {
    id: "purchase_agreement",
    task: "Sign Purchase Agreement",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: "mo-purchase-agreement",
    deadlineOffsetDays: -35,
    sortOrder: 2
  },
  {
    id: "sellers_disclosure",
    task: "Review/Sign Seller's Disclosure",
    category: "under_contract",
    transactionSide: "seller",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: "mo-sellers-disclosure",
    deadlineOffsetDays: -30,
    sortOrder: 3
  },
  {
    id: "lead_paint_disclosure",
    task: "Sign Lead Paint Disclosure",
    category: "under_contract",
    transactionSide: "both",
    propertyTypes: SFH_CONDO,
    linkedTemplateId: "mo-lead-paint-disclosure",
    deadlineOffsetDays: -30,
    sortOrder: 4
  },
  {
    id: "hoa_addendum",
    task: "Sign HOA Addendum",
    category: "under_contract",
    transactionSide: "both",
    propertyTypes: ["Condo"],
    linkedTemplateId: "mo-hoa-addendum",
    deadlineOffsetDays: -28,
    sortOrder: 5
  },
  {
    id: "home_inspection",
    task: "Schedule and Complete Home Inspection",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -28,
    sortOrder: 6
  },
  {
    id: "inspection_response",
    task: "Negotiate Inspection Response/Repairs",
    category: "under_contract",
    transactionSide: "both",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -21,
    sortOrder: 7
  },
  {
    id: "appraisal",
    task: "Complete Property Appraisal",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -21,
    sortOrder: 8
  },
  {
    id: "land_survey",
    task: "Order Land Survey",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ["Land"],
    linkedTemplateId: null,
    deadlineOffsetDays: -21,
    sortOrder: 9
  },
  {
    id: "title_search",
    task: "Order Title Search and Title Insurance",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -21,
    sortOrder: 10
  },
  {
    id: "homeowners_insurance",
    task: "Obtain Homeowners Insurance",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -14,
    sortOrder: 11
  },
  {
    id: "financing_approval",
    task: "Obtain Final Financing Approval",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -10,
    sortOrder: 12
  },
  {
    id: "notice_intended_sale",
    task: "File Notice of Intended Sale (MO 45-day req.)",
    category: "under_contract",
    transactionSide: "seller",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -45,
    sortOrder: 13
  },
  {
    id: "repair_completion",
    task: "Confirm Repair Completion (if negotiated)",
    category: "under_contract",
    transactionSide: "both",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -7,
    sortOrder: 14
  },
  {
    id: "wire_fraud_advisory",
    task: "Deliver Wire Fraud Advisory",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -30,
    sortOrder: 15
  },
  {
    id: "mortgage_application",
    task: "Confirm Mortgage Application Submitted",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -30,
    sortOrder: 16
  },
  {
    id: "hoa_estoppel",
    task: "Request HOA Estoppel Letter",
    category: "under_contract",
    transactionSide: "seller",
    propertyTypes: ["Condo"],
    linkedTemplateId: null,
    deadlineOffsetDays: -21,
    sortOrder: 17
  },
  {
    id: "pest_termite_inspection",
    task: "Schedule Pest/Termite Inspection",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -25,
    sortOrder: 18
  },
  {
    id: "title_commitment_review",
    task: "Review Title Commitment",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -14,
    sortOrder: 19
  },
  {
    id: "payoff_authorization",
    task: "Obtain Payoff Authorization",
    category: "under_contract",
    transactionSide: "seller",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -14,
    sortOrder: 20
  },
  {
    id: "specialized_inspections",
    task: "Schedule Specialized Inspections (radon, mold, etc.)",
    category: "under_contract",
    transactionSide: "buyer",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -25,
    sortOrder: 21
  },

  // ── Closing ─────────────────────────────────────────────────────
  {
    id: "final_walkthrough",
    task: "Complete Final Walk-Through",
    category: "closing",
    transactionSide: "buyer",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -1,
    sortOrder: 1
  },
  {
    id: "closing_disclosure",
    task: "Review Closing Disclosure (3-day rule)",
    category: "closing",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -3,
    sortOrder: 2
  },
  {
    id: "utility_transfer",
    task: "Transfer Utilities",
    category: "closing",
    transactionSide: "both",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: 0,
    sortOrder: 3
  },
  {
    id: "closing_funds",
    task: "Wire Closing Funds",
    category: "closing",
    transactionSide: "buyer",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 0,
    sortOrder: 4
  },
  {
    id: "closing_signing",
    task: "Attend Closing and Sign Documents",
    category: "closing",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 0,
    sortOrder: 5
  },
  {
    id: "deed_recording",
    task: "Confirm Deed Recording",
    category: "closing",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 1,
    sortOrder: 6
  },
  {
    id: "key_exchange",
    task: "Key Exchange / Possession Transfer",
    category: "closing",
    transactionSide: "both",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: 0,
    sortOrder: 7
  },
  {
    id: "settlement_statement_review",
    task: "Review Settlement Statement (HUD-1/ALTA)",
    category: "closing",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: -1,
    sortOrder: 8
  },
  {
    id: "commission_disbursement",
    task: "Commission Disbursement Authorization",
    category: "closing",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 0,
    sortOrder: 9
  },
  {
    id: "insurance_binder",
    task: "Insurance Binder Sent to Lender",
    category: "closing",
    transactionSide: "buyer",
    propertyTypes: SFH_CONDO_MF,
    linkedTemplateId: null,
    deadlineOffsetDays: -3,
    sortOrder: 10
  },
  {
    id: "firpta_compliance",
    task: "FIRPTA Compliance (if foreign seller)",
    category: "closing",
    transactionSide: "seller",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 0,
    sortOrder: 11
  },

  // ── Post-Closing ────────────────────────────────────────────────
  {
    id: "mls_status_update",
    task: "Update MLS Status to Sold/Closed",
    category: "post_closing",
    transactionSide: "seller",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 1,
    sortOrder: 1
  },
  {
    id: "transaction_file_archived",
    task: "Archive Transaction File",
    category: "post_closing",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 7,
    sortOrder: 2
  },
  {
    id: "client_followup_scheduled",
    task: "Schedule Client Follow-Up",
    category: "post_closing",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 3,
    sortOrder: 3
  },
  {
    id: "commission_receipt_confirmed",
    task: "Confirm Commission Receipt",
    category: "post_closing",
    transactionSide: "both",
    propertyTypes: ALL_TYPES,
    linkedTemplateId: null,
    deadlineOffsetDays: 7,
    sortOrder: 4
  }
];

/* ------------------------------------------------------------------ */
/*  parseTransactionType                                               */
/* ------------------------------------------------------------------ */

/**
 * Parses a combined transaction type string into property type and side.
 * @param {string|null} transactionType - e.g. "SFH - Buyer"
 * @returns {{ propType: string|null, side: string|null }}
 */
export function parseTransactionType(transactionType) {
  if (!transactionType) return { propType: null, side: null };
  const parts = transactionType.split(" - ");
  return {
    propType: parts[0]?.trim() || null,
    side: parts[1]?.trim()?.toLowerCase() || null
  };
}

/* ------------------------------------------------------------------ */
/*  seedChecklist                                                      */
/* ------------------------------------------------------------------ */

/**
 * Seeds applicable checklist items to the Firestore closingChecklist
 * subcollection. Uses merge:true so re-seeding preserves existing
 * completion state.
 *
 * @param {Object} db - Firestore database instance
 * @param {string} clientId - Client document ID
 * @param {string} transactionType - e.g. "SFH - Buyer"
 * @param {Date|null} closingDate - Closing date (JS Date) or null
 */
export async function seedChecklist(db, clientId, transactionType, closingDate, realtorId) {
  const { propType, side } = parseTransactionType(transactionType);
  if (!propType || !side) return;

  const applicable = MO_CLOSING_CHECKLIST_TEMPLATE.filter(item =>
    (item.transactionSide === side || item.transactionSide === "both") &&
    item.propertyTypes.includes(propType)
  );

  const batch = writeBatch(db);

  for (const item of applicable) {
    const ref = doc(db, "clients", clientId, "closingChecklist", item.id);

    let deadline = null;
    if (closingDate && item.deadlineOffsetDays != null) {
      const base = closingDate instanceof Date ? closingDate : new Date(closingDate);
      deadline = new Date(base.getTime() + item.deadlineOffsetDays * 86400000);
    }

    batch.set(ref, {
      task: item.task,
      category: item.category,
      completed: false,
      autoCompleted: false,
      autoCompletedAt: null,
      notApplicable: false,
      notes: "",
      sortOrder: item.sortOrder,
      transactionSide: item.transactionSide,
      propertyTypes: item.propertyTypes,
      linkedTemplateId: item.linkedTemplateId,
      isCustom: false,
      isSeeded: true,
      deadlineOffsetDays: item.deadlineOffsetDays,
      deadline: deadline,
      seededAt: serverTimestamp(),
      completedAt: null,
      completedBy: null
    }, { merge: true });
  }

  // Pull realtor-uploaded templates flagged for the checklist and add each as
  // an extra item. linkedTemplateId points at the template doc so the same
  // auto-complete-on-signed hook works for them as for seeded compliance forms.
  if (realtorId) {
    try {
      const realtorTplSnap = await getDocs(query(
        collection(db, "documentTemplates"),
        where("ownerId", "==", realtorId),
        where("checklistEnabled", "==", true)
      ));
      let extraSort = 1000;
      for (const tplDoc of realtorTplSnap.docs) {
        const tpl = tplDoc.data();
        const itemRef = doc(db, "clients", clientId, "closingChecklist", `realtor_${tplDoc.id}`);
        batch.set(itemRef, {
          task: tpl.name || "Realtor template",
          category: "Realtor Documents",
          completed: false,
          autoCompleted: false,
          autoCompletedAt: null,
          notApplicable: false,
          notes: "",
          sortOrder: extraSort++,
          transactionSide: "both",
          propertyTypes: [propType],
          linkedTemplateId: tplDoc.id,
          isCustom: false,
          isSeeded: true,
          isRealtorTemplate: true,
          deadlineOffsetDays: null,
          deadline: null,
          seededAt: serverTimestamp(),
          completedAt: null,
          completedBy: null
        }, { merge: true });
      }
    } catch (err) {
      console.warn("seedChecklist: could not include realtor templates:", err.message);
    }
  }

  await batch.commit();
}

/* ------------------------------------------------------------------ */
/*  recalculateDeadlines                                               */
/* ------------------------------------------------------------------ */

/**
 * When closing date changes, batch-update all checklist items that have
 * a deadlineOffsetDays value with the recalculated deadline.
 *
 * @param {Object} db - Firestore database instance
 * @param {string} clientId - Client document ID
 * @param {Date|null} closingDate - New closing date (JS Date) or null
 */
export async function recalculateDeadlines(db, clientId, closingDate) {
  const snap = await getDocs(collection(db, "clients", clientId, "closingChecklist"));
  if (snap.empty) return;

  const batch = writeBatch(db);
  let hasUpdates = false;

  snap.forEach(docSnap => {
    const data = docSnap.data();
    if (data.deadlineOffsetDays == null) return;
    // Don't trample a deadline the realtor explicitly overrode.
    if (data.customDeadline) return;

    let deadline = null;
    if (closingDate) {
      const base = closingDate instanceof Date ? closingDate : new Date(closingDate);
      deadline = new Date(base.getTime() + data.deadlineOffsetDays * 86400000);
    }

    batch.update(docSnap.ref, { deadline });
    hasUpdates = true;
  });

  if (hasUpdates) {
    await batch.commit();
  }
}

/* ------------------------------------------------------------------ */
/*  Module state (UI)                                                  */
/* ------------------------------------------------------------------ */

let checklistItems = [];
let checklistUnsubscribe = null;
let currentClientId = null;
let currentClientData = null;

/* ------------------------------------------------------------------ */
/*  initChecklist                                                      */
/* ------------------------------------------------------------------ */

/**
 * Initializes the checklist tab: stores client context and sets up
 * real-time Firestore listener for the closingChecklist subcollection.
 *
 * @param {string} clientId - Client document ID
 * @param {Object} clientData - Client data object (needs transactionType)
 */
export function initChecklist(clientId, clientData) {
  currentClientId = clientId;
  currentClientData = clientData;

  const emptyEl = document.getElementById("checklist-empty");
  const contentEl = document.getElementById("checklist-content");

  if (!clientData || !clientData.transactionType) {
    if (emptyEl) emptyEl.style.display = "block";
    if (contentEl) contentEl.style.display = "none";
    return;
  }

  subscribeChecklist(clientId);
}

/* ------------------------------------------------------------------ */
/*  subscribeChecklist (internal)                                      */
/* ------------------------------------------------------------------ */

function subscribeChecklist(clientId) {
  // Clean up previous listener
  if (checklistUnsubscribe) {
    checklistUnsubscribe();
    checklistUnsubscribe = null;
  }

  const colRef = collection(db, "clients", clientId, "closingChecklist");

  checklistUnsubscribe = onSnapshot(colRef, (snapshot) => {
    // Detect auto-completions for toast
    const newItems = [];
    snapshot.forEach(d => newItems.push({ id: d.id, ...d.data() }));

    // Compare with previous state to detect new auto-completions
    for (const newItem of newItems) {
      const oldItem = checklistItems.find(i => i.id === newItem.id);
      if (newItem.autoCompleted && (!oldItem || !oldItem.autoCompleted)) {
        showToast(`${newItem.task} signed -- checklist updated`, "success");
      }
    }

    checklistItems = newItems;
    renderChecklist();
  }, (err) => {
    console.error("Checklist listener error:", err);
  });
}

/* ------------------------------------------------------------------ */
/*  renderChecklist                                                    */
/* ------------------------------------------------------------------ */

/**
 * Renders checklist items grouped by category with progress bars,
 * badges, and action buttons.
 */
export function renderChecklist() {
  const emptyEl = document.getElementById("checklist-empty");
  const contentEl = document.getElementById("checklist-content");
  const overallEl = document.getElementById("checklist-overall-progress");
  const categoriesEl = document.getElementById("checklist-categories");

  if (!checklistItems.length) {
    if (emptyEl) emptyEl.style.display = "block";
    if (contentEl) contentEl.style.display = "none";
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";
  if (contentEl) contentEl.style.display = "block";

  // Group items by category
  const categoryOrder = ["pre_contract", "under_contract", "closing", "post_closing"];
  const grouped = {};
  for (const cat of categoryOrder) {
    grouped[cat] = [];
  }
  for (const item of checklistItems) {
    const cat = item.category || "closing";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }
  // Sort within each category by sortOrder
  for (const cat of categoryOrder) {
    grouped[cat].sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999));
  }

  // Overall progress
  const activeItems = checklistItems.filter(i => !i.notApplicable);
  const doneItems = activeItems.filter(i => i.completed);
  const overallPct = activeItems.length > 0
    ? Math.round((doneItems.length / activeItems.length) * 100)
    : 0;

  if (overallEl) {
    overallEl.innerHTML = `
      <div class="gd-checklist-overall">
        <div class="gd-checklist-overall-header">
          <span>Closing Progress</span>
          <button class="gd-btn gd-btn-sm" onclick="openChecklistAI()" style="margin-left: auto;">&#10024; Check in with AI</button>
          <span class="gd-checklist-progress-text">${doneItems.length}/${activeItems.length} (${overallPct}%)</span>
        </div>
        <div class="gd-checklist-progress">
          <div class="gd-checklist-progress-fill" style="width: ${overallPct}%"></div>
        </div>
      </div>
    `;
  }

  // Per-category sections
  let catHtml = "";
  for (const cat of categoryOrder) {
    const items = grouped[cat];
    if (!items.length) continue;

    const catActive = items.filter(i => !i.notApplicable);
    const catDone = catActive.filter(i => i.completed);
    const catPct = catActive.length > 0
      ? Math.round((catDone.length / catActive.length) * 100)
      : 0;

    catHtml += `
      <div class="gd-checklist-category">
        <div class="gd-checklist-category-header">
          <span>${CATEGORY_LABELS[cat] || cat}</span>
          <span class="gd-checklist-progress-text">${catDone.length}/${catActive.length} (${catPct}%)</span>
        </div>
        <div class="gd-checklist-category-progress">
          <div class="gd-checklist-progress">
            <div class="gd-checklist-progress-fill" style="width: ${catPct}%"></div>
          </div>
        </div>
    `;

    for (const item of items) {
      catHtml += renderChecklistItem(item);
    }

    catHtml += `</div>`;
  }

  if (categoriesEl) {
    categoriesEl.innerHTML = catHtml;
  }
}

/* ------------------------------------------------------------------ */
/*  renderChecklistItem (internal)                                     */
/* ------------------------------------------------------------------ */

function renderChecklistItem(item) {
  const isCompleted = item.completed && !item.notApplicable;
  const isNA = item.notApplicable;
  // customDeadline (Firestore Timestamp) overrides the computed deadline when present.
  const effectiveDeadline = item.customDeadline || item.deadline;
  const isOverdue = !item.completed && !item.notApplicable && effectiveDeadline && isDateOverdue(effectiveDeadline);

  const classes = ["gd-checklist-item"];
  if (isCompleted) classes.push("completed");
  if (isNA) classes.push("na");

  // Deadline display — click to edit
  let deadlineHtml = "";
  if (!isNA) {
    const deadlineClass = isOverdue ? "gd-checklist-deadline overdue" : "gd-checklist-deadline";
    const customBadge = item.customDeadline ? ' <span class="gd-checklist-deadline-custom" title="Custom deadline">●</span>' : "";
    const dateStr = effectiveDeadline ? formatDate(effectiveDeadline) : "Set deadline";
    const inputVal = effectiveDeadline ? toIsoDateInput(effectiveDeadline) : "";
    deadlineHtml = `
      <button type="button" class="${deadlineClass}" onclick="window.editChecklistDeadline('${item.id}', this)" title="Click to set a custom deadline">
        ${effectiveDeadline ? `Due: ${dateStr}` : dateStr}${customBadge}
      </button>
      <input type="date" class="gd-checklist-deadline-input" id="deadline-${item.id}" value="${inputVal}" style="display:none;"
        onchange="window.saveChecklistDeadline('${item.id}', this.value)"
        onblur="this.style.display='none'">
    `;
  }

  // Badges
  let badgesHtml = "";
  if (item.autoCompleted) {
    badgesHtml += '<span class="gd-badge gd-badge-auto-completed">Auto-completed</span>';
  }
  if (isNA) {
    badgesHtml += '<span class="gd-badge gd-badge-na">N/A</span>';
  }
  if (item.isCustom) {
    badgesHtml += '<span class="gd-badge gd-badge-custom">Custom</span>';
  }

  // Actions
  let actionsHtml = `<button class="gd-checklist-action-btn" onclick="window.toggleChecklistNotes('${item.id}')" title="Notes">&#128221;</button>`;
  if (item.isSeeded) {
    actionsHtml += `<button class="gd-checklist-action-btn" onclick="window.toggleChecklistNA('${item.id}')" title="Mark N/A">N/A</button>`;
  }
  if (item.isCustom) {
    actionsHtml += `<button class="gd-checklist-action-btn" onclick="window.deleteChecklistItem('${item.id}')" title="Delete">&#128465;</button>`;
  }

  return `
    <div class="${classes.join(" ")}" data-item-id="${item.id}">
      <input type="checkbox" class="gd-checklist-check"
        ${isCompleted ? "checked" : ""}
        ${isNA ? "disabled" : ""}
        onchange="window.toggleChecklistItem('${item.id}', this.checked)">
      <div class="gd-checklist-item-content">
        <span class="gd-checklist-task">${escapeHtml(item.task)}</span>
        <div class="gd-checklist-item-meta">
          ${badgesHtml}
          ${deadlineHtml}
        </div>
        <div class="gd-checklist-notes-area" id="notes-${item.id}">
          <textarea placeholder="Add notes..." onblur="window.saveChecklistNotes('${item.id}', this.value)">${escapeHtml(item.notes || "")}</textarea>
        </div>
      </div>
      <div class="gd-checklist-actions">
        ${actionsHtml}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

function toJSDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  return new Date(val);
}

function isDateOverdue(deadline) {
  const d = toJSDate(deadline);
  return d && d < new Date();
}

/* ------------------------------------------------------------------ */
/*  Window-level interaction handlers                                  */
/* ------------------------------------------------------------------ */

/**
 * Toggles a checklist item's completion state.
 * If unchecking an auto-completed item, also clears autoCompleted fields.
 */
window.toggleChecklistItem = async function(itemId, checked) {
  if (!currentClientId) return;
  const item = checklistItems.find(i => i.id === itemId);
  if (!item) return;

  const updateData = {
    completed: checked,
    completedAt: checked ? serverTimestamp() : null,
    completedBy: checked ? (auth.currentUser?.uid || null) : null
  };

  // Clear auto-completed badge when manually unchecking
  if (!checked && item.autoCompleted) {
    updateData.autoCompleted = false;
    updateData.autoCompletedAt = null;
  }

  try {
    await updateDoc(doc(db, "clients", currentClientId, "closingChecklist", itemId), updateData);
  } catch (err) {
    console.error("Toggle checklist item error:", err);
    showToast("Failed to update item.", "error");
  }
};

/**
 * Toggles the notes area open/closed for a checklist item.
 */
window.toggleChecklistNotes = function(itemId) {
  const el = document.getElementById("notes-" + itemId);
  if (!el) return;
  el.classList.toggle("open");
  if (el.classList.contains("open")) {
    const textarea = el.querySelector("textarea");
    if (textarea) textarea.focus();
  }
};

/**
 * Saves notes for a checklist item (called on textarea blur).
 */
window.saveChecklistNotes = async function(itemId, value) {
  if (!currentClientId) return;
  try {
    await updateDoc(doc(db, "clients", currentClientId, "closingChecklist", itemId), {
      notes: value
    });
  } catch (err) {
    console.error("Save checklist notes error:", err);
  }
};

// Click handler on the deadline pill: swap to the hidden date input + focus it.
window.editChecklistDeadline = function(itemId, buttonEl) {
  const input = document.getElementById(`deadline-${itemId}`);
  if (!input) return;
  buttonEl.style.display = "none";
  input.style.display = "";
  input.focus();
  if (typeof input.showPicker === "function") input.showPicker();
};

// Persist a custom deadline. Empty value clears the override and falls back
// to the computed deadline on next recalculation.
window.saveChecklistDeadline = async function(itemId, value) {
  if (!currentClientId) return;
  try {
    const docRef = doc(db, "clients", currentClientId, "closingChecklist", itemId);
    if (value) {
      // Stored as a JS Date — Firestore converts to Timestamp automatically.
      await updateDoc(docRef, { customDeadline: new Date(value + "T00:00:00") });
    } else {
      // deleteField is imported from firestore SDK; fall back to setting null.
      await updateDoc(docRef, { customDeadline: null });
    }
  } catch (err) {
    console.error("Save checklist deadline error:", err);
  }
};

function toIsoDateInput(val) {
  const d = toJSDate(val);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Toggles a seeded checklist item between N/A and active.
 * N/A items are excluded from progress calculation.
 */
window.toggleChecklistNA = async function(itemId) {
  if (!currentClientId) return;
  const item = checklistItems.find(i => i.id === itemId);
  if (!item) return;

  const newNA = !item.notApplicable;
  const updateData = { notApplicable: newNA };

  // If marking as N/A, also clear completion and auto-completed
  if (newNA) {
    updateData.completed = false;
    updateData.autoCompleted = false;
    updateData.autoCompletedAt = null;
    updateData.completedAt = null;
    updateData.completedBy = null;
  }

  try {
    await updateDoc(doc(db, "clients", currentClientId, "closingChecklist", itemId), updateData);
    showToast(newNA ? "Marked as N/A" : "Removed N/A marking");
  } catch (err) {
    console.error("Toggle N/A error:", err);
    showToast("Failed to update item.", "error");
  }
};

/**
 * Shows the add custom checklist item form.
 */
window.showAddChecklistItem = function() {
  const formEl = document.getElementById("checklist-add-form");
  if (!formEl) return;

  if (formEl.classList.contains("open")) {
    formEl.classList.remove("open");
    formEl.innerHTML = "";
    return;
  }

  formEl.innerHTML = `
    <input type="text" id="checklist-new-task" class="gd-input" placeholder="Task description...">
    <select id="checklist-new-category" class="gd-input">
      <option value="pre_contract">Pre-Contract</option>
      <option value="under_contract">Under Contract</option>
      <option value="closing">Closing</option>
      <option value="post_closing">Post-Closing</option>
    </select>
    <div style="display: flex; gap: 8px;">
      <button class="gd-btn gd-btn-primary gd-btn-sm" onclick="window.saveCustomChecklistItem()">Save</button>
      <button class="gd-btn gd-btn-sm" onclick="window.showAddChecklistItem()">Cancel</button>
    </div>
  `;
  formEl.classList.add("open");
  document.getElementById("checklist-new-task")?.focus();
};

/**
 * Saves a custom checklist item to Firestore.
 */
window.saveCustomChecklistItem = async function() {
  if (!currentClientId) return;
  const taskInput = document.getElementById("checklist-new-task");
  const catSelect = document.getElementById("checklist-new-category");
  if (!taskInput || !catSelect) return;

  const task = taskInput.value.trim();
  if (!task) {
    showToast("Please enter a task description.", "error");
    return;
  }

  const category = catSelect.value;

  try {
    await addDoc(collection(db, "clients", currentClientId, "closingChecklist"), {
      task: task,
      category: category,
      completed: false,
      autoCompleted: false,
      autoCompletedAt: null,
      notApplicable: false,
      notes: "",
      sortOrder: 999,
      transactionSide: "both",
      propertyTypes: [],
      linkedTemplateId: null,
      isCustom: true,
      isSeeded: false,
      deadlineOffsetDays: null,
      deadline: null,
      seededAt: null,
      completedAt: null,
      completedBy: null
    });
    showToast("Custom item added");
    // Close the form
    window.showAddChecklistItem();
  } catch (err) {
    console.error("Add custom item error:", err);
    showToast("Failed to add item.", "error");
  }
};

/**
 * Deletes a custom checklist item (only allowed for custom items).
 */
window.deleteChecklistItem = async function(itemId) {
  if (!currentClientId) return;
  const item = checklistItems.find(i => i.id === itemId);
  if (!item || !item.isCustom) {
    showToast("Only custom items can be deleted.", "error");
    return;
  }

  if (!window.confirm("Delete this custom checklist item?")) return;

  try {
    await deleteDoc(doc(db, "clients", currentClientId, "closingChecklist", itemId));
    showToast("Item deleted");
  } catch (err) {
    console.error("Delete checklist item error:", err);
    showToast("Failed to delete item.", "error");
  }
};

/* ------------------------------------------------------------------ */
/*  buildChecklistContext                                               */
/* ------------------------------------------------------------------ */

/**
 * Builds a context payload summarizing the current checklist state
 * for the AI check-in assistant.
 */
export function buildChecklistContext() {
  const items = checklistItems.filter(i => !i.notApplicable)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const done = items.filter(i => i.completed);
  const outstanding = items.filter(i => !i.completed);
  const effDeadline = (i) => i.customDeadline || i.deadline;
  const overdue = outstanding.filter(i => {
    const dl = effDeadline(i);
    if (!dl) return false;
    const d = typeof dl.toDate === "function" ? dl.toDate() : new Date(dl);
    return d < new Date();
  });

  return {
    clientName: currentClientData?.fullName || "Unknown",
    transactionType: currentClientData?.transactionType || "Not set",
    closingDate: currentClientData?.closingDate
      ? formatDate(currentClientData.closingDate)
      : "Not set",
    listingAddress: currentClientData?.listingAddress || "Not linked",
    progress: {
      total: items.length,
      completed: done.length,
      percentage: items.length > 0 ? Math.round((done.length / items.length) * 100) : 0
    },
    completedItems: done.map(i => ({
      task: i.task,
      category: CATEGORY_LABELS[i.category] || i.category,
      autoCompleted: i.autoCompleted || false
    })),
    outstandingItems: outstanding.map(i => {
      const dl = effDeadline(i);
      return {
        task: i.task,
        category: CATEGORY_LABELS[i.category] || i.category,
        deadline: dl ? formatDate(dl) : null,
        overdue: dl && (typeof dl.toDate === "function" ? dl.toDate() : new Date(dl)) < new Date()
      };
    }),
    overdueCount: overdue.length,
    todayDate: new Date().toLocaleDateString("en-US")
  };
}

/* ------------------------------------------------------------------ */
/*  openChecklistAI                                                    */
/* ------------------------------------------------------------------ */

/**
 * Opens the floating chatbot panel with full checklist context and
 * sends an auto-summary request to the AI assistant.
 */
export function openChecklistAI() {
  const context = buildChecklistContext();

  // Build the auto-summary prompt
  const prompt = `I'm checking in on my closing checklist for ${context.clientName}. ` +
    `Transaction type: ${context.transactionType}. ` +
    `Closing date: ${context.closingDate}. ` +
    `Please give me a quick status update: what's done, what's outstanding, flag anything overdue, and suggest my top 2-3 next actions.`;

  // Open the chatbot panel and send with checklist context
  if (typeof window.sendWithContext === "function") {
    window.sendWithContext(prompt, "checklist_checkin", context);
  } else {
    // Fallback: just open panel and set input
    window.toggleAiPanel();
    const input = document.getElementById("ai-input");
    if (input) {
      input.value = prompt;
      window.sendAiMessage();
    }
  }
}
window.openChecklistAI = openChecklistAI;

/* ------------------------------------------------------------------ */
/*  destroyChecklist                                                   */
/* ------------------------------------------------------------------ */

/**
 * Unsubscribes the onSnapshot listener and clears module state.
 */
export function destroyChecklist() {
  if (checklistUnsubscribe) {
    checklistUnsubscribe();
    checklistUnsubscribe = null;
  }
  checklistItems = [];
  currentClientId = null;
  currentClientData = null;
}
