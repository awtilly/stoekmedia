const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");

const BOLDSIGN_API_KEY = defineSecret("BOLDSIGN_API_KEY");
const BOLDSIGN_WEBHOOK_SECRET = defineSecret("BOLDSIGN_WEBHOOK_SECRET");
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const GROQ_API_KEY = defineSecret("GROQ_API_KEY");
const VOYAGE_API_KEY = defineSecret("VOYAGE_API_KEY");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const DOCUSEAL_API_KEY = defineSecret("DOCUSEAL_API_KEY");
const DOCUSEAL_WEBHOOK_SECRET = defineSecret("DOCUSEAL_WEBHOOK_SECRET");
const DOCUSEAL_BASE_URL = defineSecret("DOCUSEAL_BASE_URL");
const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");

// Sentinel for unactivated migrations: secrets exist in Secret Manager
// with this value so `defineSecret` resolves at deploy time, but runtime
// code treats them as unset and falls back to the legacy provider.
const PENDING_SENTINEL = "__pending__";
function isLiveSecret(value) {
  return Boolean(value) && value !== PENDING_SENTINEL;
}

initializeApp();
const db = getFirestore();

function isPrivateHost(host) {
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^::1$/.test(host) ||
    /^fe80:/i.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host)
  );
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Per-uid daily rate limit using the `rateLimits/{uid}` doc.
 * Throws HttpsError("resource-exhausted") when the cap is reached.
 */
async function enforceRateLimit(uid, key, maxPerDay) {
  const today = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`rateLimits/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const entry = data[key];
    const count = entry && entry.date === today ? entry.count : 0;
    if (count >= maxPerDay) {
      throw new HttpsError(
        "resource-exhausted",
        `Daily limit reached for ${key} (${maxPerDay}/day). Try again tomorrow.`
      );
    }
    tx.set(ref, { [key]: { date: today, count: count + 1 } }, { merge: true });
  });
}

/**
 * createSenderIdentity
 *
 * Creates a BoldSign sender identity for the authenticated realtor so that
 * compliance documents sent via sendComplianceDoc show the realtor's name
 * and email as the sender (via the onBehalfOf parameter).
 *
 * After creation, BoldSign sends an approval email to the realtor. The
 * realtor must click the approval link before onBehalfOf can be used.
 *
 * Stores approval status in Firestore users/{uid}.
 */
exports.createSenderIdentity = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  // Validate authentication
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to create a sender identity.");
  }

  const uid = request.auth.uid;

  // Read the caller's Firestore profile
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found in Firestore.");
  }

  const userData = userSnap.data();

  // If sender identity is already approved, skip creation
  if (userData.boldSignSenderIdentityStatus === "approved") {
    return { status: "already_approved", email: userData.boldSignSenderEmail };
  }

  // Determine sender name and email
  const fullName = userData.fullName;
  if (!fullName) {
    throw new HttpsError("failed-precondition", "Your profile is missing a display name. Please update your name in Settings.");
  }

  // Email fallback chain: Firestore profile email -> Firebase Auth email (BSND-04)
  const senderEmail = userData.email || request.auth.token.email;
  if (!senderEmail) {
    throw new HttpsError("failed-precondition", "No email address found on your profile or auth account.");
  }

  // Call BoldSign Sender Identity API
  const apiKey = BOLDSIGN_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("internal", "BoldSign API key is not configured. Set BOLDSIGN_API_KEY in Cloud Functions environment.");
  }

  try {
    const response = await fetch("https://api.boldsign.com/v1/senderIdentities/create", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: fullName,
        email: senderEmail,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new HttpsError(
        "internal",
        `BoldSign API error (${response.status}): ${errorBody}`
      );
    }

    // Write pending approval status to Firestore
    await userRef.update({
      boldSignSenderIdentityStatus: "pending_approval",
      boldSignSenderEmail: senderEmail,
    });

    return {
      status: "pending_approval",
      email: senderEmail,
      message: "Check your email to approve the sender identity",
    };
  } catch (error) {
    // Re-throw HttpsError instances as-is
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", `Failed to create sender identity: ${error.message}`);
  }
});

/* ------------------------------------------------------------------ */
/*  Shared helper: resolve merge fields server-side (dot-path walking) */
/* ------------------------------------------------------------------ */

function resolveServerMergeFields(mergeFields, clientData, listingData, agentProfile) {
  const sources = {
    client: clientData || {},
    listing: listingData || {},
    agent: agentProfile || {}
  };

  const missing = [];
  const existingFormFields = (mergeFields || []).map(field => {
    // Special case: "date" resolves to current date at send time
    if (field.source === "date") {
      return { id: field.boldSignFieldId, value: new Date().toLocaleDateString("en-US") };
    }

    const [sourceKey, ...pathParts] = field.source.split(".");
    let value = sources[sourceKey];
    for (const part of pathParts) {
      value = value?.[part];
    }

    const resolved = value != null ? String(value) : "";
    if (!resolved) {
      missing.push(field.boldSignFieldId);
    }

    return { id: field.boldSignFieldId, value: resolved };
  });

  return { existingFormFields, missing };
}

/**
 * sendComplianceDoc
 *
 * Sends a compliance document to a client for signature via BoldSign.
 * Reads template metadata from documentTemplates, resolves merge fields from
 * client/listing/agent data, calls BoldSign /v1/template/send with
 * existingFormFields and onBehalfOf, and writes status to complianceDocs subcollection.
 *
 * Accepts: { templateId, clientId, listingId }
 */
exports.sendComplianceDoc = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  // Validate authentication
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to send compliance documents.");
  }

  const uid = request.auth.uid;
  const { templateId, clientId, listingId } = request.data || {};

  // Validate required parameters
  if (!templateId || !clientId) {
    throw new HttpsError("invalid-argument", "templateId and clientId are required.");
  }

  const apiKey = BOLDSIGN_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("internal", "BoldSign API key is not configured. Set BOLDSIGN_API_KEY in Cloud Functions environment.");
  }

  try {
    // 1. Read template metadata
    const templateSnap = await db.doc(`documentTemplates/${templateId}`).get();
    if (!templateSnap.exists) {
      throw new HttpsError("not-found", "Compliance template not found.");
    }
    const template = templateSnap.data();

    if (!template.boldSignTemplateId) {
      throw new HttpsError("failed-precondition", "Template not configured in BoldSign. Contact admin.");
    }

    // 2. Read client data
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Client not found.");
    }
    const clientDataDoc = clientSnap.data();

    if (!clientDataDoc.email) {
      throw new HttpsError("failed-precondition", "Client email required for signature request.");
    }

    // 3. Read listing data (if provided)
    let listingData = null;
    if (listingId) {
      const listingSnap = await db.doc(`listings/${listingId}`).get();
      if (listingSnap.exists) {
        listingData = listingSnap.data();
      }
    }

    // 4. Read agent profile
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User profile not found in Firestore.");
    }
    const agentProfile = userSnap.data();

    // 5. Resolve sender email (BSND-03, BSND-04)
    const senderEmail = agentProfile.email || request.auth.token.email;
    const senderApproved = agentProfile.boldSignSenderIdentityStatus === "approved";

    if (!senderApproved) {
      console.warn(
        `Sender identity not approved for ${uid} (status: ${agentProfile.boldSignSenderIdentityStatus || "not_created"}). ` +
        "Proceeding without onBehalfOf -- emails will show default BoldSign sender."
      );
    }

    // 6. Resolve merge fields
    const { existingFormFields } = resolveServerMergeFields(
      template.mergeFields, clientDataDoc, listingData, agentProfile
    );

    // 7. Call BoldSign API: POST /v1/template/send
    const sendBody = {
      roles: [{
        roleIndex: 1,
        signerName: clientDataDoc.fullName || "Client",
        signerEmail: clientDataDoc.email,
        existingFormFields: existingFormFields
      }],
      title: template.name,
      message: "Please review and sign: " + template.name
    };

    // Only include onBehalfOf if sender identity is approved
    if (senderApproved && senderEmail) {
      sendBody.onBehalfOf = senderEmail;
    }

    const bsResponse = await fetch(
      `https://api.boldsign.com/v1/template/send?templateId=${template.boldSignTemplateId}`,
      {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(sendBody)
      }
    );

    if (!bsResponse.ok) {
      const errorBody = await bsResponse.text();
      console.error(`BoldSign template/send error (${bsResponse.status}):`, errorBody);
      throw new HttpsError("internal", "Failed to send document via BoldSign. Please try again.");
    }

    const bsResult = await bsResponse.json();

    // 8. Write to complianceDocs subcollection
    await db.doc(`clients/${clientId}/complianceDocs/${templateId}`).set({
      templateId: templateId,
      boldSignDocumentId: bsResult.documentId,
      status: "sent",
      sentAt: require("firebase-admin/firestore").FieldValue.serverTimestamp(),
      signedAt: null,
      sentBy: uid,
      listingId: listingId || null
    });

    return { documentId: bsResult.documentId, status: "sent" };

  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    console.error("sendComplianceDoc error:", error);
    throw new HttpsError("internal", `Failed to send compliance document: ${error.message}`);
  }
});

/**
 * sendBulkComplianceDocs
 *
 * Bundles multiple compliance templates into a single BoldSign envelope
 * via /v1/template/mergeAndSend. If mergeAndSend fails, falls back to
 * sequential /v1/template/send calls per template.
 *
 * Accepts: { templateIds: string[], clientId, listingId }
 */
exports.sendBulkComplianceDocs = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to send compliance documents.");
  }

  const uid = request.auth.uid;
  const { templateIds, clientId, listingId } = request.data || {};

  if (!templateIds || !Array.isArray(templateIds) || templateIds.length === 0 || !clientId) {
    throw new HttpsError("invalid-argument", "templateIds (non-empty array) and clientId are required.");
  }

  const apiKey = BOLDSIGN_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("internal", "BoldSign API key is not configured. Set BOLDSIGN_API_KEY in Cloud Functions environment.");
  }

  try {
    // Read agent profile
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User profile not found in Firestore.");
    }
    const agentProfile = userSnap.data();
    const senderEmail = agentProfile.email || request.auth.token.email;
    const senderApproved = agentProfile.boldSignSenderIdentityStatus === "approved";

    // Read client data
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Client not found.");
    }
    const clientDataDoc = clientSnap.data();

    if (!clientDataDoc.email) {
      throw new HttpsError("failed-precondition", "Client email required for signature request.");
    }

    // Read listing data (if provided)
    let listingData = null;
    if (listingId) {
      const listingSnap = await db.doc(`listings/${listingId}`).get();
      if (listingSnap.exists) {
        listingData = listingSnap.data();
      }
    }

    // Read all template documents
    const templateDocs = [];
    for (const tid of templateIds) {
      const tSnap = await db.doc(`documentTemplates/${tid}`).get();
      if (!tSnap.exists) {
        throw new HttpsError("not-found", `Template ${tid} not found.`);
      }
      const tData = tSnap.data();
      if (!tData.boldSignTemplateId) {
        throw new HttpsError("failed-precondition", `Template "${tData.name || tid}" not configured in BoldSign. Contact admin.`);
      }
      templateDocs.push({ id: tid, ...tData });
    }

    const boldSignTemplateIds = templateDocs.map(t => t.boldSignTemplateId);
    const FieldValue = require("firebase-admin/firestore").FieldValue;

    // Attempt mergeAndSend (single envelope)
    let mergeSuccess = false;
    let envelopeDocId = null;

    try {
      const mergeBody = {
        templateIds: boldSignTemplateIds,
        roles: [{
          roleIndex: 1,
          signerName: clientDataDoc.fullName || "Client",
          signerEmail: clientDataDoc.email
        }],
        title: "Compliance Documents",
        message: "Please review and sign the following compliance documents"
      };

      if (senderApproved && senderEmail) {
        mergeBody.onBehalfOf = senderEmail;
      }

      const mergeResponse = await fetch("https://api.boldsign.com/v1/template/mergeAndSend", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(mergeBody)
      });

      if (!mergeResponse.ok) {
        const errText = await mergeResponse.text();
        console.warn(`mergeAndSend failed (${mergeResponse.status}): ${errText}. Falling back to sequential sends.`);
        throw new Error("mergeAndSend failed");
      }

      const mergeResult = await mergeResponse.json();
      envelopeDocId = mergeResult.documentId;

      // Write complianceDocs entries for each template (all share the same envelope)
      for (const tdoc of templateDocs) {
        await db.doc(`clients/${clientId}/complianceDocs/${tdoc.id}`).set({
          templateId: tdoc.id,
          boldSignDocumentId: envelopeDocId,
          status: "sent",
          sentAt: FieldValue.serverTimestamp(),
          signedAt: null,
          sentBy: uid,
          listingId: listingId || null,
          bulkEnvelopeId: envelopeDocId
        });
      }

      mergeSuccess = true;
    } catch (mergeErr) {
      // Fall through to sequential sends
      console.warn("mergeAndSend failed, falling back to sequential sends:", mergeErr.message);
    }

    // Fallback: sequential sends
    if (!mergeSuccess) {
      const documents = [];

      for (const tdoc of templateDocs) {
        const { existingFormFields } = resolveServerMergeFields(
          tdoc.mergeFields, clientDataDoc, listingData, agentProfile
        );

        const sendBody = {
          roles: [{
            roleIndex: 1,
            signerName: clientDataDoc.fullName || "Client",
            signerEmail: clientDataDoc.email,
            existingFormFields: existingFormFields
          }],
          title: tdoc.name,
          message: "Please review and sign: " + tdoc.name
        };

        if (senderApproved && senderEmail) {
          sendBody.onBehalfOf = senderEmail;
        }

        const bsResponse = await fetch(
          `https://api.boldsign.com/v1/template/send?templateId=${tdoc.boldSignTemplateId}`,
          {
            method: "POST",
            headers: {
              "X-API-KEY": apiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(sendBody)
          }
        );

        if (!bsResponse.ok) {
          const errText = await bsResponse.text();
          console.error(`Sequential send failed for ${tdoc.id} (${bsResponse.status}):`, errText);
          continue; // Skip this template, try next
        }

        const bsResult = await bsResponse.json();

        await db.doc(`clients/${clientId}/complianceDocs/${tdoc.id}`).set({
          templateId: tdoc.id,
          boldSignDocumentId: bsResult.documentId,
          status: "sent",
          sentAt: FieldValue.serverTimestamp(),
          signedAt: null,
          sentBy: uid,
          listingId: listingId || null
        });

        documents.push({ templateId: tdoc.id, documentId: bsResult.documentId });
      }

      return { mode: "sequential", documents: documents, templateCount: documents.length };
    }

    return { mode: "envelope", documentId: envelopeDocId, templateCount: templateIds.length };

  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    console.error("sendBulkComplianceDocs error:", error);
    throw new HttpsError("internal", `Failed to send bulk compliance documents: ${error.message}`);
  }
});

/* ------------------------------------------------------------------ */
/*  HMAC signature verification for BoldSign webhooks                 */
/* ------------------------------------------------------------------ */

function verifyBoldSignSignature(signatureHeader, rawBody, secret) {
  if (!signatureHeader || !secret) return false;

  // Parse header: "t=1668693823, s0=abc123def"
  const parts = {};
  signatureHeader.split(",").forEach(segment => {
    const trimmed = segment.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      parts[trimmed.substring(0, eqIdx)] = trimmed.substring(eqIdx + 1);
    }
  });

  const timestamp = parts["t"];
  const signature = parts["s0"];
  if (!timestamp || !signature) return false;

  // Signed payload: timestamp + "." + rawBody (as UTF-8 string)
  const signedPayload = timestamp + "." + (Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
  const computed = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  sanitizeIcalUid: clean iCal UIDs for Firestore doc ID safety       */
/* ------------------------------------------------------------------ */

function sanitizeIcalUid(uid) {
  return uid.replace(/[\/\.#\$\[\]]/g, "_");
}

/* ------------------------------------------------------------------ */
/*  boldSignWebhook                                                    */
/*                                                                     */
/*  Receives BoldSign completion events, verifies HMAC signature,      */
/*  downloads the signed PDF, uploads it to Firebase Storage under      */
/*  the client's closing-documents path, creates a Firestore file       */
/*  record, and updates the compliance doc status to "signed".          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  DocuSeal parallel path (BoldSign replacement, gated by secrets)    */
/*                                                                     */
/*  - sendViaDocuSeal: helper that creates a one-shot template from a  */
/*    PDF and a submission against it. Mirrors the BoldSign payload    */
/*    shape so callers can swap with minimal changes.                  */
/*  - docusealWebhook: receives form.completed events, downloads the   */
/*    signed PDF, writes the same Firestore shape boldSignWebhook does.*/
/*                                                                     */
/*  To activate:                                                       */
/*    1. Set DOCUSEAL_API_KEY, DOCUSEAL_WEBHOOK_SECRET, and            */
/*       DOCUSEAL_BASE_URL (e.g. https://api.docuseal.com).            */
/*    2. Configure the webhook URL in DocuSeal to point to             */
/*       <region>-<project>.cloudfunctions.net/docusealWebhook.        */
/*    3. Swap frontend calls from sendForSignature → sendForSignatureV2*/
/*       when ready. The BoldSign path keeps working in the meantime.  */
/* ------------------------------------------------------------------ */
function docusealBaseUrl() {
  return (DOCUSEAL_BASE_URL.value() || "https://api.docuseal.com").replace(/\/+$/, "");
}

async function sendViaDocuSeal({ clientId, files, signers, title, message, expiryDays, realtorId }) {
  const apiKey = DOCUSEAL_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "DOCUSEAL_API_KEY is not configured.");
  }
  const base = docusealBaseUrl();

  // Step 1: create a one-shot template from the uploaded PDF(s). DocuSeal's
  // canonical flow is template → submission; for ad-hoc sends we make a
  // disposable template per document.
  const pdfDocs = [];
  for (const f of files) {
    const resp = await fetch(f.downloadUrl);
    if (!resp.ok) throw new HttpsError("internal", `Failed to download file: ${f.fileName}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    pdfDocs.push({
      name: f.fileName,
      file: buf.toString("base64")
    });
  }

  const tmplResp = await fetch(`${base}/templates/pdf`, {
    method: "POST",
    headers: { "X-Auth-Token": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: title || "Document for Signature",
      documents: pdfDocs
    })
  });
  if (!tmplResp.ok) {
    throw new HttpsError("internal", `DocuSeal template error ${tmplResp.status}: ${await tmplResp.text()}`);
  }
  const tmpl = await tmplResp.json();
  const templateId = tmpl.id;

  // Step 2: create the submission referencing that template
  const submitters = signers.map((s, i) => ({
    role: s.role || `Signer ${i + 1}`,
    name: s.name,
    email: s.email
  }));
  const subResp = await fetch(`${base}/submissions`, {
    method: "POST",
    headers: { "X-Auth-Token": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: templateId,
      send_email: true,
      message: { subject: title, body: message || "" },
      expire_at: expiryDays ? new Date(Date.now() + expiryDays * 86400 * 1000).toISOString() : undefined,
      submitters
    })
  });
  if (!subResp.ok) {
    throw new HttpsError("internal", `DocuSeal submission error ${subResp.status}: ${await subResp.text()}`);
  }
  const submission = await subResp.json();
  const submissionId = Array.isArray(submission) ? submission[0]?.submission_id : submission.id;

  // Persist with the same envelope shape boldSign uses so downstream UI works
  await db.collection("envelopes").doc(String(submissionId)).set({
    provider: "docuseal",
    documentId: String(submissionId),
    docusealSubmissionId: submissionId,
    docusealTemplateId: templateId,
    clientId: clientId || null,
    realtorId,
    title: title || "Document for Signature",
    signers,
    status: "sent",
    createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { documentId: String(submissionId), submissionId, templateId };
}

exports.sendForSignatureV2 = onCall(
  { region: "us-central1", secrets: [DOCUSEAL_API_KEY, DOCUSEAL_BASE_URL] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
    const { clientId, files, signers, title, message, expiryDays } = request.data || {};
    if (!files || !signers || !signers.length) {
      throw new HttpsError("invalid-argument", "files and signers are required.");
    }
    return sendViaDocuSeal({
      clientId, files, signers, title, message, expiryDays,
      realtorId: request.auth.uid
    });
  }
);

function verifyDocuSealSignature(signatureHeader, rawBody, secret) {
  if (!signatureHeader || !secret) return false;
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

exports.docusealWebhook = onRequest(
  { region: "us-central1", secrets: [DOCUSEAL_API_KEY, DOCUSEAL_WEBHOOK_SECRET, DOCUSEAL_BASE_URL] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const sig = req.headers["x-docuseal-signature"];
    if (!verifyDocuSealSignature(sig, req.rawBody, DOCUSEAL_WEBHOOK_SECRET.value())) {
      console.error("docusealWebhook: signature verification failed");
      return res.status(401).send("Invalid signature");
    }

    const body = req.body || {};
    // DocuSeal emits {event_type, data, timestamp}. Only act on completed.
    if (body.event_type !== "form.completed" && body.event_type !== "submission.completed") {
      return res.status(200).send("OK");
    }

    try {
      const submissionId = body.data?.submission_id || body.data?.id;
      if (!submissionId) {
        console.warn("docusealWebhook: completed event missing submission id");
        return res.status(200).send("OK");
      }

      // Find the originating complianceDoc / envelope record
      const envelopeSnap = await db.collection("envelopes").doc(String(submissionId)).get();
      if (!envelopeSnap.exists) {
        console.warn("docusealWebhook: no envelope found for", submissionId);
        return res.status(200).send("OK");
      }
      const envelope = envelopeSnap.data();
      const clientId = envelope.clientId;
      const realtorId = envelope.realtorId;

      // Idempotency check
      const fileDocId = `${clientId}_signed_docuseal_${submissionId}`;
      const existing = await db.doc(`files/${fileDocId}`).get();
      if (existing.exists) return res.status(200).send("OK");

      // Fetch the signed PDF URL from DocuSeal
      const apiKey = DOCUSEAL_API_KEY.value();
      const base = docusealBaseUrl();
      const subResp = await fetch(`${base}/submissions/${submissionId}`, {
        headers: { "X-Auth-Token": apiKey }
      });
      if (!subResp.ok) {
        console.error("docusealWebhook: failed to load submission", subResp.status);
        return res.status(200).send("OK");
      }
      const sub = await subResp.json();
      const documentsUrl = sub.documents?.[0]?.url || sub.combined_document_url;
      if (!documentsUrl) {
        console.warn("docusealWebhook: no signed PDF URL on submission", submissionId);
        return res.status(200).send("OK");
      }

      const pdfResp = await fetch(documentsUrl);
      if (!pdfResp.ok) {
        console.error("docusealWebhook: PDF download failed", pdfResp.status);
        return res.status(200).send("OK");
      }
      const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());

      const dateStr = new Date().toISOString().split("T")[0];
      const safeTitle = (envelope.title || "document").replace(/\s+/g, "_");
      const fileName = `${safeTitle}_signed_${dateStr}.pdf`;
      const storagePath = `clients/${clientId}/closing-documents/${fileName}`;

      const bucket = getStorage().bucket();
      const file = bucket.file(storagePath);
      await file.save(pdfBuffer, { contentType: "application/pdf" });
      const [signedUrl] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000
      });

      const FieldValue = require("firebase-admin/firestore").FieldValue;
      await db.doc(`files/${fileDocId}`).set({
        clientId,
        realtorId,
        fileName,
        storagePath,
        downloadUrl: signedUrl,
        contentType: "application/pdf",
        source: "docuseal",
        submissionId,
        createdAt: FieldValue.serverTimestamp()
      });
      await db.collection("envelopes").doc(String(submissionId)).update({
        status: "signed",
        signedAt: FieldValue.serverTimestamp(),
        signedFileId: fileDocId
      });

      return res.status(200).send("OK");
    } catch (err) {
      console.error("docusealWebhook error:", err);
      return res.status(200).send("OK");
    }
  }
);

exports.boldSignWebhook = onRequest({ region: "us-central1", secrets: [BOLDSIGN_API_KEY, BOLDSIGN_WEBHOOK_SECRET] }, async (req, res) => {
  // Step 1 -- Method guard: only accept POST
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  // Step 2 -- HMAC verification (WHBK-02)
  const sigHeader = req.headers["x-boldsign-signature"];
  if (!sigHeader || !verifyBoldSignSignature(sigHeader, req.rawBody, BOLDSIGN_WEBHOOK_SECRET.value())) {
    console.error("Webhook signature verification failed");
    return res.status(401).send("Invalid signature");
  }

  // Step 3 -- Event filtering (WHBK-03): only process "Completed" events
  const body = req.body;
  const eventType = body?.event?.eventType;
  if (eventType !== "Completed") {
    return res.status(200).send("OK");
  }

  // Steps 4-8 wrapped in try/catch -- always return 200 to prevent BoldSign retries
  try {
    const documentId = body?.data?.documentId;
    if (!documentId) {
      console.warn("boldSignWebhook: Completed event missing data.documentId");
      return res.status(200).send("OK");
    }

    // Step 4 -- Document lookup (WHBK-04)
    const snapshot = await db.collectionGroup("complianceDocs")
      .where("boldSignDocumentId", "==", documentId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.warn("boldSignWebhook: No matching complianceDocs record for documentId:", documentId);
      return res.status(200).send("OK");
    }

    const docSnap = snapshot.docs[0];
    const templateId = docSnap.id;
    const clientId = docSnap.ref.parent.parent.id;
    const complianceData = docSnap.data();
    const realtorId = complianceData.sentBy;

    // Step 5 -- Idempotency check (WHBK-09)
    const fileDocId = `${clientId}_signed_${templateId}`;
    const existingFile = await db.doc(`files/${fileDocId}`).get();
    if (existingFile.exists) {
      // Duplicate event -- already processed
      return res.status(200).send("OK");
    }

    // Read template name for filename construction
    let templateName = templateId;
    const templateSnap = await db.doc(`documentTemplates/${templateId}`).get();
    if (templateSnap.exists && templateSnap.data().name) {
      templateName = templateSnap.data().name;
    }

    // Step 6 -- Download signed PDF (WHBK-05)
    const apiKey = BOLDSIGN_API_KEY.value();
    if (!apiKey) {
      console.error("boldSignWebhook: BOLDSIGN_API_KEY not configured");
      return res.status(200).send("OK");
    }

    const downloadResponse = await fetch(
      `https://api.boldsign.com/v1/document/download?documentId=${encodeURIComponent(documentId)}`,
      {
        method: "GET",
        headers: { "X-API-KEY": apiKey }
      }
    );

    if (!downloadResponse.ok) {
      const errText = await downloadResponse.text();
      console.error(`boldSignWebhook: PDF download failed (${downloadResponse.status}):`, errText);
      return res.status(200).send("OK");
    }

    const pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());

    // Step 7 -- Upload to Storage (WHBK-06)
    const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const safeTemplateName = templateName.replace(/\s+/g, "_");
    const fileName = `${safeTemplateName}_signed_${dateStr}.pdf`;
    const storagePath = `clients/${clientId}/closing-documents/${fileName}`;

    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, { contentType: "application/pdf" });

    // 7-day signed URL; client can regenerate via getClosingDocUrl on demand.
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    // Step 8 -- Write Firestore records (WHBK-07, WHBK-08)
    const FieldValue = require("firebase-admin/firestore").FieldValue;

    // Resolve (or create) the realtor's "Contracts" folder for this client so signed
    // PDFs surface under a real folder in the UI instead of being orphaned at root.
    let contractsFolderId = null;
    try {
      const existing = await db.collection("folders")
        .where("clientId", "==", clientId)
        .where("realtorId", "==", realtorId)
        .where("name", "==", "Contracts")
        .limit(1)
        .get();
      if (!existing.empty) {
        contractsFolderId = existing.docs[0].id;
      } else {
        const folderRef = await db.collection("folders").add({
          name: "Contracts",
          clientId,
          realtorId,
          isSystem: true,
          createdAt: FieldValue.serverTimestamp()
        });
        contractsFolderId = folderRef.id;
      }
    } catch (err) {
      console.warn("Could not resolve Contracts folder:", err.message);
    }

    await Promise.all([
      // File record with deterministic ID for idempotency
      db.doc(`files/${fileDocId}`).set({
        clientId: clientId,
        realtorId: realtorId,
        fileName: fileName,
        storagePath: storagePath,
        downloadUrl: signedUrl,
        folderId: contractsFolderId,
        fileSize: pdfBuffer.length,
        mimeType: "application/pdf",
        signedSource: true,
        signedAt: FieldValue.serverTimestamp(),
        complianceTemplateId: templateId,
        boldSignDocumentId: documentId,
        uploadedAt: FieldValue.serverTimestamp()
      }),
      // Status update on complianceDocs record
      db.doc(`clients/${clientId}/complianceDocs/${templateId}`).update({
        status: "signed",
        signedAt: FieldValue.serverTimestamp()
      })
    ]);

    // Step 8b -- Auto-complete matching checklist items (CHKL-06)
    try {
      const checklistQuery = await db.collection(`clients/${clientId}/closingChecklist`)
        .where("linkedTemplateId", "==", templateId)
        .where("completed", "==", false)
        .get();

      if (!checklistQuery.empty) {
        const checklistBatch = db.batch();
        checklistQuery.docs.forEach(checkDoc => {
          checklistBatch.update(checkDoc.ref, {
            completed: true,
            autoCompleted: true,
            autoCompletedAt: FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp()
          });
        });
        await checklistBatch.commit();
        console.log(`boldSignWebhook: Auto-completed ${checklistQuery.docs.length} checklist item(s) for template ${templateId}`);
      }
    } catch (checklistErr) {
      // Non-fatal: log but don't fail the webhook for checklist errors
      console.error("boldSignWebhook: Checklist auto-complete error:", checklistErr);
    }

    console.log(`boldSignWebhook: Processed signed document for client ${clientId}, template ${templateId}`);

    // Step 9 -- Respond (WHBK-10)
    return res.status(200).send("OK");

  } catch (error) {
    console.error("boldSignWebhook error:", error);
    return res.status(200).send("OK");
  }
});

/* ------------------------------------------------------------------ */
/*  askAssistant                                                       */
/*                                                                     */
/*  AI assistant Cloud Function. Accepts a question with optional      */
/*  context type (general, client_detail, checklist_checkin) and       */
/*  conversation history. Returns an AI-generated response.            */
/* ------------------------------------------------------------------ */

// Tools exposed to Sage on client_detail context. The model emits tool_use blocks
// when it wants to suggest an action; the client renders these as approve-to-execute
// buttons (replaces the regex action-detection that used to live in chatbot.js).
const SAGE_CLIENT_DETAIL_TOOLS = [
  {
    name: "draft_email",
    description: "Compose an email for the realtor to send to this client. Use when the user asks you to write, draft, or send an email.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body. Address the client by name. Include a signoff with the realtor's name placeholder as {{agent_name}} if unknown." }
      },
      required: ["subject", "body"]
    }
  },
  {
    name: "create_followup",
    description: "Create a follow-up reminder task for this client. Use when the user asks to remember to check in, follow up, or set a reminder.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the follow-up task, under 80 chars" },
        days_from_now: { type: "integer", description: "Number of days from today to set the due date" },
        notes: { type: "string", description: "Optional context for what to do at follow-up time" }
      },
      required: ["title", "days_from_now"]
    }
  },
  {
    name: "schedule_showing",
    description: "Schedule a property showing for this client. Use when the user asks to schedule, book, or arrange a showing.",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Property address, if mentioned" },
        date: { type: "string", description: "Date in YYYY-MM-DD format if mentioned" },
        time: { type: "string", description: "Time in HH:MM 24h format if mentioned" },
        notes: { type: "string", description: "Optional notes about the showing" }
      }
    }
  },
  {
    name: "log_call",
    description: "Log a phone call activity for this client. Use when the user asks to record, log, or note a call they had.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Brief summary of what was discussed on the call" },
        duration_minutes: { type: "integer", description: "Call duration in minutes if known" }
      },
      required: ["summary"]
    }
  },
  {
    name: "save_note",
    description: "Save a note to this client's record. Use when the user asks to save a summary, save a note, or capture observations.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the note" },
        body: { type: "string", description: "Full note body" }
      },
      required: ["title", "body"]
    }
  }
];

exports.askAssistant = onCall({ region: "us-central1", secrets: [ANTHROPIC_API_KEY, VOYAGE_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { question, context, history, clientId, contextData } = request.data || {};
  if (!question) {
    throw new HttpsError("invalid-argument", "question is required.");
  }

  await enforceRateLimit(request.auth.uid, "askAssistant", 100);

  const anthropicKey = ANTHROPIC_API_KEY.value();
  if (!anthropicKey) {
    throw new HttpsError("internal", "Anthropic API key is not configured.");
  }

  let systemPrompt = "You are a helpful real estate assistant for GreenDoor CRM.";

  // Build context-specific system prompt
  if (context === "checklist_checkin" && contextData) {
    const cd = contextData;
    systemPrompt = `You are a real estate transaction assistant for GreenDoor CRM. You are helping a realtor check in on their closing checklist.

CLIENT: ${cd.clientName}
TRANSACTION TYPE: ${cd.transactionType}
CLOSING DATE: ${cd.closingDate}
LISTING ADDRESS: ${cd.listingAddress}
TODAY: ${cd.todayDate}

PROGRESS: ${cd.progress.completed}/${cd.progress.total} items completed (${cd.progress.percentage}%)

COMPLETED ITEMS:
${cd.completedItems.map(i => `- [x] ${i.task} (${i.category})${i.autoCompleted ? ' [auto-completed via e-signature]' : ''}`).join('\n')}

OUTSTANDING ITEMS:
${cd.outstandingItems.map(i => `- [ ] ${i.task} (${i.category})${i.deadline ? ` — Due: ${i.deadline}` : ''}${i.overdue ? ' OVERDUE' : ''}`).join('\n')}

${cd.overdueCount > 0 ? `\n${cd.overdueCount} OVERDUE ITEM(S) require immediate attention.\n` : ''}

INSTRUCTIONS:
1. Start with a brief progress summary (percentage done, tone: encouraging if ahead, urgent if behind)
2. Highlight any overdue items with specific attention
3. List what's still outstanding, grouped by urgency
4. Suggest the top 2-3 priority next actions the realtor should take
5. Keep your response concise and actionable — this is a quick check-in, not a detailed report
6. If the realtor asks follow-up questions, use this context to answer them accurately`;
  } else if (context === "dashboard" && contextData) {
    const cd = contextData;
    const staleList = (cd.staleClients || []).length > 0
      ? cd.staleClients.map(c => `- ${c.name}${c.daysSince != null ? ` (${c.daysSince} days)` : ' (never contacted)'}`).join('\n')
      : '- None — all clients contacted recently.';
    const showingsList = (cd.todayShowings || []).length > 0
      ? cd.todayShowings.map(s => `- ${s.time} at ${s.address}`).join('\n')
      : '- No showings today.';
    systemPrompt = `You are a real estate assistant generating a daily briefing for GreenDoor CRM.

PORTFOLIO STATS:
- Total clients: ${cd.totalClients || 0}
- Active buyers: ${cd.activeBuyers || 0}
- Active sellers: ${cd.activeSellers || 0}
- Under contract: ${cd.underContract || 0}

CLIENTS NOT CONTACTED IN 14+ DAYS:
${staleList}

TODAY'S SHOWINGS:
${showingsList}

INSTRUCTIONS:
Give exactly 3 bullet points, one line each. Use the real data above.
1) Clients needing follow-up (name them if any)
2) Today's showings summary
3) One specific priority action based on the data
No headers, no intros, no sign-offs. Just the 3 bullets.`;
  } else if (context === "client_detail" && clientId) {
    // Read client data for generic client-detail context
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (clientSnap.exists) {
      const c = clientSnap.data();
      systemPrompt = `You are a real estate assistant. The realtor is viewing client: ${c.fullName || 'Unknown'}. Status: ${c.status || 'unknown'}. Transaction type: ${c.transactionType || 'not set'}. Help with questions about this client.

When the realtor asks you to draft an email, create a follow-up, schedule a showing, log a call, or save a note, use the matching tool. Always also reply with a brief conversational message so the realtor sees what you proposed.`;

      // RAG: retrieve semantically-relevant past activities for this client using
      // Voyage embeddings + Firestore vector search. Surfaces context the model
      // would otherwise miss (older emails, call notes, prior showings).
      const ragContext = await retrieveClientContext(clientId, request.auth.uid, question);
      if (ragContext) {
        systemPrompt += `\n\nRELEVANT PAST ACTIVITY (retrieved by semantic search; may be incomplete):\n${ragContext}`;
      }
    }
  }

  // Build messages array
  const messages = [];
  if (history && Array.isArray(history)) {
    const recentHistory = history.slice(-6);
    messages.push(...recentHistory);
  }
  messages.push({ role: "user", content: question });

  // Build request body. Tools are scoped to client_detail to avoid noise on
  // dashboard/checklist briefings. Tool definitions are cached separately so
  // the ~600-token block is billed once per 5min window.
  const apiBody = {
    model: "claude-sonnet-4-6",
    system: [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
    ],
    messages: messages,
    max_tokens: 800
  };
  if (context === "client_detail") {
    apiBody.tools = SAGE_CLIENT_DETAIL_TOOLS.map((t, i, arr) =>
      i === arr.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
    );
  }

  // Call Anthropic Claude
  // System prompt uses cache_control so the stable portion is billed at ~10% on cache hits.
  // No-op when systemPrompt is under the 1024-token cache threshold; kicks in automatically
  // once tool definitions and retrieved client context are added to the block.
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(apiBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error:", errText);
    throw new HttpsError("internal", "AI service temporarily unavailable. Please try again.");
  }

  const data = await response.json();
  // Separate text blocks (for display) from tool_use blocks (for action buttons).
  const blocks = Array.isArray(data.content) ? data.content : [];
  const textParts = [];
  const actions = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
    } else if (block.type === "tool_use" && block.name && block.input) {
      actions.push({ name: block.name, input: block.input, id: block.id });
    }
  }
  const aiResponse = textParts.join("\n\n").trim() ||
    (actions.length > 0 ? "Here's what I'd suggest:" : "I wasn't able to generate a response. Please try again.");

  return { response: aiResponse, actions };
});

/* ------------------------------------------------------------------ */
/*  RAG helper — embeds the query with Voyage, finds nearest          */
/*  activity documents for this client using Firestore vector search. */
/*  Returns a formatted context string, or null on any failure        */
/*  (RAG is additive — never block the chat response).                */
/* ------------------------------------------------------------------ */
async function retrieveClientContext(clientId, realtorId, question) {
  try {
    const voyageKey = VOYAGE_API_KEY.value();
    if (!isLiveSecret(voyageKey) || !question || question.length < 4) return null;

    const embedResp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${voyageKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "voyage-3-lite",
        input: question.slice(0, 2000),
        input_type: "query",
        output_dimension: 512
      })
    });
    if (!embedResp.ok) return null;
    const embedData = await embedResp.json();
    const queryVec = embedData.data?.[0]?.embedding;
    if (!Array.isArray(queryVec)) return null;

    const snap = await db.collection("activities")
      .where("clientId", "==", clientId)
      .where("realtorId", "==", realtorId)
      .findNearest({
        vectorField: "embedding",
        queryVector: queryVec,
        limit: 5,
        distanceMeasure: "COSINE"
      })
      .get();

    if (snap.empty) return null;

    const lines = [];
    snap.forEach(doc => {
      const a = doc.data();
      const when = a.timestamp?.toDate ? a.timestamp.toDate().toISOString().slice(0, 10) : "";
      const type = a.type || "note";
      const subj = a.subject || "";
      const body = (a.body || "").slice(0, 400);
      lines.push(`[${when} ${type}] ${subj}\n${body}`.trim());
    });
    return lines.join("\n\n");
  } catch (err) {
    console.warn("retrieveClientContext failed:", err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  embedActivityOnCreate                                              */
/*                                                                     */
/*  Firestore trigger: every new activity gets a 512-dim embedding     */
/*  via Voyage so it can be retrieved by Sage's RAG layer. Skips       */
/*  silently if VOYAGE_API_KEY is unset, so RAG is opt-in via secret.  */
/* ------------------------------------------------------------------ */
exports.embedActivityOnCreate = onDocumentCreated(
  { document: "activities/{actId}", region: "us-central1", secrets: [VOYAGE_API_KEY] },
  async (event) => {
    const voyageKey = VOYAGE_API_KEY.value();
    if (!isLiveSecret(voyageKey)) return;

    const snap = event.data;
    if (!snap) return;
    const a = snap.data() || {};

    const text = [a.subject, a.body].filter(Boolean).join("\n").trim();
    if (!text || text.length < 4) return;

    try {
      const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${voyageKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "voyage-3-lite",
          input: text.slice(0, 8000),
          input_type: "document",
          output_dimension: 512
        })
      });
      if (!resp.ok) {
        console.warn("embedActivityOnCreate: Voyage returned", resp.status);
        return;
      }
      const data = await resp.json();
      const vec = data.data?.[0]?.embedding;
      if (!Array.isArray(vec)) return;

      const { FieldValue } = require("firebase-admin/firestore");
      await snap.ref.update({ embedding: FieldValue.vector(vec) });
    } catch (err) {
      console.warn("embedActivityOnCreate failed:", err.message);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  ShowingTime iCal Sync                                              */
/*                                                                     */
/*  syncFeedForUser: shared sync logic (internal helper)               */
/*  syncShowingTime: callable "Sync Now" handler                       */
/*  scheduledShowingTimeSync: 30-minute cron for all users             */
/* ------------------------------------------------------------------ */

/**
 * syncFeedForUser (internal helper)
 *
 * Fetches and parses a ShowingTime iCal feed for a single user,
 * upserts VEVENT data into the showings collection with deterministic
 * IDs, and deletes showings that are no longer in the feed.
 *
 * @param {string} realtorId - The user's UID
 * @param {string} feedUrl - The iCal/webcal feed URL
 * @returns {{ synced: number, removed: number }}
 */
async function syncFeedForUser(realtorId, feedUrl) {
  const admin = require("firebase-admin");
  const ical = require("node-ical");
  const FieldValue = require("firebase-admin/firestore").FieldValue;

  // Normalize webcal:// to https://
  const url = feedUrl.replace(/^webcal:\/\//i, "https://");

  // Fetch and parse the iCal feed
  let data;
  try {
    data = await ical.async.fromURL(url);
  } catch (err) {
    // Network/parse error: save error but do NOT delete existing showings
    await db.doc(`users/${realtorId}`).update({
      showingTimeSyncError: err.message || "Failed to fetch feed",
    });
    throw err;
  }

  // Collect valid events from feed (exclude CANCELLED)
  const feedEvents = {};
  for (const [key, event] of Object.entries(data)) {
    if (event.type !== "VEVENT") continue;
    if ((event.status || "").toUpperCase() === "CANCELLED") continue;
    const sanitizedUid = sanitizeIcalUid(event.uid);
    feedEvents[sanitizedUid] = event;
  }

  // Get existing ST showings for this user
  const existingSnap = await db.collection("showings")
    .where("realtorId", "==", realtorId)
    .where("source", "==", "showingtime")
    .get();

  // Build operations list, then chunk into batches of 450
  const operations = [];
  let upsertCount = 0;
  let deleteCount = 0;

  // Upsert: events in feed
  for (const [sanitizedUid, event] of Object.entries(feedEvents)) {
    const docId = `st_${realtorId}_${sanitizedUid}`;
    const docRef = db.doc(`showings/${docId}`);

    operations.push({
      type: "set",
      ref: docRef,
      data: {
        realtorId,
        source: "showingtime",
        icalUid: event.uid,
        address: event.summary || event.location || "ShowingTime Showing",
        showingDate: event.start ? admin.firestore.Timestamp.fromDate(new Date(event.start)) : null,
        endDate: event.end ? admin.firestore.Timestamp.fromDate(new Date(event.end)) : null,
        location: event.location || "",
        description: event.description || "",
        status: "scheduled",
        icalSequence: event.sequence || 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      options: { merge: true },
    });
    upsertCount++;
  }

  // Delete: existing docs not in feed
  for (const doc of existingSnap.docs) {
    const existingUid = sanitizeIcalUid(doc.data().icalUid);
    if (!feedEvents[existingUid]) {
      operations.push({ type: "delete", ref: doc.ref });
      deleteCount++;
    }
  }

  // Commit in chunks of 450 to stay under Firestore batch limit of 500
  const CHUNK_SIZE = 450;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      if (op.type === "set") {
        batch.set(op.ref, op.data, op.options);
      } else if (op.type === "delete") {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
  }

  // Update user sync metadata
  await db.doc(`users/${realtorId}`).update({
    showingTimeLastSyncedAt: FieldValue.serverTimestamp(),
    showingTimeSyncError: null,
    showingTimeSyncCount: upsertCount,
  });

  return { synced: upsertCount, removed: deleteCount };
}

/**
 * syncShowingTime (callable)
 *
 * "Sync Now" button handler. Reads the user's feed URL from their
 * profile, enforces a 15-minute rate limit, and calls syncFeedForUser.
 */
exports.syncShowingTime = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const uid = request.auth.uid;

  // Read user doc for feed URL and last sync time
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const userData = userSnap.data();
  const feedUrl = userData.showingTimeFeedUrl;

  if (!feedUrl) {
    throw new HttpsError("failed-precondition", "No ShowingTime feed URL configured. Add one in Settings > Integrations.");
  }

  // Rate limit: 15 minutes between syncs
  const lastSync = userData.showingTimeLastSyncedAt?.toDate();
  if (lastSync) {
    const elapsedMs = Date.now() - lastSync.getTime();
    const fifteenMin = 15 * 60 * 1000;
    if (elapsedMs < fifteenMin) {
      const minutesAgo = Math.floor(elapsedMs / 60000);
      throw new HttpsError("resource-exhausted", `Please wait at least 15 minutes between syncs. Last synced: ${minutesAgo} minute(s) ago.`);
    }
  }

  try {
    const result = await syncFeedForUser(uid, feedUrl);
    return result;
  } catch (err) {
    console.error(`syncShowingTime error for user ${uid}:`, err.message);
    throw new HttpsError("internal", `Sync failed: ${err.message}`);
  }
});

/**
 * scheduledShowingTimeSync (scheduled)
 *
 * Runs every 30 minutes. Iterates all users with a feed URL configured,
 * skips users synced within the last 15 minutes, and calls syncFeedForUser.
 */
exports.scheduledShowingTimeSync = onSchedule(
  { schedule: "every 30 minutes", region: "us-central1", timeoutSeconds: 300 },
  async (event) => {
    const usersSnap = await db.collection("users")
      .where("showingTimeFeedUrl", "!=", null)
      .get();

    let totalSynced = 0;
    let totalErrors = 0;
    let processed = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();

      // Rate limit: skip if synced within last 15 minutes
      const lastSync = userData.showingTimeLastSyncedAt?.toDate();
      if (lastSync && (Date.now() - lastSync.getTime()) < 15 * 60 * 1000) {
        continue;
      }

      try {
        const result = await syncFeedForUser(userDoc.id, userData.showingTimeFeedUrl);
        totalSynced += result.synced;
        processed++;
      } catch (err) {
        console.error(`Scheduled sync failed for user ${userDoc.id}:`, err.message);
        totalErrors++;
      }
    }

    console.log(`scheduledShowingTimeSync complete: ${processed} users synced, ${totalSynced} total showings, ${totalErrors} errors`);
  }
);

/* ================================================================
   HELPER: verify caller is admin
   ================================================================ */
async function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const userSnap = await db.doc(`users/${request.auth.uid}`).get();
  if (!userSnap.exists || userSnap.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return userSnap;
}

/* ================================================================
   HELPER: send email
   Prefers Resend (cheaper, better deliverability). Falls back to
   SendGrid if RESEND_API_KEY is unset so the migration can be staged
   safely.

   Resend authenticates by domain, not per-sender, so the From address
   is always the system domain. The agent's name lands as the display
   name ("Joe Smith via GreenDoor") and Reply-To routes replies back
   to them.
   ================================================================ */
const SYSTEM_FROM_EMAIL = "greendoor@stoekmedia.com";
const SYSTEM_FROM_NAME = "GreenDoor CRM";

async function sendViaEmail({ to, toName, subject, body, fromEmail, fromName, replyTo }) {
  // Choose Reply-To: prefer explicit replyTo, else the agent's email if it
  // was passed as fromEmail (the old per-realtor sender pattern).
  const effectiveReplyTo = replyTo ||
    (fromEmail && fromEmail !== SYSTEM_FROM_EMAIL ? fromEmail : null);

  // Build a display name that hints at the agent without spoofing them.
  const displayName = fromName && fromName !== SYSTEM_FROM_NAME
    ? `${fromName} via ${SYSTEM_FROM_NAME}`
    : SYSTEM_FROM_NAME;

  const resendKey = RESEND_API_KEY.value();
  if (isLiveSecret(resendKey)) {
    const payload = {
      from: `${displayName} <${SYSTEM_FROM_EMAIL}>`,
      to: toName ? [`${toName} <${to}>`] : [to],
      subject,
      html: body
    };
    if (effectiveReplyTo) payload.reply_to = effectiveReplyTo;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new HttpsError("internal", `Resend error ${resp.status}: ${text}`);
    }
    return;
  }

  // Fallback: legacy SendGrid path.
  const apiKey = SENDGRID_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "Neither RESEND_API_KEY nor SENDGRID_API_KEY is configured.");
  }

  const msg = {
    personalizations: [{ to: [{ email: to, name: toName || undefined }] }],
    from: { email: fromEmail || SYSTEM_FROM_EMAIL, name: fromName || SYSTEM_FROM_NAME },
    subject,
    content: [{ type: "text/html", value: body }]
  };
  if (effectiveReplyTo) msg.reply_to = { email: effectiveReplyTo };

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(msg)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new HttpsError("internal", `SendGrid error ${resp.status}: ${text}`);
  }
}

/* ================================================================
   GMAIL OAUTH — send on behalf of an authenticated agent.

   When an agent connects their Google account, their refresh token
   lives in `users/{uid}.gmailOAuth`. We use it to mint short-lived
   access tokens and send via Gmail API users.messages.send, so the
   message goes through the agent's actual mailbox and clients see
   "From: their.real.email@example.com" with proper DKIM alignment.

   Falls back to sendViaEmail (Resend "via" pattern) if the user
   hasn't connected OAuth, or if a Gmail send fails for any reason.
   ================================================================ */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

async function refreshGmailAccessToken(refreshToken) {
  const clientId = GOOGLE_OAUTH_CLIENT_ID.value();
  const clientSecret = GOOGLE_OAUTH_CLIENT_SECRET.value();
  if (!isLiveSecret(clientId) || !isLiveSecret(clientSecret)) {
    throw new HttpsError("failed-precondition", "Google OAuth client credentials not configured.");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token refresh failed (${resp.status}): ${text}`);
  }
  return resp.json(); // { access_token, expires_in, scope, token_type }
}

async function getValidGmailAccessToken(uid) {
  // Sensitive tokens live in oauthTokens/{uid} (Cloud Function only — Firestore
  // rules deny client reads). Public bits (email, connectedAt) live on the user
  // doc so the frontend can render connection state.
  const tokenRef = db.doc(`oauthTokens/${uid}`);
  const userRef = db.doc(`users/${uid}`);
  const [tokenSnap, userSnap] = await Promise.all([tokenRef.get(), userRef.get()]);
  const tokens = tokenSnap.exists ? (tokenSnap.data().gmail || null) : null;
  const publicBits = userSnap.exists ? (userSnap.data().gmailOAuth || null) : null;
  if (!tokens || !tokens.refreshToken || !publicBits?.email) return null;

  const now = Date.now();
  const expiresAt = tokens.expiresAt?.toMillis ? tokens.expiresAt.toMillis() : (tokens.expiresAt || 0);
  // Refresh ~2 min before expiry to avoid races.
  if (tokens.accessToken && expiresAt > now + 120000) {
    return { accessToken: tokens.accessToken, email: publicBits.email };
  }

  const fresh = await refreshGmailAccessToken(tokens.refreshToken);
  const newExpiresAt = new Date(now + (fresh.expires_in - 30) * 1000);
  await tokenRef.update({
    "gmail.accessToken": fresh.access_token,
    "gmail.expiresAt": newExpiresAt,
    "gmail.lastRefreshedAt": new Date()
  });
  return { accessToken: fresh.access_token, email: publicBits.email };
}

function buildRfc2822({ fromName, fromEmail, to, toName, subject, body, replyTo }) {
  const fromHeader = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const toHeader = toName ? `${toName} <${to}>` : to;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"'
  ];
  if (replyTo && replyTo !== fromEmail) headers.push(`Reply-To: ${replyTo}`);
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

async function sendViaGmail({ uid, to, toName, subject, body, fromName, replyTo }) {
  const tok = await getValidGmailAccessToken(uid);
  if (!tok) return false; // not connected — caller falls back

  const raw = buildRfc2822({
    fromName,
    fromEmail: tok.email,
    to,
    toName,
    subject,
    body,
    replyTo: replyTo && replyTo !== tok.email ? replyTo : null
  });
  // Gmail API wants base64url-encoded raw message.
  const encoded = Buffer.from(raw, "utf-8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const resp = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tok.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: encoded })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gmail API error ${resp.status}: ${text}`);
  }
  await db.doc(`users/${uid}`).update({ "gmailOAuth.lastUsedAt": new Date() });
  return true;
}

/* ----- Callables: connect / disconnect Gmail ----- */

exports.getGoogleOAuthConfig = onCall(
  { region: "us-central1", secrets: [GOOGLE_OAUTH_CLIENT_ID] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const clientId = GOOGLE_OAUTH_CLIENT_ID.value();
    if (!isLiveSecret(clientId)) {
      return { configured: false };
    }
    // client_id is a public identifier (OAuth flow exposes it to the browser anyway).
    return { configured: true, clientId };
  }
);

exports.exchangeGoogleAuthCode = onCall(
  { region: "us-central1", secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const { code, redirectUri } = request.data || {};
    if (!code || !redirectUri) {
      throw new HttpsError("invalid-argument", "code and redirectUri are required.");
    }
    const clientId = GOOGLE_OAUTH_CLIENT_ID.value();
    const clientSecret = GOOGLE_OAUTH_CLIENT_SECRET.value();
    if (!isLiveSecret(clientId) || !isLiveSecret(clientSecret)) {
      throw new HttpsError("failed-precondition", "Google OAuth client credentials not configured.");
    }

    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      throw new HttpsError("internal", `Google token exchange failed (${tokenResp.status}): ${text}`);
    }
    const tokens = await tokenResp.json();
    // tokens: { access_token, expires_in, refresh_token, scope, token_type, id_token }

    if (!tokens.refresh_token) {
      // Happens if the user previously consented and we didn't force prompt=consent.
      throw new HttpsError("failed-precondition",
        "No refresh token returned. Make sure the consent flow uses prompt=consent and access_type=offline.");
    }

    // Pull verified email from the id_token (no extra round trip).
    let email = null;
    try {
      const idPayload = tokens.id_token?.split(".")[1];
      if (idPayload) {
        const padded = idPayload + "=".repeat((4 - (idPayload.length % 4)) % 4);
        const decoded = JSON.parse(Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"));
        if (decoded.email_verified) email = decoded.email;
      }
    } catch (e) {
      console.warn("exchangeGoogleAuthCode: id_token decode failed —", e.message);
    }
    if (!email) {
      // Fallback to tokeninfo endpoint
      const infoResp = await fetch(`${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(tokens.access_token)}`);
      if (infoResp.ok) {
        const info = await infoResp.json();
        email = info.email || null;
      }
    }
    if (!email) {
      throw new HttpsError("internal", "Could not determine the user's Google email.");
    }

    const now = Date.now();
    const expiresAt = new Date(now + (tokens.expires_in - 30) * 1000);
    const uid = request.auth.uid;
    // Public bits (frontend-readable) on the user doc.
    // Sensitive tokens (CF-only via Firestore rules) in oauthTokens/{uid}.
    await Promise.all([
      db.doc(`users/${uid}`).set({
        gmailOAuth: {
          email,
          scope: tokens.scope || "",
          connectedAt: new Date(),
          lastUsedAt: null
        }
      }, { merge: true }),
      db.doc(`oauthTokens/${uid}`).set({
        gmail: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
          lastRefreshedAt: new Date()
        }
      }, { merge: true })
    ]);

    return { connected: true, email };
  }
);

exports.disconnectGmail = onCall(
  { region: "us-central1", secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const uid = request.auth.uid;
    const tokenRef = db.doc(`oauthTokens/${uid}`);
    const userRef = db.doc(`users/${uid}`);
    const tokenSnap = await tokenRef.get();
    const tokens = tokenSnap.exists ? (tokenSnap.data().gmail || null) : null;
    if (!tokens || !tokens.refreshToken) {
      return { disconnected: true, alreadyDisconnected: true };
    }

    // Best-effort revoke; don't fail the disconnect if Google is grumpy.
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(tokens.refreshToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
    } catch (e) {
      console.warn("disconnectGmail: revoke call failed —", e.message);
    }

    const { FieldValue } = require("firebase-admin/firestore");
    await Promise.all([
      tokenRef.update({ gmail: FieldValue.delete() }),
      userRef.update({ gmailOAuth: FieldValue.delete() })
    ]);
    return { disconnected: true };
  }
);

/* ================================================================
   sendEmail
   ================================================================ */
exports.sendEmail = onCall(
  { region: "us-central1", secrets: [SENDGRID_API_KEY, RESEND_API_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] },
  async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { to, toName, subject, body, clientId } = request.data || {};
  if (!to || !subject || !body) {
    throw new HttpsError("invalid-argument", "to, subject, and body are required.");
  }

  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.exists ? userSnap.data() : {};

  const fromName = userData.fullName || "GreenDoor CRM";
  const replyTo = userData.email || null;

  // Prefer Gmail OAuth (true From: agent's address, DMARC-aligned).
  // Fall back to sendViaEmail (Resend "via" pattern → SendGrid).
  let provider = "resend";
  let sentViaGmail = false;
  try {
    sentViaGmail = await sendViaGmail({ uid, to, toName, subject, body, fromName, replyTo });
  } catch (err) {
    console.warn(`sendEmail: Gmail send failed for uid=${uid}, falling back to sendViaEmail —`, err.message);
  }
  if (sentViaGmail) {
    provider = "gmail";
  } else {
    await sendViaEmail({ to, toName, subject, body, fromEmail: null, fromName, replyTo });
  }

  // Log activity
  await db.collection("activities").add({
    type: "email",
    subject,
    body,
    clientId: clientId || null,
    realtorId: uid,
    provider,
    timestamp: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { success: true, provider };
});

/* ================================================================
   sendForSignature
   ================================================================ */
exports.sendForSignature = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { clientId, files, signers, title, message, expiryDays } = request.data || {};
  if (!files || !signers || !signers.length) {
    throw new HttpsError("invalid-argument", "files and signers are required.");
  }

  const uid = request.auth.uid;
  const apiKey = BOLDSIGN_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "BOLDSIGN_API_KEY is not configured.");
  }

  // Download file buffers from Firebase Storage URLs
  const fileBuffers = [];
  for (const file of files) {
    const resp = await fetch(file.downloadUrl);
    if (!resp.ok) throw new HttpsError("internal", `Failed to download file: ${file.fileName}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    fileBuffers.push({ ...file, buffer });
  }

  // Build BoldSign API request
  const FormData = (await import("node:buffer")).Buffer ? null : null;
  // Use multipart form for BoldSign
  const boundary = `----BoldSign${Date.now()}`;
  const signersList = signers.map((s, i) => ({
    name: s.name,
    emailAddress: s.email,
    signerOrder: i + 1,
    signerType: "Signer"
  }));

  const createResp = await fetch("https://api.boldsign.com/v1/document/send", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: title || "Document for Signature",
      message: message || "",
      signers: signersList,
      expiryDays: expiryDays || 30,
      files: fileBuffers.map(f => ({
        fileName: f.fileName,
        contentType: f.mimeType || "application/pdf",
        content: f.buffer.toString("base64")
      }))
    })
  });

  if (!createResp.ok) {
    const text = await createResp.text();
    throw new HttpsError("internal", `BoldSign error ${createResp.status}: ${text}`);
  }

  const result = await createResp.json();
  const documentId = result.documentId;

  // Save envelope to Firestore
  await db.collection("envelopes").doc(documentId).set({
    documentId,
    clientId: clientId || null,
    realtorId: uid,
    title: title || "Document for Signature",
    signers: signers,
    status: "sent",
    createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { documentId };
});

/* ================================================================
   checkSignatureStatus
   ================================================================ */
exports.checkSignatureStatus = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { documentId } = request.data || {};
  if (!documentId) {
    throw new HttpsError("invalid-argument", "documentId is required.");
  }

  const apiKey = BOLDSIGN_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "BOLDSIGN_API_KEY is not configured.");
  }

  const resp = await fetch(`https://api.boldsign.com/v1/document/properties?documentId=${documentId}`, {
    headers: { "X-API-KEY": apiKey }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new HttpsError("internal", `BoldSign error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const status = (data.status || "unknown").toLowerCase();

  // Update Firestore envelope
  await db.collection("envelopes").doc(documentId).update({
    status,
    lastChecked: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  }).catch(() => {});

  return { status };
});

/* ================================================================
   createEmbeddedSignatureRequest
   ================================================================ */
exports.createEmbeddedSignatureRequest = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { clientId, files, signers, title, message, expiryDays } = request.data || {};
  if (!files || !signers || !signers.length) {
    throw new HttpsError("invalid-argument", "files and signers are required.");
  }

  const uid = request.auth.uid;
  const apiKey = BOLDSIGN_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "BOLDSIGN_API_KEY is not configured.");
  }

  // Download files from Storage URLs
  const fileBuffers = [];
  for (const file of files) {
    const resp = await fetch(file.downloadUrl);
    if (!resp.ok) throw new HttpsError("internal", `Failed to download file: ${file.fileName}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    fileBuffers.push({ ...file, buffer });
  }

  const signersList = signers.map((s, i) => ({
    name: s.name,
    emailAddress: s.email,
    signerOrder: i + 1,
    signerType: "Signer"
  }));

  // Create embedded request
  const createResp = await fetch("https://api.boldsign.com/v1/document/createEmbeddedRequestUrl", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: title || "Document for Signature",
      message: message || "",
      signers: signersList,
      expiryDays: expiryDays || 30,
      files: fileBuffers.map(f => ({
        fileName: f.fileName,
        contentType: f.mimeType || "application/pdf",
        content: f.buffer.toString("base64")
      })),
      redirectUrl: null,
      showToolbar: true
    })
  });

  if (!createResp.ok) {
    const text = await createResp.text();
    throw new HttpsError("internal", `BoldSign error ${createResp.status}: ${text}`);
  }

  const result = await createResp.json();
  const documentId = result.documentId;
  const sendUrl = result.sendUrl;

  // Save envelope
  await db.collection("envelopes").doc(documentId).set({
    documentId,
    clientId: clientId || null,
    realtorId: uid,
    title: title || "Document for Signature",
    signers: signers,
    status: "draft",
    embedded: true,
    createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { sendUrl, documentId };
});

/* ================================================================
   shareDocument
   ================================================================ */
exports.shareDocument = onCall(
  { region: "us-central1", secrets: [SENDGRID_API_KEY, RESEND_API_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] },
  async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { clientId, files, to, cc, subject, message } = request.data || {};
  if (!to || !files || !files.length) {
    throw new HttpsError("invalid-argument", "to and files are required.");
  }

  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.exists ? userSnap.data() : {};

  const fromName = userData.fullName || "GreenDoor CRM";
  const replyTo = userData.email || null;

  // Build HTML body with file links
  const fileLinks = files.map(f =>
    `<p><a href="${f.downloadUrl}">${f.fileName}</a></p>`
  ).join("");

  const htmlBody = `
    <p>${(message || "").replace(/\n/g, "<br>")}</p>
    <hr>
    <p><strong>Shared documents:</strong></p>
    ${fileLinks}
  `;

  const finalSubject = subject || "Documents shared with you";

  let provider = "resend";
  let sentViaGmail = false;
  try {
    sentViaGmail = await sendViaGmail({
      uid, to, toName: "", subject: finalSubject, body: htmlBody, fromName, replyTo
    });
  } catch (err) {
    console.warn(`shareDocument: Gmail send failed for uid=${uid}, falling back —`, err.message);
  }
  if (sentViaGmail) {
    provider = "gmail";
  } else {
    await sendViaEmail({
      to,
      toName: "",
      subject: finalSubject,
      body: htmlBody,
      fromEmail: null,
      fromName,
      replyTo
    });
  }

  // Log activity
  await db.collection("activities").add({
    type: "file_share",
    subject: finalSubject,
    clientId: clientId || null,
    realtorId: uid,
    fileCount: files.length,
    provider,
    timestamp: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { success: true, provider };
});

/* ================================================================
   cleanupClientStorage — server-side delete of clients/{clientId}/ subtree
   after a client has been deleted. The new storage.rules deny client writes
   to that path, so the client-side deleteClient flow calls this to finish
   the job (admin SDK bypasses rules).
   ================================================================ */
exports.cleanupClientStorage = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { clientId, expectedRealtorId } = request.data || {};
  if (!clientId) throw new HttpsError("invalid-argument", "clientId is required.");

  // The caller asserts they used to own this client. We can't verify against a
  // deleted doc, so we trust the request only if the caller's uid matches the
  // expectedRealtorId they pass in. The caller is the deleter; this is the
  // best we can do once the client doc is gone.
  if (expectedRealtorId && expectedRealtorId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Realtor mismatch.");
  }

  const bucket = getStorage().bucket();
  try {
    await bucket.deleteFiles({ prefix: `clients/${clientId}/` });
  } catch (err) {
    console.error("cleanupClientStorage failed:", err);
    throw new HttpsError("internal", "Cleanup failed.");
  }

  return { success: true };
});

/* ================================================================
   getFileSignedUrl — mint fresh short-lived URL for a file record.
   Used for closing-doc downloads so we can keep stored URLs short.
   ================================================================ */
exports.getFileSignedUrl = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { fileId } = request.data || {};
  if (!fileId) throw new HttpsError("invalid-argument", "fileId is required.");

  const snap = await db.doc(`files/${fileId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "File not found.");
  const data = snap.data();
  if (data.realtorId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "You can only access your own files.");
  }
  if (!data.storagePath) throw new HttpsError("failed-precondition", "File has no storage path.");

  const [url] = await getStorage().bucket().file(data.storagePath).getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000 // 15 minutes
  });
  return { url };
});

/* ================================================================
   parseListingUrl
   ================================================================ */
exports.parseListingUrl = onCall({ region: "us-central1", secrets: [ANTHROPIC_API_KEY, GROQ_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { url } = request.data || {};
  if (!url) {
    throw new HttpsError("invalid-argument", "url is required.");
  }

  await enforceRateLimit(request.auth.uid, "parseListingUrl", 50);

  // SSRF guard: only http(s), reject loopback / link-local / private IPs
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpsError("invalid-argument", "Invalid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpsError("invalid-argument", "Only http(s) URLs are allowed.");
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateHost(host)) {
    throw new HttpsError("invalid-argument", "URL host is not allowed.");
  }

  // DNS-rebinding defense: resolve hostname, reject if any returned IP is private.
  // (The literal-IP regex above only catches IPs typed directly into the URL.)
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== "::1" && !host.includes(":")) {
    try {
      const dns = require("dns").promises;
      const addrs = await dns.lookup(host, { all: true });
      for (const a of addrs) {
        if (isPrivateHost(a.address.toLowerCase())) {
          throw new HttpsError("invalid-argument", "URL host resolves to a private network.");
        }
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("invalid-argument", "Could not resolve URL host.");
    }
  }

  // Fetch the listing page (10s timeout, 2 MB cap)
  let html;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GreenDoorBot/1.0)" },
      redirect: "error",
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      throw new Error(`Unsupported content-type: ${ct || "unknown"}`);
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 2 * 1024 * 1024) {
      throw new Error("Response too large.");
    }
    html = new TextDecoder("utf-8").decode(buf);
  } catch (err) {
    throw new HttpsError("internal", `Failed to fetch URL: ${err.message}`);
  }

  // Truncate HTML to avoid token limits
  const truncated = html.substring(0, 50000);

  const extractionPrompt = `Extract real estate listing details from this HTML and return ONLY a JSON object with these fields (use null for missing values): address (object with street, city, state, zip), listingPrice (number), bedrooms (number), bathrooms (number), squareFeet (number), propertyType (string), yearBuilt (number), lotSize (string), garageSpaces (number), stories (number), mlsNumber (string), status (string), description (string), features (array of strings, max 30).\n\nHTML:\n${truncated}`;

  // Primary: Groq Llama 3.3 70B with native JSON mode (~5x cheaper, faster TTFT than Haiku)
  const groqKey = GROQ_API_KEY.value();
  let content = null;
  if (groqKey) {
    try {
      const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You extract real estate listing data from HTML. Always reply with a single JSON object matching the requested schema." },
            { role: "user", content: extractionPrompt }
          ]
        })
      });
      if (groqResp.ok) {
        const groqData = await groqResp.json();
        content = groqData.choices?.[0]?.message?.content || null;
      } else {
        console.warn("parseListingUrl: Groq returned", groqResp.status, "— falling back to Anthropic");
      }
    } catch (err) {
      console.warn("parseListingUrl: Groq fetch failed —", err.message, "— falling back to Anthropic");
    }
  }

  // Fallback: Anthropic Claude Haiku
  if (!content) {
    const apiKey = ANTHROPIC_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "Neither GROQ_API_KEY nor ANTHROPIC_API_KEY is configured.");
    }
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: extractionPrompt }]
      })
    });
    if (!aiResp.ok) {
      throw new HttpsError("internal", "Failed to parse listing with AI.");
    }
    const aiData = await aiResp.json();
    content = aiData.content?.[0]?.text || "{}";
  }

  // Extract JSON from response (Groq JSON mode returns clean JSON; Haiku may wrap in prose)
  let listing;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    listing = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    listing = {};
  }

  return { listing };
});

/* ================================================================
   seedEmailTemplates
   ================================================================ */
exports.seedEmailTemplates = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const uid = request.auth.uid;

  // Check if templates already exist for this user
  const existing = await db.collection("emailTemplates")
    .where("realtorId", "==", uid)
    .limit(1)
    .get();

  if (!existing.empty) {
    // Backfill the flag so the client stops calling us next load.
    await db.doc(`users/${uid}`).update({ templatesSeeded: true }).catch(() => {});
    return { seeded: false, message: "Templates already exist." };
  }

  const templates = [
    { name: "Initial Outreach", subject: "Great to connect with you!", body: "Hi {{clientName}},\n\nThank you for reaching out. I'd love to learn more about what you're looking for in your next home.\n\nWhen would be a good time to chat?\n\nBest,\n{{realtorName}}", category: "prospecting" },
    { name: "Showing Follow-Up", subject: "How did you like {{propertyAddress}}?", body: "Hi {{clientName}},\n\nI hope you enjoyed touring {{propertyAddress}} today. I'd love to hear your thoughts!\n\nWould you like to schedule another showing or discuss making an offer?\n\nBest,\n{{realtorName}}", category: "showing" },
    { name: "Listing Update", subject: "New listing that matches your criteria", body: "Hi {{clientName}},\n\nI found a new listing that I think you'll love. Here are the details:\n\n{{listingDetails}}\n\nWould you like to schedule a showing?\n\nBest,\n{{realtorName}}", category: "listing" },
    { name: "Under Contract Congrats", subject: "Congratulations - You're under contract!", body: "Hi {{clientName}},\n\nGreat news! Your offer has been accepted and you are now under contract. Here's what happens next:\n\n1. Earnest money deposit\n2. Home inspection scheduling\n3. Appraisal\n\nI'll be guiding you through every step.\n\nBest,\n{{realtorName}}", category: "transaction" },
    { name: "Closing Reminder", subject: "Your closing is approaching!", body: "Hi {{clientName}},\n\nJust a reminder that your closing is scheduled for {{closingDate}}. Please make sure to:\n\n- Bring a valid photo ID\n- Have your closing funds ready\n- Review your closing disclosure\n\nLet me know if you have any questions!\n\nBest,\n{{realtorName}}", category: "transaction" }
  ];

  const batch = db.batch();
  for (const tmpl of templates) {
    const ref = db.collection("emailTemplates").doc();
    batch.set(ref, {
      ...tmpl,
      realtorId: uid,
      createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp()
    });
  }
  await batch.commit();
  await db.doc(`users/${uid}`).update({ templatesSeeded: true }).catch(() => {});

  return { seeded: true, count: templates.length };
});

/* ================================================================
   stressTestBoldSign
   ================================================================ */
exports.stressTestBoldSign = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  await requireAdmin(request);

  const apiKey = BOLDSIGN_API_KEY.value();
  const results = [];

  // Test 1: API key validity
  try {
    const resp = await fetch("https://api.boldsign.com/v1/template/list?PageSize=1", {
      headers: { "X-API-KEY": apiKey }
    });
    results.push({ test: "API Key Valid", passed: resp.ok, details: resp.ok ? "API key accepted" : `HTTP ${resp.status}` });
  } catch (err) {
    results.push({ test: "API Key Valid", passed: false, details: err.message });
  }

  // Test 2: List templates
  try {
    const resp = await fetch("https://api.boldsign.com/v1/template/list?PageSize=5", {
      headers: { "X-API-KEY": apiKey }
    });
    if (resp.ok) {
      const data = await resp.json();
      results.push({ test: "List Templates", passed: true, details: `${data.result?.length || 0} templates found` });
    } else {
      results.push({ test: "List Templates", passed: false, details: `HTTP ${resp.status}` });
    }
  } catch (err) {
    results.push({ test: "List Templates", passed: false, details: err.message });
  }

  // Test 3: Sender identities
  try {
    const resp = await fetch("https://api.boldsign.com/v1/senderIdentities/list?PageSize=5", {
      headers: { "X-API-KEY": apiKey }
    });
    results.push({ test: "Sender Identities", passed: resp.ok, details: resp.ok ? "Endpoint accessible" : `HTTP ${resp.status}` });
  } catch (err) {
    results.push({ test: "Sender Identities", passed: false, details: err.message });
  }

  // Test 4: API latency
  try {
    const start = Date.now();
    await fetch("https://api.boldsign.com/v1/template/list?PageSize=1", {
      headers: { "X-API-KEY": apiKey }
    });
    const latency = Date.now() - start;
    results.push({ test: "API Latency", passed: latency < 5000, details: `${latency}ms` });
  } catch (err) {
    results.push({ test: "API Latency", passed: false, details: err.message });
  }

  // Test 5: Webhook secret configured
  try {
    const webhookSecret = BOLDSIGN_WEBHOOK_SECRET.value();
    results.push({ test: "Webhook Secret", passed: !!webhookSecret, details: webhookSecret ? "Configured" : "Not set" });
  } catch {
    results.push({ test: "Webhook Secret", passed: false, details: "Not configured" });
  }

  // Test 6: Firestore connectivity
  try {
    const snap = await db.collection("envelopes").limit(1).get();
    results.push({ test: "Firestore Access", passed: true, details: "Connected" });
  } catch (err) {
    results.push({ test: "Firestore Access", passed: false, details: err.message });
  }

  // Test 7: Storage access
  try {
    const bucket = getStorage().bucket();
    results.push({ test: "Storage Access", passed: true, details: `Bucket: ${bucket.name}` });
  } catch (err) {
    results.push({ test: "Storage Access", passed: false, details: err.message });
  }

  const passed = results.filter(r => r.passed).length;
  return {
    summary: `${passed}/${results.length} tests passed`,
    results
  };
});

/* ================================================================
   requestSenderVerification
   ================================================================ */
exports.requestSenderVerification = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY, RESEND_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const userData = userSnap.data();
  if (userData.senderVerified) {
    return { alreadyVerified: true };
  }

  const email = userData.email || request.auth.token.email;
  if (!email) {
    throw new HttpsError("failed-precondition", "No email address found on your profile.");
  }

  // Resend authenticates by domain, not per-sender. There's nothing to verify
  // at the user level — agent emails are surfaced via Reply-To and display name.
  // Mark the user "verified" so the UI reflects send-readiness.
  if (isLiveSecret(RESEND_API_KEY.value())) {
    await db.doc(`users/${uid}`).update({ senderVerified: true });
    return { alreadyVerified: true };
  }

  const apiKey = SENDGRID_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "Neither RESEND_API_KEY nor SENDGRID_API_KEY is configured.");
  }

  // Create SendGrid sender identity
  const resp = await fetch("https://api.sendgrid.com/v3/verified_senders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      nickname: userData.fullName || email,
      from_email: email,
      from_name: userData.fullName || "",
      reply_to: email,
      reply_to_name: userData.fullName || ""
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    // 400 may mean already exists
    if (resp.status === 400 && text.includes("already")) {
      await db.doc(`users/${uid}`).update({ senderVerified: true });
      return { alreadyVerified: true };
    }
    throw new HttpsError("internal", `SendGrid error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  await db.doc(`users/${uid}`).update({
    sendgridSenderId: data.id,
    senderVerified: false
  });

  return { alreadyVerified: false };
});

/* ================================================================
   checkSenderVerification
   ================================================================ */
exports.checkSenderVerification = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY, RESEND_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const userData = userSnap.data();
  if (userData.senderVerified) {
    return { verified: true };
  }

  // Resend: domain-auth makes per-user verification a no-op.
  if (isLiveSecret(RESEND_API_KEY.value())) {
    await db.doc(`users/${uid}`).update({ senderVerified: true });
    return { verified: true };
  }

  const apiKey = SENDGRID_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "SENDGRID_API_KEY is not configured.");
  }

  // Check verification status
  const resp = await fetch("https://api.sendgrid.com/v3/verified_senders", {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  if (!resp.ok) {
    throw new HttpsError("internal", `SendGrid error ${resp.status}`);
  }

  const data = await resp.json();
  const email = userData.email || request.auth.token.email;
  const sender = (data.results || []).find(s => s.from_email === email);
  const verified = sender?.verified || false;

  if (verified) {
    await db.doc(`users/${uid}`).update({ senderVerified: true });
  }

  return { verified };
});

/* ================================================================
   removeSenderVerification
   ================================================================ */
exports.removeSenderVerification = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY, RESEND_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const userData = userSnap.data();
  const senderId = userData.sendgridSenderId;

  if (senderId) {
    const apiKey = SENDGRID_API_KEY.value();
    if (apiKey) {
      await fetch(`https://api.sendgrid.com/v3/verified_senders/${senderId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` }
      }).catch(() => {});
    }
  }

  await db.doc(`users/${uid}`).update({
    sendgridSenderId: require("firebase-admin/firestore").FieldValue.delete(),
    senderVerified: require("firebase-admin/firestore").FieldValue.delete()
  });

  return { success: true };
});

/* ================================================================
   inviteRealtor
   ================================================================ */
exports.inviteRealtor = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY, RESEND_API_KEY] }, async (request) => {
  await requireAdmin(request);

  const { email, fullName, company } = request.data || {};
  if (!email || !fullName) {
    throw new HttpsError("invalid-argument", "email and fullName are required.");
  }

  const adminSnap = await db.doc(`users/${request.auth.uid}`).get();
  const adminName = adminSnap.data()?.fullName || "Admin";
  const authAdmin = getAuth();

  // Check if user already exists
  let uid;
  try {
    const existing = await authAdmin.getUserByEmail(email);
    uid = existing.uid;
  } catch {
    // Create new auth user with random password
    const tempPassword = crypto.randomBytes(16).toString("hex");
    const userRecord = await authAdmin.createUser({
      email,
      password: tempPassword,
      displayName: fullName
    });
    uid = userRecord.uid;
  }

  // Create/update Firestore user profile
  await db.doc(`users/${uid}`).set({
    email,
    fullName,
    company: company || "",
    role: "realtor",
    isActive: true,
    onboardingComplete: false,
    invitedBy: request.auth.uid,
    createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp(),
    lastInviteSentAt: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  }, { merge: true });

  // Generate password reset link for the invited user
  const resetLink = await authAdmin.generatePasswordResetLink(email);

  // Send invitation email
  try {
    await sendViaEmail({
      to: email,
      toName: fullName,
      subject: `You've been invited to GreenDoor CRM`,
      body: `<p>Hi ${escapeHtml(fullName)},</p><p>${escapeHtml(adminName)} has invited you to join GreenDoor CRM.</p><p>Click the link below to set your password and get started:</p><p><a href="${escapeHtml(resetLink)}">Set Your Password</a></p><p>Best,<br>The GreenDoor Team</p>`,
      fromEmail: "greendoor@stoekmedia.com",
      fromName: "GreenDoor CRM"
    });
  } catch (err) {
    console.error("Failed to send invite email:", err);
  }

  return { uid };
});

/* ================================================================
   resendInvite
   ================================================================ */
exports.resendInvite = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY, RESEND_API_KEY] }, async (request) => {
  await requireAdmin(request);

  const { targetUid } = request.data || {};
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid is required.");
  }

  const userSnap = await db.doc(`users/${targetUid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  const userData = userSnap.data();
  const authAdmin = getAuth();

  // Generate new password reset link
  const resetLink = await authAdmin.generatePasswordResetLink(userData.email);

  // Send the invite email
  await sendViaEmail({
    to: userData.email,
    toName: userData.fullName || "",
    subject: `Reminder: You've been invited to GreenDoor CRM`,
    body: `<p>Hi ${escapeHtml(userData.fullName || "there")},</p><p>This is a reminder that you've been invited to join GreenDoor CRM.</p><p>Click the link below to set your password and get started:</p><p><a href="${escapeHtml(resetLink)}">Set Your Password</a></p><p>Best,<br>The GreenDoor Team</p>`,
    fromEmail: "greendoor@stoekmedia.com",
    fromName: "GreenDoor CRM"
  });

  await db.doc(`users/${targetUid}`).update({
    lastInviteSentAt: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { success: true };
});

/* ================================================================
   offboardRealtor
   ================================================================ */
exports.offboardRealtor = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  await requireAdmin(request);

  const { targetUid, clientDispositions, options } = request.data || {};
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid is required.");
  }

  const { FieldValue, getFirestore } = require("firebase-admin/firestore");
  const bulkWriter = getFirestore().bulkWriter();
  bulkWriter.onWriteError(err => err.failedAttempts < 3); // retry up to 3x

  async function deleteByQuery(q) {
    const snap = await q.get();
    snap.docs.forEach(d => bulkWriter.delete(d.ref));
  }

  // Process client dispositions
  if (clientDispositions) {
    for (const [clientId, disposition] of Object.entries(clientDispositions)) {
      const clientRef = db.doc(`clients/${clientId}`);
      if (disposition.action === "reassign" && disposition.targetRealtorId) {
        bulkWriter.update(clientRef, { realtorId: disposition.targetRealtorId });
      } else if (disposition.action === "delete") {
        for (const col of ["activities", "files", "folders", "bookmarkedProperties", "clientListingMatches", "showings", "followUps", "envelopes"]) {
          await deleteByQuery(db.collection(col).where("clientId", "==", clientId));
        }
        for (const sub of ["complianceDocs", "closingChecklist"]) {
          await deleteByQuery(db.collection(`clients/${clientId}/${sub}`));
        }
        bulkWriter.delete(clientRef);
      } else {
        bulkWriter.update(clientRef, { realtorId: FieldValue.delete() });
      }
    }
  }

  // Data cleanup based on options
  if (options?.deleteFiles) {
    const filesSnap = await db.collection("files").where("realtorId", "==", targetUid).get();
    const bucket = getStorage().bucket();
    // Storage deletes in parallel (cap concurrency at 25)
    const queue = filesSnap.docs.slice();
    async function worker() {
      while (queue.length) {
        const fileDoc = queue.shift();
        const fileData = fileDoc.data();
        if (fileData.storagePath) {
          try { await bucket.file(fileData.storagePath).delete(); } catch {}
        }
        bulkWriter.delete(fileDoc.ref);
      }
    }
    await Promise.all(Array.from({ length: 25 }, worker));
  }

  if (options?.deleteActivities) {
    for (const col of ["activities", "showings", "followUps", "events"]) {
      await deleteByQuery(db.collection(col).where("realtorId", "==", targetUid));
    }
  }

  if (options?.deleteEnvelopes) {
    await deleteByQuery(db.collection("envelopes").where("realtorId", "==", targetUid));
  }

  await bulkWriter.close();

  if (options?.disableAuth) {
    try {
      await getAuth().updateUser(targetUid, { disabled: true });
    } catch (err) {
      console.error("Failed to disable auth:", err);
    }
  }

  // Mark user as offboarded
  await db.doc(`users/${targetUid}`).update({
    isActive: false,
    offboardedAt: FieldValue.serverTimestamp()
  });

  return { success: true };
});

/* ================================================================
   FOLLOW-UP SEQUENCES (Drip Campaigns)
   ================================================================ */

/**
 * createSequence — create a new follow-up sequence template
 */
exports.createSequence = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { name, steps } = request.data || {};
  if (!name || !steps || !steps.length) {
    throw new HttpsError("invalid-argument", "name and steps[] are required.");
  }

  const uid = request.auth.uid;
  const ref = await db.collection("followUpSequences").add({
    realtorId: uid,
    name,
    steps, // [{ delayDays: number, subject: string, body: string }]
    isActive: true,
    createdAt: FieldValue.serverTimestamp()
  });

  return { sequenceId: ref.id };
});

/**
 * enrollClientInSequence — start a client on a drip sequence
 */
exports.enrollClientInSequence = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { clientId, sequenceId } = request.data || {};
  if (!clientId || !sequenceId) {
    throw new HttpsError("invalid-argument", "clientId and sequenceId are required.");
  }

  const uid = request.auth.uid;

  // Verify sequence belongs to user
  const seqSnap = await db.doc(`followUpSequences/${sequenceId}`).get();
  if (!seqSnap.exists || seqSnap.data().realtorId !== uid) {
    throw new HttpsError("not-found", "Sequence not found.");
  }

  // Check if client already enrolled in this sequence
  const existing = await db.collection("sequenceEnrollments")
    .where("clientId", "==", clientId)
    .where("sequenceId", "==", sequenceId)
    .where("status", "==", "active")
    .get();
  if (!existing.empty) {
    throw new HttpsError("already-exists", "Client is already enrolled in this sequence.");
  }

  const steps = seqSnap.data().steps || [];
  const now = new Date();
  const firstDelay = steps[0]?.delayDays || 0;
  const nextStepDate = new Date(now.getTime() + firstDelay * 86400000);

  const ref = await db.collection("sequenceEnrollments").add({
    realtorId: uid,
    clientId,
    sequenceId,
    currentStep: 0,
    nextStepDate: require("firebase-admin/firestore").Timestamp.fromDate(nextStepDate),
    status: "active",
    startedAt: FieldValue.serverTimestamp()
  });

  return { enrollmentId: ref.id };
});

/**
 * cancelSequenceEnrollment — stop a client's drip sequence
 */
exports.cancelSequenceEnrollment = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { enrollmentId } = request.data || {};
  if (!enrollmentId) throw new HttpsError("invalid-argument", "enrollmentId is required.");

  const enrollmentRef = db.doc(`sequenceEnrollments/${enrollmentId}`);
  const snap = await enrollmentRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Enrollment not found.");
  if (snap.data().realtorId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "You can only cancel your own enrollments.");
  }

  await enrollmentRef.update({
    status: "cancelled",
    cancelledAt: FieldValue.serverTimestamp()
  });

  return { success: true };
});

/**
 * processSequences — scheduled, runs every hour
 * Finds enrollments with nextStepDate in the past, sends the email, advances step.
 */
/**
 * cleanupSearchHistory — daily scheduled job that prunes searchHistory docs
 * older than 90 days. searchHistory is a write-only audit-style collection
 * with no UI surface, so unbounded growth has no upside.
 */
exports.cleanupSearchHistory = onSchedule(
  { schedule: "every 24 hours", region: "us-central1", timeoutSeconds: 300 },
  async () => {
    const ninetyDaysAgo = require("firebase-admin/firestore").Timestamp.fromDate(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    );
    const snap = await db.collection("searchHistory")
      .where("searchedAt", "<", ninetyDaysAgo)
      .limit(2000)
      .get();
    if (snap.empty) return;
    const bulkWriter = db.bulkWriter();
    snap.docs.forEach(d => bulkWriter.delete(d.ref));
    await bulkWriter.close();
    console.log(`cleanupSearchHistory: pruned ${snap.size} docs.`);
  }
);

exports.processSequences = onSchedule(
  { schedule: "every 1 hours", region: "us-central1", timeoutSeconds: 300, secrets: [SENDGRID_API_KEY, RESEND_API_KEY] },
  async (event) => {
    const now = require("firebase-admin/firestore").Timestamp.now();

    const dueSnap = await db.collection("sequenceEnrollments")
      .where("status", "==", "active")
      .where("nextStepDate", "<=", now)
      .get();

    if (dueSnap.empty) {
      console.log("processSequences: no due enrollments.");
      return;
    }

    let sent = 0, errors = 0;

    for (const enrollDoc of dueSnap.docs) {
      try {
        const enrollment = enrollDoc.data();
        const { realtorId, clientId, sequenceId, currentStep } = enrollment;

        // Load sequence
        const seqSnap = await db.doc(`followUpSequences/${sequenceId}`).get();
        if (!seqSnap.exists || !seqSnap.data().isActive) {
          await enrollDoc.ref.update({ status: "cancelled" });
          continue;
        }

        const steps = seqSnap.data().steps || [];
        if (currentStep >= steps.length) {
          await enrollDoc.ref.update({ status: "completed" });
          continue;
        }

        // Load client + realtor data
        const clientSnap = await db.doc(`clients/${clientId}`).get();
        const userSnap = await db.doc(`users/${realtorId}`).get();
        if (!clientSnap.exists || !userSnap.exists) {
          await enrollDoc.ref.update({ status: "cancelled" });
          continue;
        }

        const client = clientSnap.data();
        const user = userSnap.data();
        const step = steps[currentStep];

        // Resolve merge tags
        const subject = resolveMergeTags(step.subject, client, user);
        const body = resolveMergeTags(step.body, client, user);

        // Send email
        const fromEmail = user.senderVerified ? user.email : "greendoor@stoekmedia.com";
        const fromName = user.fullName || "GreenDoor CRM";
        const replyTo = user.senderVerified ? null : user.email;

        await sendViaEmail({
          to: client.email,
          toName: client.fullName,
          subject,
          body: body.replace(/\n/g, "<br>"),
          fromEmail,
          fromName,
          replyTo
        });

        // Log activity
        await db.collection("activities").add({
          type: "email",
          subject,
          body,
          clientId,
          realtorId,
          automated: true,
          sequenceId,
          timestamp: FieldValue.serverTimestamp()
        });

        // Advance step or complete
        const nextStep = currentStep + 1;
        if (nextStep >= steps.length) {
          await enrollDoc.ref.update({
            status: "completed",
            completedAt: FieldValue.serverTimestamp()
          });
        } else {
          const nextDelay = steps[nextStep].delayDays || 1;
          const nextDate = new Date(Date.now() + nextDelay * 86400000);
          await enrollDoc.ref.update({
            currentStep: nextStep,
            nextStepDate: require("firebase-admin/firestore").Timestamp.fromDate(nextDate)
          });
        }

        sent++;
      } catch (err) {
        console.error(`processSequences error for ${enrollDoc.id}:`, err);
        errors++;
      }
    }

    console.log(`processSequences complete: ${sent} emails sent, ${errors} errors out of ${dueSnap.size} due.`);
  }
);

/** Resolve {{clientName}}, {{realtorName}}, etc. in templates */
function resolveMergeTags(text, client, user) {
  return text
    .replace(/\{\{clientName\}\}/g, client.fullName || "there")
    .replace(/\{\{clientFirstName\}\}/g, (client.fullName || "").split(" ")[0] || "there")
    .replace(/\{\{clientEmail\}\}/g, client.email || "")
    .replace(/\{\{clientPhone\}\}/g, client.phone || "")
    .replace(/\{\{realtorName\}\}/g, user.fullName || "Your Agent")
    .replace(/\{\{realtorEmail\}\}/g, user.email || "")
    .replace(/\{\{realtorPhone\}\}/g, user.phone || "")
    .replace(/\{\{realtorCompany\}\}/g, user.company || "");
}

/* ================================================================
   CALENDAR FEED EXPORT (iCal / ICS)
   ================================================================ */

/**
 * calendarFeed — HTTP endpoint that returns an iCal feed of the user's events.
 * Subscribe in Google Calendar / Apple Calendar / Outlook via URL.
 * URL format: /calendarFeed?token={feedToken}
 */
exports.calendarFeed = onRequest({ region: "us-central1" }, async (req, res) => {
  const token = req.query.token;
  if (!token) {
    res.status(400).send("Missing token parameter.");
    return;
  }

  // Look up user by feed token
  const usersSnap = await db.collection("users").where("calendarFeedToken", "==", token).limit(1).get();
  if (usersSnap.empty) {
    res.status(404).send("Invalid feed token.");
    return;
  }

  const userDoc = usersSnap.docs[0];
  const uid = userDoc.id;
  const userData = userDoc.data();

  // Load events
  const eventsSnap = await db.collection("events").where("realtorId", "==", uid).get();
  const showingsSnap = await db.collection("showings").where("realtorId", "==", uid).get();
  const followUpsSnap = await db.collection("followUps").where("realtorId", "==", uid).where("status", "==", "outstanding").get();

  // Build iCal
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GreenDoor CRM//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:GreenDoor - ${userData.fullName || "Agent"}`,
    "X-WR-TIMEZONE:America/Chicago"
  ];

  // Events
  eventsSnap.forEach(d => {
    const ev = d.data();
    const start = ev.startDate?.toDate?.();
    const end = ev.endDate?.toDate?.();
    if (!start) return;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:gd-event-${d.id}@greendoor`);
    lines.push(`DTSTART:${formatICalDate(start)}`);
    if (end) lines.push(`DTEND:${formatICalDate(end)}`);
    lines.push(`SUMMARY:${escapeICal(ev.title || "Event")}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeICal(ev.description)}`);
    lines.push("END:VEVENT");
  });

  // Showings
  showingsSnap.forEach(d => {
    const s = d.data();
    const start = s.showingDate?.toDate?.();
    if (!start) return;
    const end = s.endDate?.toDate?.() || new Date(start.getTime() + 3600000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:gd-showing-${d.id}@greendoor`);
    lines.push(`DTSTART:${formatICalDate(start)}`);
    lines.push(`DTEND:${formatICalDate(end)}`);
    lines.push(`SUMMARY:Showing: ${escapeICal(s.address || "Property")}`);
    if (s.location) lines.push(`LOCATION:${escapeICal(s.location)}`);
    lines.push("END:VEVENT");
  });

  // Follow-ups as all-day events
  followUpsSnap.forEach(d => {
    const fu = d.data();
    const due = fu.dueDate?.toDate?.();
    if (!due) return;
    const dateStr = due.toISOString().slice(0, 10).replace(/-/g, "");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:gd-followup-${d.id}@greendoor`);
    lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
    lines.push(`SUMMARY:Follow-up: ${escapeICal(fu.title || "Task")}`);
    if (fu.notes) lines.push(`DESCRIPTION:${escapeICal(fu.notes)}`);
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");

  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Content-Disposition", "inline; filename=greendoor-calendar.ics");
  res.set("Cache-Control", "public, max-age=300"); // 5-min cache
  res.send(lines.join("\r\n"));
});

/** Generate or get the user's calendar feed token */
exports.getCalendarFeedUrl = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const uid = request.auth.uid;
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();

  let token = userSnap.data()?.calendarFeedToken;
  if (!token) {
    token = crypto.randomBytes(24).toString("hex");
    await userRef.update({ calendarFeedToken: token });
  }

  const baseUrl = "https://us-central1-greendoor-2da47.cloudfunctions.net/calendarFeed";
  return { feedUrl: `${baseUrl}?token=${token}` };
});

function formatICalDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICal(str) {
  return (str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/* ================================================================
   SMS MESSAGING (Twilio)
   ================================================================ */
const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_PHONE_NUMBER = defineSecret("TWILIO_PHONE_NUMBER");

/**
 * sendSMS — send a text message to a client via Twilio
 */
exports.sendSMS = onCall(
  { region: "us-central1", secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");

    const { to, body, clientId } = request.data || {};
    if (!to || !body) throw new HttpsError("invalid-argument", "to and body are required.");

    const sid = TWILIO_ACCOUNT_SID.value();
    const token = TWILIO_AUTH_TOKEN.value();
    const from = TWILIO_PHONE_NUMBER.value();

    if (!sid || !token || !from) {
      throw new HttpsError("failed-precondition", "Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to Firebase secrets.");
    }

    // Clean phone number
    let phone = to.replace(/[^0-9+]/g, "");
    if (!phone.startsWith("+")) phone = "+1" + phone;

    try {
      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({ To: phone, From: from, Body: body }).toString()
        }
      );

      const result = await resp.json();
      if (!resp.ok) {
        throw new HttpsError("internal", `Twilio error: ${result.message || resp.status}`);
      }

      // Log activity
      const uid = request.auth.uid;
      await db.collection("activities").add({
        type: "sms",
        subject: `SMS to ${to}`,
        body,
        clientId: clientId || null,
        realtorId: uid,
        twilioSid: result.sid,
        timestamp: FieldValue.serverTimestamp()
      });

      return { success: true, messageSid: result.sid };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", "Failed to send SMS: " + err.message);
    }
  }
);
