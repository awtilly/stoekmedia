const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

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
exports.createSenderIdentity = onCall({ region: "us-central1" }, async (request) => {
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
  const apiKey = process.env.BOLDSIGN_API_KEY;
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
exports.sendComplianceDoc = onCall({ region: "us-central1" }, async (request) => {
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

  const apiKey = process.env.BOLDSIGN_API_KEY;
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
exports.sendBulkComplianceDocs = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to send compliance documents.");
  }

  const uid = request.auth.uid;
  const { templateIds, clientId, listingId } = request.data || {};

  if (!templateIds || !Array.isArray(templateIds) || templateIds.length === 0 || !clientId) {
    throw new HttpsError("invalid-argument", "templateIds (non-empty array) and clientId are required.");
  }

  const apiKey = process.env.BOLDSIGN_API_KEY;
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
/*  boldSignWebhook                                                    */
/*                                                                     */
/*  Receives BoldSign completion events, verifies HMAC signature,      */
/*  downloads the signed PDF, uploads it to Firebase Storage under      */
/*  the client's closing-documents path, creates a Firestore file       */
/*  record, and updates the compliance doc status to "signed".          */
/* ------------------------------------------------------------------ */

exports.boldSignWebhook = onRequest({ region: "us-central1" }, async (req, res) => {
  // Step 1 -- Method guard: only accept POST
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  // Step 2 -- HMAC verification (WHBK-02)
  const sigHeader = req.headers["x-boldsign-signature"];
  if (!sigHeader || !verifyBoldSignSignature(sigHeader, req.rawBody, process.env.BOLDSIGN_WEBHOOK_SECRET)) {
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
    const apiKey = process.env.BOLDSIGN_API_KEY;
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

    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: "2030-01-01"
    });

    // Step 8 -- Write Firestore records (WHBK-07, WHBK-08)
    const FieldValue = require("firebase-admin/firestore").FieldValue;

    await Promise.all([
      // File record with deterministic ID for idempotency
      db.doc(`files/${fileDocId}`).set({
        clientId: clientId,
        realtorId: realtorId,
        fileName: fileName,
        storagePath: storagePath,
        downloadUrl: signedUrl,
        folderId: `${clientId}_closing_documents`,
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

    console.log(`boldSignWebhook: Processed signed document for client ${clientId}, template ${templateId}`);

    // Step 9 -- Respond (WHBK-10)
    return res.status(200).send("OK");

  } catch (error) {
    console.error("boldSignWebhook error:", error);
    return res.status(200).send("OK");
  }
});
