const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const anthropicKey = defineSecret("ANTHROPIC_API_KEY");
const sendgridKey = defineSecret("SENDGRID_API_KEY");
const boldsignKey = defineSecret("BOLDSIGN_API_KEY");
const boldsignWebhookSecret = defineSecret("BOLDSIGN_WEBHOOK_SECRET");

/* ================================================================
   AI ASSISTANT
   ================================================================ */

const SYSTEM_PROMPT = `You are GreenDoor AI, an intelligent assistant for real estate professionals. You help realtors manage their clients, draft communications, analyze client preferences, and make smart recommendations. Be concise, professional, and actionable. When drafting emails, write them ready to send — not as templates with brackets. Use the client's actual name and details. Format emails with proper greeting and sign-off. When making suggestions, be specific and reference actual data from the client's history. Use markdown formatting: **bold** for emphasis, bullet points for lists.`;

exports.askAssistant = onCall(
  { secrets: [anthropicKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    const { question, clientId, context } = request.data;

    if (!question || typeof question !== "string") {
      throw new HttpsError("invalid-argument", "A question is required.");
    }

    // Validate question length
    if (question.length > 2000) {
      throw new HttpsError("invalid-argument", "Question is too long (max 2000 characters).");
    }

    // Rate limiting: 50 requests per day (atomic transaction)
    const today = new Date().toISOString().slice(0, 10);
    const rateLimitRef = db.doc(`rateLimits/${uid}`);
    await db.runTransaction(async (t) => {
      const rateLimitSnap = await t.get(rateLimitRef);
      const rateLimitData = rateLimitSnap.exists ? rateLimitSnap.data() : {};
      if (rateLimitData.date === today && rateLimitData.count >= 50) {
        throw new HttpsError("resource-exhausted", "Daily AI limit reached (50 requests). Try again tomorrow.");
      }
      if (rateLimitData.date === today) {
        t.update(rateLimitRef, { count: FieldValue.increment(1) });
      } else {
        t.set(rateLimitRef, { date: today, count: 1 });
      }
    });

    let contextText = "";

    try {
      if (clientId && context === "client_detail") {
        const clientSnap = await db.doc(`clients/${clientId}`).get();
        if (!clientSnap.exists) {
          throw new HttpsError("not-found", "Client not found.");
        }
        const client = clientSnap.data();
        if (client.realtorId !== uid) {
          throw new HttpsError("permission-denied", "You do not have access to this client.");
        }

        const activitiesSnap = await db.collection("activities")
          .where("clientId", "==", clientId)
          .where("realtorId", "==", uid)
          .orderBy("timestamp", "desc")
          .limit(20)
          .get();
        const activities = activitiesSnap.docs.map(d => {
          const a = d.data();
          return {
            type: a.type,
            subject: a.subject,
            body: a.body ? a.body.substring(0, 300) : "",
            date: a.timestamp ? a.timestamp.toDate().toISOString() : "unknown"
          };
        });

        const propsSnap = await db.collection("bookmarkedProperties")
          .where("clientId", "==", clientId)
          .where("realtorId", "==", uid)
          .get();
        const properties = propsSnap.docs.map(d => {
          const p = d.data();
          return {
            address: p.address,
            price: p.listingPrice,
            status: p.status,
            rating: p.clientRating,
            feedback: p.clientFeedback,
            showingDate: p.showingDate ? p.showingDate.toDate().toISOString() : null
          };
        });

        const filesSnap = await db.collection("files")
          .where("clientId", "==", clientId)
          .where("realtorId", "==", uid)
          .get();
        const files = filesSnap.docs.map(d => ({
          name: d.data().fileName,
          folder: d.data().folder
        }));

        const lastContact = client.lastActivityDate
          ? client.lastActivityDate.toDate().toISOString()
          : "never";
        const daysSinceContact = client.lastActivityDate
          ? Math.floor((Date.now() - client.lastActivityDate.toDate().getTime()) / 86400000)
          : null;

        contextText = `
CLIENT PROFILE:
- Name: ${client.fullName || "Unknown"}
- Email: ${client.email || "N/A"}
- Phone: ${client.phone || "N/A"}
- Status: ${client.status || "lead"}
- Source: ${client.source || "N/A"}
- Timeline: ${client.timeline || "N/A"}
- Budget: $${client.budgetMin?.toLocaleString() || "?"} — $${client.budgetMax?.toLocaleString() || "?"}
- Preferred Locations: ${(client.preferredLocations || []).join(", ") || "N/A"}
- Property Types: ${(client.propertyTypes || []).join(", ") || "N/A"}
- Beds: ${client.bedsMin || "?"}-${client.bedsMax || "?"}, Baths: ${client.bathsMin || "?"}-${client.bathsMax || "?"}
- Sq Ft: ${client.sqftMin || "?"}-${client.sqftMax || "?"}
- Must-Have Features: ${(client.mustHaveFeatures || []).join(", ") || "N/A"}
- Pre-Approval: ${client.preApprovalStatus || "N/A"}, Amount: $${client.preApprovalAmount?.toLocaleString() || "N/A"}
- Last Contact: ${lastContact}${daysSinceContact !== null ? ` (${daysSinceContact} days ago)` : ""}
- Notes: ${client.notes || "None"}

RECENT ACTIVITIES (${activities.length} shown):
${activities.map(a => `- [${a.date}] ${a.type.toUpperCase()}: ${a.subject}${a.body ? " — " + a.body : ""}`).join("\n") || "No activities"}

BOOKMARKED PROPERTIES (${properties.length}):
${properties.map(p => `- ${p.address} | $${p.price?.toLocaleString() || "?"} | Status: ${p.status} | Rating: ${p.rating || "?"}/5${p.feedback ? " | Feedback: " + p.feedback : ""}${p.showingDate ? " | Showing: " + p.showingDate : ""}`).join("\n") || "No properties"}

FILES (${files.length}):
${files.map(f => `- ${f.name} (${f.folder})`).join("\n") || "No files"}`;

      } else if (context === "dashboard") {
        const clientsSnap = await db.collection("clients")
          .where("realtorId", "==", uid)
          .get();

        const now = Date.now();
        const fourteenDaysMs = 14 * 86400000;
        const sevenDaysMs = 7 * 86400000;
        const clients = [];
        const staleClients = [];

        clientsSnap.forEach(d => {
          const c = d.data();
          clients.push({ id: d.id, name: c.fullName, status: c.status, lastActivity: c.lastActivityDate });
          if (c.lastActivityDate) {
            const lastMs = c.lastActivityDate.toDate().getTime();
            if (now - lastMs > fourteenDaysMs) {
              const days = Math.floor((now - lastMs) / 86400000);
              staleClients.push({ name: c.fullName, status: c.status, daysAgo: days });
            }
          }
        });

        const nowTs = Timestamp.now();
        const weekFromNow = Timestamp.fromDate(new Date(now + sevenDaysMs));
        const showingsSnap = await db.collection("bookmarkedProperties")
          .where("realtorId", "==", uid)
          .where("showingDate", ">=", nowTs)
          .where("showingDate", "<=", weekFromNow)
          .get();

        const clientMap = {};
        clientsSnap.forEach(d => { clientMap[d.id] = d.data().fullName; });

        const showings = showingsSnap.docs.map(d => {
          const p = d.data();
          return {
            address: p.address,
            clientName: clientMap[p.clientId] || "Unknown",
            date: p.showingDate.toDate().toISOString()
          };
        });

        const statusCounts = {};
        clients.forEach(c => {
          statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
        });

        contextText = `
DASHBOARD SUMMARY:
- Total Clients: ${clients.length}
- By Status: ${Object.entries(statusCounts).map(([s, n]) => `${s}: ${n}`).join(", ") || "none"}
- Clients Not Contacted in 14+ Days (${staleClients.length}):
${staleClients.map(c => `  - ${c.name} (${c.status}) — ${c.daysAgo} days since last contact`).join("\n") || "  None — you're on top of it!"}
- Upcoming Showings This Week (${showings.length}):
${showings.map(s => `  - ${s.date}: ${s.address} with ${s.clientName}`).join("\n") || "  No showings scheduled"}`;
      }

      const Anthropic = require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: anthropicKey.value() });

      const userMessage = contextText
        ? `Here is the current data:\n${contextText}\n\nMy question: ${question}`
        : question;

      const response = await client.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }]
      });

      const text = response.content
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("\n");

      return { response: text };

    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("askAssistant error:", err);
      throw new HttpsError("internal", "Something went wrong. Please try again.");
    }
  }
);

/* ================================================================
   SEND EMAIL VIA SENDGRID
   ================================================================ */

exports.sendEmail = onCall(
  { secrets: [sendgridKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    const { to, toName, subject, body, clientId } = request.data;

    if (!to || !subject || !body) {
      throw new HttpsError("invalid-argument", "Recipient, subject, and body are required.");
    }

    // Verify client ownership if clientId provided
    if (clientId) {
      const clientSnap = await db.doc(`clients/${clientId}`).get();
      if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
        throw new HttpsError("permission-denied", "Access denied.");
      }
    }

    // Get realtor profile for reply-to and signature
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const replyToEmail = userData.email || request.auth.token.email;
    const replyToName = userData.fullName || "GreenDoor Realtor";

    // Append email signature if set
    let htmlBody = body;
    if (userData.emailSignature) {
      htmlBody += `<br><br>--<br>${userData.emailSignature.replace(/\r\n|\r|\n/g, "<br>")}`;
    }

    try {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(sendgridKey.value());

      await sgMail.send({
        to: { email: to, name: toName || "" },
        from: { email: "greendoor@stoekmedia.com", name: "GreenDoor" },
        replyTo: { email: replyToEmail, name: replyToName },
        subject,
        html: htmlBody
      });

      // Log activity
      if (clientId) {
        await db.collection("activities").add({
          clientId,
          realtorId: uid,
          type: "email",
          subject,
          body: htmlBody,
          timestamp: FieldValue.serverTimestamp()
        });

        await db.doc(`clients/${clientId}`).update({
          lastActivityDate: FieldValue.serverTimestamp()
        });
      }

      return { success: true };
    } catch (err) {
      console.error("sendEmail error:", err);
      if (err.response) {
        console.error("SendGrid response:", err.response.body);
      }
      throw new HttpsError("internal", "Failed to send email. Please try again.");
    }
  }
);

/* ================================================================
   SEED DEFAULT EMAIL TEMPLATES
   ================================================================ */

exports.seedEmailTemplates = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    // Check if system templates already exist
    const existing = await db.collection("emailTemplates")
      .where("createdBy", "==", "system")
      .limit(1)
      .get();

    if (!existing.empty) {
      return { seeded: false, message: "Templates already exist." };
    }

    const templates = [
      {
        name: "Welcome Email",
        category: "welcome",
        subject: "Welcome, {{clientName}}!",
        body: `<p>Hi {{clientName}},</p>
<p>Thank you for choosing to work with me on your real estate journey! I'm excited to help you find the perfect home.</p>
<p>Here's what you can expect from me:</p>
<ul>
<li>Regular updates on new listings that match your criteria</li>
<li>Quick responses to any questions you have</li>
<li>Expert guidance through every step of the process</li>
</ul>
<p>Feel free to reach out anytime at {{realtorPhone}} or just reply to this email.</p>
<p>Looking forward to working together!</p>
<p>Best,<br>{{realtorName}}<br>{{realtorCompany}}</p>`
      },
      {
        name: "Post-Showing Follow-up",
        category: "follow_up",
        subject: "Thoughts on the property?",
        body: `<p>Hi {{clientName}},</p>
<p>Thank you for taking the time to tour the property today! I'd love to hear your thoughts.</p>
<p>What did you think? Was there anything you particularly liked or any concerns? Your feedback helps me refine the search and find exactly what you're looking for.</p>
<p>If you'd like to schedule another showing or see similar properties, just let me know!</p>
<p>Best,<br>{{realtorName}}<br>{{realtorCompany}}</p>`
      },
      {
        name: "New Listing Alert",
        category: "showing",
        subject: "A property you might love",
        body: `<p>Hi {{clientName}},</p>
<p>I just came across a listing that I think could be a great fit for you!</p>
<p><strong>[Property details here]</strong></p>
<p>Would you like to schedule a showing? I have availability this week and would love to walk through it with you.</p>
<p>Let me know what you think!</p>
<p>Best,<br>{{realtorName}}<br>{{realtorCompany}}</p>`
      },
      {
        name: "Monthly Check-in",
        category: "follow_up",
        subject: "Quick market update from {{realtorName}}",
        body: `<p>Hi {{clientName}},</p>
<p>Just wanted to check in and see how things are going! The market has been active lately, and I wanted to make sure you're staying informed.</p>
<p>If your timeline or preferences have changed at all, please let me know so I can adjust my search accordingly.</p>
<p>I'm always here if you have any questions about the market or your home search.</p>
<p>Best,<br>{{realtorName}}<br>{{realtorCompany}}</p>`
      },
      {
        name: "Closing Congratulations",
        category: "closing",
        subject: "Congratulations on your new home!",
        body: `<p>Hi {{clientName}},</p>
<p>Congratulations on closing on your new home! It was a pleasure working with you throughout this process.</p>
<p>If you ever need anything — whether it's a recommendation for a contractor, questions about your home, or just want to chat — don't hesitate to reach out.</p>
<p>Also, if you know anyone who's looking to buy or sell, I'd love to help them too. Referrals mean the world to me!</p>
<p>Wishing you all the best in your new home!</p>
<p>Warmly,<br>{{realtorName}}<br>{{realtorCompany}}</p>`
      }
    ];

    const batch = db.batch();
    for (const t of templates) {
      const ref = db.collection("emailTemplates").doc();
      batch.set(ref, {
        ...t,
        createdBy: "system",
        createdAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();

    return { seeded: true, count: templates.length };
  }
);

/* ================================================================
   BOLDSIGN: SEND FOR SIGNATURE
   ================================================================ */

exports.sendForSignature = onCall(
  { secrets: [boldsignKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    const { clientId, fileUrl, fileName, signerEmail, signerName } = request.data;

    if (!clientId || !fileUrl || !fileName || !signerEmail || !signerName) {
      throw new HttpsError("invalid-argument", "All fields are required.");
    }

    // Validate fileUrl to prevent SSRF — only allow Firebase Storage URLs
    if (!fileUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      throw new HttpsError("invalid-argument", "Invalid file URL.");
    }

    // Verify client ownership
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
      throw new HttpsError("permission-denied", "Access denied.");
    }

    try {
      const fetch = require("node-fetch");
      const FormData = require("form-data");

      // Download file from Firebase Storage URL
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error("Failed to download file from storage.");
      }
      const fileBuffer = await fileResponse.buffer();

      // Build multipart form for BoldSign REST API
      const form = new FormData();
      form.append("Files", fileBuffer, { filename: fileName, contentType: "application/pdf" });
      form.append("Title", fileName);
      form.append("Signers[0][Name]", signerName);
      form.append("Signers[0][EmailAddress]", signerEmail);
      form.append("Signers[0][SignerType]", "Signer");
      form.append("Signers[0][FormFields][0][FieldType]", "Signature");
      form.append("Signers[0][FormFields][0][PageNumber]", "1");
      form.append("Signers[0][FormFields][0][Bounds][X]", "100");
      form.append("Signers[0][FormFields][0][Bounds][Y]", "100");
      form.append("Signers[0][FormFields][0][Bounds][Width]", "200");
      form.append("Signers[0][FormFields][0][Bounds][Height]", "50");

      const bsResponse = await fetch("https://api.boldsign.com/v1/document/send", {
        method: "POST",
        headers: {
          "X-API-KEY": boldsignKey.value(),
          ...form.getHeaders()
        },
        body: form
      });

      if (!bsResponse.ok) {
        const errorText = await bsResponse.text();
        console.error("BoldSign send error:", bsResponse.status, errorText);
        throw new Error("BoldSign API error: " + bsResponse.status);
      }

      const bsData = await bsResponse.json();
      const documentId = bsData.documentId;

      // Store envelope in Firestore
      await db.doc(`envelopes/${documentId}`).set({
        documentId,
        clientId,
        realtorId: uid,
        fileName,
        signerEmail,
        signerName,
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        firebaseFileUrl: fileUrl,
        signedDocumentUrl: null
      });

      // Log activity
      await db.collection("activities").add({
        clientId,
        realtorId: uid,
        type: "email",
        subject: "Sent for signature: " + fileName,
        body: "Sent to " + signerName + " (" + signerEmail + ") via BoldSign",
        timestamp: FieldValue.serverTimestamp()
      });

      await db.doc(`clients/${clientId}`).update({
        lastActivityDate: FieldValue.serverTimestamp()
      });

      return { success: true, documentId };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("sendForSignature error:", err);
      throw new HttpsError("internal", "Failed to send document for signature.");
    }
  }
);

/* ================================================================
   BOLDSIGN: CHECK SIGNATURE STATUS
   ================================================================ */

async function handleCompletedDocument(documentId, envelopeData, apiKey) {
  // Guard against duplicate processing
  const currentSnap = await db.doc(`envelopes/${documentId}`).get();
  if (currentSnap.exists && currentSnap.data().signedDocumentUrl) {
    console.log("Document already processed, skipping:", documentId);
    return;
  }

  const fetch = require("node-fetch");

  // Download signed document from BoldSign
  const downloadResponse = await fetch(
    `https://api.boldsign.com/v1/document/download?documentId=${documentId}`,
    { headers: { "X-API-KEY": apiKey } }
  );

  if (!downloadResponse.ok) {
    console.error("Failed to download signed document:", downloadResponse.status);
    return;
  }

  const signedBuffer = await downloadResponse.buffer();

  // Upload to Firebase Storage
  const bucket = getStorage().bucket();
  const signedFileName = `SIGNED_${envelopeData.fileName}`;
  const storagePath = `files/${envelopeData.realtorId}/${envelopeData.clientId}/contracts/${signedFileName}`;
  const file = bucket.file(storagePath);

  const downloadToken = crypto.randomUUID();
  await file.save(signedBuffer, {
    contentType: "application/pdf",
    metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } }
  });

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

  // Create file record
  await db.collection("files").add({
    clientId: envelopeData.clientId,
    realtorId: envelopeData.realtorId,
    fileName: signedFileName,
    storagePath,
    downloadUrl,
    folder: "contracts",
    fileSize: signedBuffer.length,
    mimeType: "application/pdf",
    uploadedAt: FieldValue.serverTimestamp()
  });

  // Update envelope
  await db.doc(`envelopes/${documentId}`).update({
    status: "completed",
    signedDocumentUrl: downloadUrl
  });

  // Log activity
  await db.collection("activities").add({
    clientId: envelopeData.clientId,
    realtorId: envelopeData.realtorId,
    type: "file_share",
    subject: "Document signed: " + envelopeData.fileName,
    body: "Signed by " + envelopeData.signerName,
    timestamp: FieldValue.serverTimestamp()
  });

  await db.doc(`clients/${envelopeData.clientId}`).update({
    lastActivityDate: FieldValue.serverTimestamp()
  });
}

exports.checkSignatureStatus = onCall(
  { secrets: [boldsignKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    const { documentId } = request.data;

    if (!documentId) {
      throw new HttpsError("invalid-argument", "Document ID is required.");
    }

    // Verify envelope ownership
    const envelopeSnap = await db.doc(`envelopes/${documentId}`).get();
    if (!envelopeSnap.exists || envelopeSnap.data().realtorId !== uid) {
      throw new HttpsError("permission-denied", "Access denied.");
    }

    try {
      const fetch = require("node-fetch");

      const statusResponse = await fetch(
        `https://api.boldsign.com/v1/document/properties?documentId=${documentId}`,
        { headers: { "X-API-KEY": boldsignKey.value() } }
      );

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        console.error("BoldSign status error:", statusResponse.status, errorText);
        throw new Error("BoldSign API error");
      }

      const docDetails = await statusResponse.json();
      const status = (docDetails.status || "").toLowerCase().replace(/\s/g, "_");

      // Update envelope status
      await db.doc(`envelopes/${documentId}`).update({ status });

      // If completed, download and file the signed document
      if (status === "completed") {
        const envelopeData = envelopeSnap.data();
        await handleCompletedDocument(documentId, envelopeData, boldsignKey.value());
      }

      return { status, updatedAt: new Date().toISOString() };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("checkSignatureStatus error:", err);
      throw new HttpsError("internal", "Failed to check signature status.");
    }
  }
);

/* ================================================================
   BOLDSIGN: WEBHOOK HANDLER
   ================================================================ */

exports.boldSignWebhook = onRequest(
  { secrets: [boldsignKey, boldsignWebhookSecret], region: "us-central1" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    // Verify webhook signature (skip if secret not configured yet)
    const secret = boldsignWebhookSecret.value();
    if (secret) {
      const sigHeader = req.headers["x-boldsign-signature"] || "";
      if (sigHeader) {
        const parts = {};
        sigHeader.split(",").forEach(p => {
          const [k, v] = p.trim().split("=", 2);
          if (k && v) parts[k] = v;
        });

        const timestamp = parts.t;
        const receivedSig = parts.s0;

        if (!timestamp || !receivedSig) {
          res.status(401).send("Invalid signature header");
          return;
        }

        // Reject requests older than 5 minutes (replay protection)
        const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
        if (Math.abs(age) > 300) {
          res.status(401).send("Request too old");
          return;
        }

        const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
        const expectedSig = crypto.createHmac("sha256", secret)
          .update(timestamp + "." + rawBody, "utf8")
          .digest("hex");

        try {
          const valid = crypto.timingSafeEqual(
            Buffer.from(expectedSig, "hex"),
            Buffer.from(receivedSig, "hex")
          );
          if (!valid) {
            res.status(401).send("Signature mismatch");
            return;
          }
        } catch {
          res.status(401).send("Signature mismatch");
          return;
        }
      }
    }

    try {
      const payload = req.body;
      const event = payload.event || {};
      const eventType = (event.eventType || payload.eventType || "").toLowerCase();
      const documentId = event.documentId || payload.documentId;

      console.log("BoldSign webhook received:", eventType, documentId);

      if (!documentId) {
        // Verification or unknown payload — return 200 to acknowledge
        res.status(200).send("OK");
        return;
      }

      // Find the envelope
      const envelopeSnap = await db.doc(`envelopes/${documentId}`).get();
      if (!envelopeSnap.exists) {
        console.log("Envelope not found for documentId:", documentId);
        res.status(200).send("OK");
        return;
      }

      // Map BoldSign event types to our status
      const statusMap = {
        sent: "sent",
        viewed: "viewed",
        signed: "signed",
        completed: "completed",
        declined: "declined",
        revoked: "revoked",
        expired: "expired"
      };

      const newStatus = statusMap[eventType] || eventType;
      await db.doc(`envelopes/${documentId}`).update({ status: newStatus });

      // If completed, download and file the signed document
      if (newStatus === "completed") {
        const envelopeData = envelopeSnap.data();
        await handleCompletedDocument(documentId, envelopeData, boldsignKey.value());
      }

      res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(500).send("Internal error");
    }
  }
);
