/**
 * checklist.js — Closing checklist data model and seeding logic
 *
 * Provides the MO residential transaction checklist template, category
 * constants, and functions to seed/update checklist items in the Firestore
 * closingChecklist subcollection.
 *
 * Exports:
 *   - CHECKLIST_CATEGORIES   — Category enum for checklist grouping
 *   - CATEGORY_LABELS        — Human-readable labels for each category
 *   - MO_CLOSING_CHECKLIST_TEMPLATE — 28-item Missouri residential checklist template
 *   - parseTransactionType   — Parses "SFH - Buyer" into { propType, side }
 *   - seedChecklist          — Seeds applicable items to Firestore subcollection
 *   - recalculateDeadlines   — Recalculates deadline fields when closing date changes
 */

import {
  writeBatch, doc, collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const CHECKLIST_CATEGORIES = {
  PRE_CONTRACT: "pre_contract",
  UNDER_CONTRACT: "under_contract",
  CLOSING: "closing"
};

export const CATEGORY_LABELS = {
  pre_contract: "Pre-Contract",
  under_contract: "Under Contract",
  closing: "Closing"
};

/* ------------------------------------------------------------------ */
/*  Property type shorthand arrays                                     */
/* ------------------------------------------------------------------ */

const ALL_TYPES = ["SFH", "Condo", "Multi-Family", "Land"];
const SFH_CONDO_MF = ["SFH", "Condo", "Multi-Family"];
const SFH_CONDO = ["SFH", "Condo"];

/* ------------------------------------------------------------------ */
/*  MO Closing Checklist Template (28 items)                           */
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
    linkedTemplateId: "mo-buyer-rep-agreement",
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

  // ── Under Contract (14 items) ───────────────────────────────────
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

  // ── Closing (7 items) ──────────────────────────────────────────
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
export async function seedChecklist(db, clientId, transactionType, closingDate) {
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
