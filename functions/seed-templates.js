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
 *   Each stub has an EMPTY boldSignTemplateId — these are placeholders.
 *
 * After running this script:
 *   1. Create actual templates in the BoldSign dashboard for each form
 *   2. For each template, call GET /v1/template/{templateId} to discover actual field IDs
 *   3. Update each documentTemplates document in Firestore:
 *      - Set boldSignTemplateId to the real BoldSign template ID
 *      - Update mergeFields[].boldSignFieldId values to match actual BoldSign field names
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

const moForms = [
  {
    id: "mo-purchase-agreement",
    name: "Purchase Agreement",
    description: "Standard MO residential purchase contract",
    boldSignTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: true,
    sortOrder: 1,
    mergeFields: [
      { boldSignFieldId: "BuyerName", source: "client.fullName" },
      { boldSignFieldId: "ClientEmail", source: "client.email" },
      { boldSignFieldId: "PropertyAddress", source: "listing.address.full" },
      { boldSignFieldId: "City", source: "listing.address.city" },
      { boldSignFieldId: "State", source: "listing.address.state" },
      { boldSignFieldId: "Zip", source: "listing.address.zip" },
      { boldSignFieldId: "PurchasePrice", source: "listing.listingPrice" },
      { boldSignFieldId: "MLSNumber", source: "listing.mlsNumber" },
      { boldSignFieldId: "AgentName", source: "agent.fullName" },
      { boldSignFieldId: "AgentEmail", source: "agent.email" },
      { boldSignFieldId: "Brokerage", source: "agent.brokerage" },
      { boldSignFieldId: "Date", source: "date" }
    ]
  },
  {
    id: "mo-listing-agreement",
    name: "Listing Agreement",
    description: "Standard MO residential listing agreement between seller and broker",
    boldSignTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_SELLER,
    state: "MO",
    required: true,
    sortOrder: 2,
    mergeFields: [
      { boldSignFieldId: "SellerName", source: "client.fullName" },
      { boldSignFieldId: "ClientEmail", source: "client.email" },
      { boldSignFieldId: "PropertyAddress", source: "listing.address.full" },
      { boldSignFieldId: "City", source: "listing.address.city" },
      { boldSignFieldId: "State", source: "listing.address.state" },
      { boldSignFieldId: "Zip", source: "listing.address.zip" },
      { boldSignFieldId: "ListingPrice", source: "listing.listingPrice" },
      { boldSignFieldId: "MLSNumber", source: "listing.mlsNumber" },
      { boldSignFieldId: "AgentName", source: "agent.fullName" },
      { boldSignFieldId: "AgentEmail", source: "agent.email" },
      { boldSignFieldId: "Brokerage", source: "agent.brokerage" },
      { boldSignFieldId: "Date", source: "date" }
    ]
  },
  {
    id: "mo-agency-disclosure",
    name: "Agency Disclosure",
    description: "Missouri agency relationship disclosure required for all transactions",
    boldSignTemplateId: "",
    category: "disclosures",
    transactionTypes: ALL_TYPES,
    state: "MO",
    required: true,
    sortOrder: 3,
    mergeFields: [
      { boldSignFieldId: "BuyerName", source: "client.fullName" },
      { boldSignFieldId: "ClientEmail", source: "client.email" },
      { boldSignFieldId: "AgentName", source: "agent.fullName" },
      { boldSignFieldId: "AgentEmail", source: "agent.email" },
      { boldSignFieldId: "Brokerage", source: "agent.brokerage" },
      { boldSignFieldId: "Date", source: "date" }
    ]
  },
  {
    id: "mo-lead-paint-disclosure",
    name: "Lead Paint Disclosure",
    description: "Federal lead-based paint disclosure for pre-1978 residential properties",
    boldSignTemplateId: "",
    category: "disclosures",
    transactionTypes: SFH_CONDO_BUYER_SELLER,
    state: "MO",
    required: true,
    sortOrder: 4,
    mergeFields: [
      { boldSignFieldId: "BuyerName", source: "client.fullName" },
      { boldSignFieldId: "ClientEmail", source: "client.email" },
      { boldSignFieldId: "PropertyAddress", source: "listing.address.full" },
      { boldSignFieldId: "AgentName", source: "agent.fullName" },
      { boldSignFieldId: "Date", source: "date" }
    ]
  },
  {
    id: "mo-hoa-addendum",
    name: "HOA Addendum",
    description: "HOA disclosure addendum for condominium transactions",
    boldSignTemplateId: "",
    category: "contracts",
    transactionTypes: CONDO_BUYER_SELLER,
    state: "MO",
    required: false,
    sortOrder: 5,
    mergeFields: [
      { boldSignFieldId: "BuyerName", source: "client.fullName" },
      { boldSignFieldId: "ClientEmail", source: "client.email" },
      { boldSignFieldId: "PropertyAddress", source: "listing.address.full" },
      { boldSignFieldId: "City", source: "listing.address.city" },
      { boldSignFieldId: "State", source: "listing.address.state" },
      { boldSignFieldId: "Zip", source: "listing.address.zip" },
      { boldSignFieldId: "AgentName", source: "agent.fullName" },
      { boldSignFieldId: "Date", source: "date" }
    ]
  },
  {
    id: "mo-sellers-disclosure",
    name: "Seller's Disclosure",
    description: "Missouri seller property condition disclosure statement",
    boldSignTemplateId: "",
    category: "disclosures",
    transactionTypes: SFH_CONDO_MF_SELLER,
    state: "MO",
    required: true,
    sortOrder: 6,
    mergeFields: [
      { boldSignFieldId: "SellerName", source: "client.fullName" },
      { boldSignFieldId: "ClientEmail", source: "client.email" },
      { boldSignFieldId: "PropertyAddress", source: "listing.address.full" },
      { boldSignFieldId: "City", source: "listing.address.city" },
      { boldSignFieldId: "State", source: "listing.address.state" },
      { boldSignFieldId: "Zip", source: "listing.address.zip" },
      { boldSignFieldId: "ListingPrice", source: "listing.listingPrice" },
      { boldSignFieldId: "AgentName", source: "agent.fullName" },
      { boldSignFieldId: "Date", source: "date" }
    ]
  },
  {
    id: "mo-buyer-representation-agreement",
    name: "Buyer Representation Agreement",
    description: "Buyer broker representation agreement for Missouri residential transactions",
    boldSignTemplateId: "",
    category: "contracts",
    transactionTypes: ALL_BUYER,
    state: "MO",
    required: true,
    sortOrder: 7,
    mergeFields: [
      { boldSignFieldId: "BuyerName", source: "client.fullName" },
      { boldSignFieldId: "ClientEmail", source: "client.email" },
      { boldSignFieldId: "AgentName", source: "agent.fullName" },
      { boldSignFieldId: "AgentEmail", source: "agent.email" },
      { boldSignFieldId: "Brokerage", source: "agent.brokerage" },
      { boldSignFieldId: "Date", source: "date" }
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
