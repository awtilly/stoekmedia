/**
 * seed-templates.js — Seed the documentTemplates Firestore collection
 *
 * Usage:
 *   cd functions && node seed-templates.js
 *
 * Prerequisites:
 *   - Firebase CLI authenticated (firebase login) OR
 *   - GOOGLE_APPLICATION_CREDENTIALS environment variable set to a service account key
 *
 * What this does:
 *   Seeds 7 Missouri residential form stubs into the documentTemplates collection.
 *   Each stub has an EMPTY docusealTemplateId — these are placeholders.
 *
 * After running this script:
 *   1. Create the matching templates in the DocuSeal dashboard for each form
 *   2. For each template, read its DocuSeal template ID + field names
 *   3. Update each documentTemplates document in Firestore:
 *      - Set docusealTemplateId to the real DocuSeal template ID
 *      - Update docusealFieldMap so each mergeFields[].fieldId maps to the
 *        corresponding DocuSeal field name
 *
 * Re-running is safe:
 *   Uses deterministic document IDs and batch.set with { merge: true },
 *   so re-running overwrites existing stubs without creating duplicates.
 */

const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "greendoor-2da47"
});

const db = admin.firestore();
const { FieldValue } = admin.firestore;

/* ------------------------------------------------------------------ */
/*  Missouri Form Stubs                                                */
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

const moForms = [
  {
    id: "mo-purchase-agreement",
    name: "Purchase Agreement",
    description: "Standard MO residential purchase contract",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: true,
    sortOrder: 1,
    mergeFields: [
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
    ]
  },
  {
    id: "mo-listing-agreement",
    name: "Listing Agreement",
    description: "Standard MO residential listing agreement between seller and broker",
    docusealTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: true,
    sortOrder: 2,
    mergeFields: [
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
    ]
  },
  {
    id: "mo-agency-disclosure",
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
    id: "mo-lead-paint-disclosure",
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
    id: "mo-hoa-addendum",
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
    id: "mo-sellers-disclosure",
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
    id: "mo-buyer-representation-agreement",
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
    id: "mo-financing-contingency",
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
    id: "mo-appraisal-contingency",
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
    id: "mo-inspection-contingency",
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
    id: "mo-home-warranty",
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
    id: "mo-wire-fraud-advisory",
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
    id: "mo-mrec-broker-disclosure",
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
    id: "mo-sellers-affidavit",
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
    id: "mo-commission-disclosure",
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
    id: "mo-photography-authorization",
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
    id: "mo-mls-data-input",
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
    id: "mo-firpta-certificate",
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
    id: "mo-closing-date-extension",
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
    id: "mo-repair-agreement",
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
    id: "mo-escrow-holdback",
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
    id: "mo-radon-disclosure",
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
    id: "mo-dual-agency-disclosure",
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
    id: "mo-informed-consent-dual-agency",
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
/*  Seed Function                                                      */
/* ------------------------------------------------------------------ */

async function seedTemplates() {
  console.log("Seeding documentTemplates collection...\n");

  const batch = db.batch();

  for (const form of moForms) {
    const { id, ...data } = form;
    const docRef = db.collection("documentTemplates").doc(id);

    batch.set(docRef, {
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`  + ${form.name} (${id})`);
  }

  await batch.commit();
  console.log(`\nSeed complete: ${moForms.length} MO templates written to documentTemplates`);
}

/* ------------------------------------------------------------------ */
/*  Run                                                                */
/* ------------------------------------------------------------------ */

seedTemplates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
