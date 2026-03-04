const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

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

/**
 * sendComplianceDoc (SHELL)
 *
 * Sends a compliance document to a client for signature via BoldSign.
 * Uses the realtor's approved sender identity (onBehalfOf) so the email
 * appears from the realtor rather than the BoldSign account default.
 *
 * This is a shell -- the full send flow will be implemented in Plan 02-03.
 *
 * Plan 02-03 will add:
 * - Template lookup from documentTemplates collection
 * - Merge field resolution via buildMergeFields()
 * - BoldSign POST /v1/template/send API call with existingFormFields + onBehalfOf
 * - complianceDocs subcollection write (clients/{clientId}/complianceDocs/{templateId})
 * - Error handling for missing templates, invalid merge fields, BoldSign API errors
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

  // Read caller's Firestore profile to get sender email for onBehalfOf
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found in Firestore.");
  }

  const userData = userSnap.data();

  // Email fallback chain: Firestore profile email -> Firebase Auth email (BSND-03, BSND-04)
  const senderEmail = userData.email || request.auth.token.email;

  // Check sender identity approval status
  if (userData.boldSignSenderIdentityStatus !== "approved") {
    console.warn(
      `Sender identity not approved for ${uid} (status: ${userData.boldSignSenderIdentityStatus || "not_created"}). ` +
      "Proceeding without onBehalfOf -- emails will show default BoldSign sender."
    );
  }

  // SHELL: Full implementation coming in Plan 02-03
  return {
    status: "not_implemented",
    message: "Send flow will be implemented in Plan 02-03",
    senderEmail: senderEmail,
    templateId: templateId,
    clientId: clientId,
    listingId: listingId || null,
  };
});
