/**
 * compliance.js — Compliance document data layer
 *
 * Provides the template library constants, merge field resolution utility,
 * and shared helpers consumed by the Compliance Docs tab UI (client-detail.js)
 * and referenced by the sendComplianceDoc Cloud Function.
 *
 * Exports:
 *   - COMPLIANCE_STATUSES   — Status enum for complianceDocs subcollection
 *   - COMPLIANCE_CATEGORIES  — Valid template categories
 *   - MO_FORM_STUBS          — Missouri residential form template definitions (24 forms)
 *   - buildMergeFields        — Resolves template mergeFields from client/listing/agent data
 *   - formatComplianceStatus  — Returns HTML badge string for a given status
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const COMPLIANCE_STATUSES = {
  NOT_SENT: "not_sent",
  SENT: "sent",
  SIGNED: "signed"
};

export const COMPLIANCE_CATEGORIES = ["contracts", "disclosures"];

/* ------------------------------------------------------------------ */
/*  Transaction type shorthand arrays                                  */
/* ------------------------------------------------------------------ */

const ALL_BUYER = [
  "SFH - Buyer",
  "Condo - Buyer",
  "Multi-Family - Buyer",
  "Land - Buyer"
];

const ALL_SELLER = [
  "SFH - Seller",
  "Condo - Seller",
  "Multi-Family - Seller",
  "Land - Seller"
];

const ALL_TYPES = [...ALL_BUYER, ...ALL_SELLER];

const SFH_CONDO_BUYER_SELLER = [
  "SFH - Buyer",
  "SFH - Seller",
  "Condo - Buyer",
  "Condo - Seller"
];

const CONDO_BUYER_SELLER = [
  "Condo - Buyer",
  "Condo - Seller"
];

const SFH_CONDO_MF_SELLER = [
  "SFH - Seller",
  "Condo - Seller",
  "Multi-Family - Seller"
];

/* ------------------------------------------------------------------ */
/*  Merge field presets                                                 */
/* ------------------------------------------------------------------ */

const BUYER_COMMON_FIELDS = [
  { fieldId: "BuyerName", source: "client.fullName" },
  { fieldId: "ClientEmail", source: "client.email" },
  { fieldId: "PropertyAddress", source: "listing.address.full" },
  { fieldId: "City", source: "listing.address.city" },
  { fieldId: "State", source: "listing.address.state" },
  { fieldId: "Zip", source: "listing.address.zip" },
  { fieldId: "PurchasePrice", source: "listing.listingPrice" },
  { fieldId: "MLSNumber", source: "listing.mlsNumber" },
  { fieldId: "AgentName", source: "agent.fullName" },
  { fieldId: "AgentEmail", source: "agent.email" },
  { fieldId: "Brokerage", source: "agent.brokerage" },
  { fieldId: "Date", source: "date" }
];

const SELLER_COMMON_FIELDS = [
  { fieldId: "SellerName", source: "client.fullName" },
  { fieldId: "ClientEmail", source: "client.email" },
  { fieldId: "PropertyAddress", source: "listing.address.full" },
  { fieldId: "City", source: "listing.address.city" },
  { fieldId: "State", source: "listing.address.state" },
  { fieldId: "Zip", source: "listing.address.zip" },
  { fieldId: "ListingPrice", source: "listing.listingPrice" },
  { fieldId: "MLSNumber", source: "listing.mlsNumber" },
  { fieldId: "AgentName", source: "agent.fullName" },
  { fieldId: "AgentEmail", source: "agent.email" },
  { fieldId: "Brokerage", source: "agent.brokerage" },
  { fieldId: "Date", source: "date" }
];

/* ------------------------------------------------------------------ */
/*  MO Form Stubs (24 Missouri residential forms)                      */
/* ------------------------------------------------------------------ */

export const MO_FORM_STUBS = [
  {
    name: "Purchase Agreement",
    description: "Standard MO residential purchase contract",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: true,
    sortOrder: 1,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Listing Agreement",
    description: "Standard MO residential listing agreement between seller and broker",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: true,
    sortOrder: 2,
    mergeFields: SELLER_COMMON_FIELDS
  },
  {
    name: "Agency Disclosure",
    description: "Missouri agency relationship disclosure required for all transactions",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: true,
    sortOrder: 3,
    mergeFields: [
      { fieldId: "BuyerName", source: "client.fullName" },
      { fieldId: "ClientEmail", source: "client.email" },
      { fieldId: "AgentName", source: "agent.fullName" },
      { fieldId: "AgentEmail", source: "agent.email" },
      { fieldId: "Brokerage", source: "agent.brokerage" },
      { fieldId: "Date", source: "date" }
    ]
  },
  {
    name: "Lead Paint Disclosure",
    description: "Federal lead-based paint disclosure for pre-1978 residential properties",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: SFH_CONDO_BUYER_SELLER,
    state: "MO",
    required: true,
    sortOrder: 4,
    mergeFields: [
      { fieldId: "BuyerName", source: "client.fullName" },
      { fieldId: "ClientEmail", source: "client.email" },
      { fieldId: "PropertyAddress", source: "listing.address.full" },
      { fieldId: "AgentName", source: "agent.fullName" },
      { fieldId: "Date", source: "date" }
    ]
  },
  {
    name: "HOA Addendum",
    description: "HOA disclosure addendum for condominium transactions",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: CONDO_BUYER_SELLER,
    state: "MO",
    required: false,
    sortOrder: 5,
    mergeFields: [
      { fieldId: "BuyerName", source: "client.fullName" },
      { fieldId: "ClientEmail", source: "client.email" },
      { fieldId: "PropertyAddress", source: "listing.address.full" },
      { fieldId: "City", source: "listing.address.city" },
      { fieldId: "State", source: "listing.address.state" },
      { fieldId: "Zip", source: "listing.address.zip" },
      { fieldId: "AgentName", source: "agent.fullName" },
      { fieldId: "Date", source: "date" }
    ]
  },
  {
    name: "Seller's Disclosure",
    description: "Missouri seller property condition disclosure statement",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: SFH_CONDO_MF_SELLER,
    state: "MO",
    required: true,
    sortOrder: 6,
    mergeFields: [
      { fieldId: "SellerName", source: "client.fullName" },
      { fieldId: "ClientEmail", source: "client.email" },
      { fieldId: "PropertyAddress", source: "listing.address.full" },
      { fieldId: "City", source: "listing.address.city" },
      { fieldId: "State", source: "listing.address.state" },
      { fieldId: "Zip", source: "listing.address.zip" },
      { fieldId: "ListingPrice", source: "listing.listingPrice" },
      { fieldId: "AgentName", source: "agent.fullName" },
      { fieldId: "Date", source: "date" }
    ]
  },
  {
    name: "Buyer Representation Agreement",
    description: "Buyer broker representation agreement for Missouri residential transactions",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: true,
    sortOrder: 7,
    mergeFields: [
      { fieldId: "BuyerName", source: "client.fullName" },
      { fieldId: "ClientEmail", source: "client.email" },
      { fieldId: "AgentName", source: "agent.fullName" },
      { fieldId: "AgentEmail", source: "agent.email" },
      { fieldId: "Brokerage", source: "agent.brokerage" },
      { fieldId: "Date", source: "date" }
    ]
  },

  // ── Buyer-side additions ─────────────────────────────────────────
  {
    name: "Financing Contingency Addendum",
    description: "Addendum specifying financing contingency terms and deadlines",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: false,
    sortOrder: 8,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Appraisal Contingency Addendum",
    description: "Addendum addressing appraisal contingency and resolution procedures",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: false,
    sortOrder: 9,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Inspection Contingency Addendum",
    description: "Addendum outlining inspection contingency terms and deadlines",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: false,
    sortOrder: 10,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Home Warranty Agreement",
    description: "Home warranty coverage agreement for residential purchase",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: false,
    sortOrder: 11,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Wire Fraud Advisory",
    description: "Advisory notice regarding wire fraud risks during closing",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: true,
    sortOrder: 12,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "MREC Broker Disclosure Form",
    description: "Missouri Real Estate Commission broker relationship disclosure",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: true,
    sortOrder: 13,
    mergeFields: BUYER_COMMON_FIELDS
  },

  // ── Seller-side additions ────────────────────────────────────────
  {
    name: "Seller's Affidavit",
    description: "Seller affidavit regarding property ownership and liens",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: false,
    sortOrder: 14,
    mergeFields: SELLER_COMMON_FIELDS
  },
  {
    name: "Commission Disclosure",
    description: "Disclosure of commission structure and compensation terms",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: true,
    sortOrder: 15,
    mergeFields: SELLER_COMMON_FIELDS
  },
  {
    name: "Photography/Media Authorization",
    description: "Authorization for property photography and media usage for marketing",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: false,
    sortOrder: 16,
    mergeFields: SELLER_COMMON_FIELDS
  },
  {
    name: "MLS Data Input Sheet",
    description: "Property data form for MLS listing entry",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: false,
    sortOrder: 17,
    mergeFields: SELLER_COMMON_FIELDS
  },
  {
    name: "FIRPTA Certificate",
    description: "Foreign Investment in Real Property Tax Act certification (seller)",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: false,
    sortOrder: 18,
    mergeFields: SELLER_COMMON_FIELDS
  },

  // ── Both/All additions ───────────────────────────────────────────
  {
    name: "Closing Date Extension Addendum",
    description: "Addendum to extend the closing date for the transaction",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: false,
    sortOrder: 19,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Repair Agreement/Amendment",
    description: "Agreement specifying negotiated repairs and amendments to the contract",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: false,
    sortOrder: 20,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Escrow Holdback Addendum",
    description: "Addendum for holdback of funds in escrow for post-closing items",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: false,
    sortOrder: 21,
    mergeFields: BUYER_COMMON_FIELDS
  },
  {
    name: "Radon Disclosure",
    description: "Radon gas testing disclosure and acknowledgment",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: false,
    sortOrder: 22,
    mergeFields: BUYER_COMMON_FIELDS
  },

  // ── Dual Agency ──────────────────────────────────────────────────
  {
    name: "Dual Agency Disclosure",
    description: "Disclosure and consent for dual agency representation",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: false,
    sortOrder: 23,
    mergeFields: [
      { fieldId: "BuyerName", source: "client.fullName" },
      { fieldId: "ClientEmail", source: "client.email" },
      { fieldId: "AgentName", source: "agent.fullName" },
      { fieldId: "AgentEmail", source: "agent.email" },
      { fieldId: "Brokerage", source: "agent.brokerage" },
      { fieldId: "Date", source: "date" }
    ]
  },
  {
    name: "Informed Consent (Dual Agency)",
    description: "Buyer and seller informed consent for dual agency relationship",
    docusealTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: false,
    sortOrder: 24,
    mergeFields: [
      { fieldId: "BuyerName", source: "client.fullName" },
      { fieldId: "ClientEmail", source: "client.email" },
      { fieldId: "AgentName", source: "agent.fullName" },
      { fieldId: "AgentEmail", source: "agent.email" },
      { fieldId: "Brokerage", source: "agent.brokerage" },
      { fieldId: "Date", source: "date" }
    ]
  }
];

/* ------------------------------------------------------------------ */
/*  buildMergeFields                                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolves a template's mergeFields array against live client, listing, and
 * agent data. Returns resolved field-value pairs plus a list of any fields
 * that could not be resolved.
 *
 * @param {Object} template       - documentTemplates document (must have mergeFields array)
 * @param {Object|null} clientData  - client Firestore doc data
 * @param {Object|null} listingData - listing Firestore doc data (may be null)
 * @param {Object|null} agentProfile - users/{uid} Firestore doc data
 * @returns {{ existingFormFields: Array<{id: string, value: string}>, missing: string[] }}
 */
export function buildMergeFields(template, clientData, listingData, agentProfile) {
  const sources = {
    client: clientData || {},
    listing: listingData || {},
    agent: agentProfile || {}
  };

  const missing = [];
  const existingFormFields = (template.mergeFields || []).map(field => {
    // Accept both `fieldId` (current) and `boldSignFieldId` (legacy data).
    const fid = field.fieldId || field.boldSignFieldId;
    // Special case: "date" resolves to current date at send time
    if (field.source === "date") {
      return { id: fid, value: new Date().toLocaleDateString("en-US") };
    }

    // Dot-path resolution: "listing.address.full" -> sources.listing.address.full
    const [sourceKey, ...pathParts] = field.source.split(".");
    let value = sources[sourceKey];
    for (const part of pathParts) {
      value = value?.[part];
    }

    const resolved = value != null ? String(value) : "";
    if (!resolved) {
      missing.push(fid);
    }

    return { id: fid, value: resolved };
  });

  return { existingFormFields, missing };
}

/* ------------------------------------------------------------------ */
/*  formatComplianceStatus                                             */
/* ------------------------------------------------------------------ */

/**
 * Returns an HTML badge string for a compliance document status.
 *
 * @param {string} status   - One of "not_sent", "sent", "signed"
 * @param {Date|{toDate:Function}|null} signedAt - Firestore Timestamp or Date for signed status
 * @returns {string} HTML string for the status badge
 */
export function formatComplianceStatus(status, signedAt) {
  switch (status) {
    case COMPLIANCE_STATUSES.SIGNED: {
      let dateStr = "";
      if (signedAt) {
        const d = typeof signedAt.toDate === "function" ? signedAt.toDate() : new Date(signedAt);
        dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
      return `<span class="gd-badge gd-badge-compliance-signed">Signed${dateStr ? " &mdash; " + dateStr : ""}</span>`;
    }
    case COMPLIANCE_STATUSES.SENT:
      return '<span class="gd-badge gd-badge-compliance-sent">Sent</span>';
    case COMPLIANCE_STATUSES.NOT_SENT:
    default:
      return '<span class="gd-badge gd-badge-compliance-notsent">Not Sent</span>';
  }
}
