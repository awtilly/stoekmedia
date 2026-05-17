/**
 * migrate-templates-to-docuseal.js
 *
 * One-shot Firestore migration: adds the DocuSeal counterpart fields to every
 * existing `documentTemplates` document so the V2 compliance senders have
 * something to read.
 *
 * What it writes per template:
 *   - docusealTemplateId: ""            (Joe fills this in after creating the
 *                                        template in the DocuSeal dashboard)
 *   - docusealFieldMap: {bold:bold, ...} (identity map by default — assumes
 *                                        same field names in DocuSeal as in
 *                                        BoldSign. Override per-template only
 *                                        where the names diverge.)
 *   - visibility: "seeded"               (Sprint 2 schema: distinguishes
 *                                        admin-seeded compliance forms from
 *                                        realtor-uploaded private templates)
 *   - ownerId: null                      (Sprint 2 schema: null = seeded)
 *
 * Re-running is safe: only writes a key if it's currently absent, never
 * overwrites a docusealTemplateId Joe has already set.
 *
 * Usage:
 *   cd functions && node migrate-templates-to-docuseal.js
 */

const admin = require("firebase-admin");

admin.initializeApp({ projectId: "greendoor-2da47" });
const db = admin.firestore();

async function migrate() {
  const snap = await db.collection("documentTemplates").get();
  console.log(`Found ${snap.size} documentTemplates docs`);

  let updated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const patch = {};

    if (typeof data.docusealTemplateId === "undefined") {
      patch.docusealTemplateId = "";
    }

    if (typeof data.docusealFieldMap === "undefined") {
      const map = {};
      for (const f of (data.mergeFields || [])) {
        if (f.boldSignFieldId) map[f.boldSignFieldId] = f.boldSignFieldId;
      }
      patch.docusealFieldMap = map;
    }

    if (typeof data.visibility === "undefined") {
      patch.visibility = "seeded";
    }

    if (typeof data.ownerId === "undefined") {
      patch.ownerId = null;
    }

    if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    await docSnap.ref.update(patch);
    console.log(`  + ${docSnap.id}: ${Object.keys(patch).join(", ")}`);
    updated++;
  }

  console.log(`\nMigration complete: ${updated} updated, ${skipped} already current`);
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
