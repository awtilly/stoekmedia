const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

exports.askAssistant = onCall({ region: "us-central1", secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { question, context, history, clientId, contextData } = request.data || {};
  if (!question) {
    throw new HttpsError("invalid-argument", "question is required.");
  }

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
  } else if (context === "client_detail" && clientId) {
    // Read client data for generic client-detail context
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (clientSnap.exists) {
      const c = clientSnap.data();
      systemPrompt = `You are a real estate assistant. The realtor is viewing client: ${c.fullName || 'Unknown'}. Status: ${c.status || 'unknown'}. Transaction type: ${c.transactionType || 'not set'}. Help with questions about this client.`;
    }
  }

  // Build messages array
  const messages = [];
  if (history && Array.isArray(history)) {
    const recentHistory = history.slice(-6);
    messages.push(...recentHistory);
  }
  messages.push({ role: "user", content: question });

  // Call Anthropic Claude
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      system: systemPrompt,
      messages: messages,
      max_tokens: 800
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error:", errText);
    throw new HttpsError("internal", "AI service temporarily unavailable. Please try again.");
  }

  const data = await response.json();
  const aiResponse = data.content?.[0]?.text || "I wasn't able to generate a response. Please try again.";

  return { response: aiResponse };
});

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
   HELPER: send email via SendGrid
   ================================================================ */
async function sendViaEmail({ to, toName, subject, body, fromEmail, fromName, replyTo }) {
  const apiKey = SENDGRID_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "SENDGRID_API_KEY is not configured.");
  }

  const msg = {
    personalizations: [{ to: [{ email: to, name: toName || undefined }] }],
    from: { email: fromEmail || "greendoor@stoekmedia.com", name: fromName || "GreenDoor CRM" },
    subject,
    content: [{ type: "text/html", value: body }]
  };
  if (replyTo) msg.reply_to = { email: replyTo };

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
   sendEmail
   ================================================================ */
exports.sendEmail = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY] }, async (request) => {
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

  const fromEmail = userData.senderVerified ? userData.email : "greendoor@stoekmedia.com";
  const fromName = userData.fullName || "GreenDoor CRM";
  const replyTo = userData.senderVerified ? null : userData.email;

  await sendViaEmail({ to, toName, subject, body, fromEmail, fromName, replyTo });

  // Log activity
  await db.collection("activities").add({
    type: "email",
    subject,
    body,
    clientId: clientId || null,
    realtorId: uid,
    timestamp: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { success: true };
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
exports.shareDocument = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY] }, async (request) => {
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

  const fromEmail = userData.senderVerified ? userData.email : "greendoor@stoekmedia.com";
  const fromName = userData.fullName || "GreenDoor CRM";
  const replyTo = userData.senderVerified ? null : userData.email;

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

  await sendViaEmail({
    to,
    toName: "",
    subject: subject || "Documents shared with you",
    body: htmlBody,
    fromEmail,
    fromName,
    replyTo
  });

  // Log activity
  await db.collection("activities").add({
    type: "file_share",
    subject: subject || "Documents shared",
    clientId: clientId || null,
    realtorId: uid,
    fileCount: files.length,
    timestamp: require("firebase-admin/firestore").FieldValue.serverTimestamp()
  });

  return { success: true };
});

/* ================================================================
   parseListingUrl
   ================================================================ */
exports.parseListingUrl = onCall({ region: "us-central1", secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { url } = request.data || {};
  if (!url) {
    throw new HttpsError("invalid-argument", "url is required.");
  }

  // Fetch the listing page
  let html;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GreenDoorBot/1.0)" }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch (err) {
    throw new HttpsError("internal", `Failed to fetch URL: ${err.message}`);
  }

  // Truncate HTML to avoid token limits
  const truncated = html.substring(0, 50000);

  // Use Anthropic API to extract structured listing data
  const apiKey = ANTHROPIC_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "ANTHROPIC_API_KEY is not configured.");
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
      messages: [{
        role: "user",
        content: `Extract real estate listing details from this HTML and return ONLY a JSON object with these fields (use null for missing values): address (object with street, city, state, zip), listingPrice (number), bedrooms (number), bathrooms (number), squareFeet (number), propertyType (string), yearBuilt (number), lotSize (string), garageSpaces (number), stories (number), mlsNumber (string), status (string), description (string), features (array of strings, max 30).\n\nHTML:\n${truncated}`
      }]
    })
  });

  if (!aiResp.ok) {
    throw new HttpsError("internal", "Failed to parse listing with AI.");
  }

  const aiData = await aiResp.json();
  const content = aiData.content?.[0]?.text || "{}";

  // Extract JSON from response
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

  return { seeded: true, count: templates.length };
});

/* ================================================================
   stressTestBoldSign
   ================================================================ */
exports.stressTestBoldSign = onCall({ region: "us-central1", secrets: [BOLDSIGN_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

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
exports.requestSenderVerification = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY] }, async (request) => {
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

  const apiKey = SENDGRID_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "SENDGRID_API_KEY is not configured.");
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
exports.checkSenderVerification = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY] }, async (request) => {
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
exports.removeSenderVerification = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY] }, async (request) => {
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
exports.inviteRealtor = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY] }, async (request) => {
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
      body: `<p>Hi ${fullName},</p><p>${adminName} has invited you to join GreenDoor CRM.</p><p>Click the link below to set your password and get started:</p><p><a href="${resetLink}">Set Your Password</a></p><p>Best,<br>The GreenDoor Team</p>`,
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
exports.resendInvite = onCall({ region: "us-central1", secrets: [SENDGRID_API_KEY] }, async (request) => {
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
    body: `<p>Hi ${userData.fullName || "there"},</p><p>This is a reminder that you've been invited to join GreenDoor CRM.</p><p>Click the link below to set your password and get started:</p><p><a href="${resetLink}">Set Your Password</a></p><p>Best,<br>The GreenDoor Team</p>`,
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
exports.offboardRealtor = onCall({ region: "us-central1" }, async (request) => {
  await requireAdmin(request);

  const { targetUid, clientDispositions, options } = request.data || {};
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid is required.");
  }

  const { FieldValue } = require("firebase-admin/firestore");

  // Process client dispositions
  if (clientDispositions) {
    for (const [clientId, disposition] of Object.entries(clientDispositions)) {
      const clientRef = db.doc(`clients/${clientId}`);
      if (disposition.action === "reassign" && disposition.targetRealtorId) {
        await clientRef.update({ realtorId: disposition.targetRealtorId });
      } else if (disposition.action === "delete") {
        // Delete client and related data
        const relatedCols = ["activities", "files", "folders", "bookmarkedProperties", "clientListingMatches", "showings", "followUps"];
        for (const col of relatedCols) {
          const snap = await db.collection(col).where("clientId", "==", clientId).get();
          const batch = db.batch();
          snap.docs.forEach(d => batch.delete(d.ref));
          if (!snap.empty) await batch.commit();
        }
        // Delete subcollections
        for (const sub of ["complianceDocs", "closingChecklist"]) {
          const subSnap = await db.collection(`clients/${clientId}/${sub}`).get();
          const batch = db.batch();
          subSnap.docs.forEach(d => batch.delete(d.ref));
          if (!subSnap.empty) await batch.commit();
        }
        await clientRef.delete();
      } else {
        // Unassign
        await clientRef.update({ realtorId: FieldValue.delete() });
      }
    }
  }

  // Data cleanup based on options
  if (options?.deleteFiles) {
    const filesSnap = await db.collection("files").where("realtorId", "==", targetUid).get();
    for (const fileDoc of filesSnap.docs) {
      const fileData = fileDoc.data();
      if (fileData.storagePath) {
        try {
          await getStorage().bucket().file(fileData.storagePath).delete();
        } catch {}
      }
      await fileDoc.ref.delete();
    }
  }

  if (options?.deleteActivities) {
    for (const col of ["activities", "showings", "followUps", "events"]) {
      const snap = await db.collection(col).where("realtorId", "==", targetUid).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      if (!snap.empty) await batch.commit();
    }
  }

  if (options?.deleteEnvelopes) {
    const snap = await db.collection("envelopes").where("realtorId", "==", targetUid).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }

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
