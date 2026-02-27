const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
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

const SYSTEM_PROMPT = `You are GreenDoor AI, an intelligent assistant for real estate professionals. You help realtors manage their clients, draft communications, analyze client preferences, and make smart recommendations. Be concise, professional, and actionable. When drafting emails, write them ready to send — not as templates with brackets. Use the client's actual name and details. Format emails with proper greeting and sign-off. When making suggestions, be specific and reference actual data from the client's history. Use markdown formatting: **bold** for emphasis, bullet points for lists.

You have tools to take actions on behalf of the realtor. When the user asks you to create a client, update client info, log an activity, or search for clients — use the appropriate tool instead of just describing what to do. After using a tool, confirm what you did in plain language.`;

/* --- AI Tool Definitions --- */
const AI_TOOLS = [
  {
    name: "create_client",
    description: "Create a new client in the CRM. Use when the realtor asks to add a new lead or client.",
    input_schema: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "Client's full name" },
        email: { type: "string", description: "Client's email address" },
        phone: { type: "string", description: "Client's phone number" },
        status: { type: "string", enum: ["lead", "active_buyer", "active_seller", "under_contract", "closed", "inactive"], description: "Client status (default: lead)" },
        source: { type: "string", description: "How the client was acquired (e.g. referral, zillow, open_house)" },
        notes: { type: "string", description: "Any initial notes about the client" }
      },
      required: ["fullName"]
    }
  },
  {
    name: "update_client",
    description: "Update fields on the current client. Use when the realtor asks to change status, budget, timeline, notes, or other client details.",
    input_schema: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "Client's full name" },
        email: { type: "string", description: "Client's email" },
        phone: { type: "string", description: "Client's phone" },
        status: { type: "string", enum: ["lead", "active_buyer", "active_seller", "under_contract", "closed", "inactive"], description: "Client status" },
        source: { type: "string", description: "Lead source" },
        timeline: { type: "string", description: "Buying/selling timeline" },
        budgetMin: { type: "number", description: "Minimum budget" },
        budgetMax: { type: "number", description: "Maximum budget" },
        preferredLocations: { type: "array", items: { type: "string" }, description: "Preferred locations" },
        propertyTypes: { type: "array", items: { type: "string" }, description: "Property types of interest" },
        bedsMin: { type: "number", description: "Minimum bedrooms" },
        bedsMax: { type: "number", description: "Maximum bedrooms" },
        bathsMin: { type: "number", description: "Minimum bathrooms" },
        bathsMax: { type: "number", description: "Maximum bathrooms" },
        sqftMin: { type: "number", description: "Minimum square footage" },
        sqftMax: { type: "number", description: "Maximum square footage" },
        mustHaveFeatures: { type: "array", items: { type: "string" }, description: "Must-have features" },
        preApprovalStatus: { type: "string", description: "Pre-approval status" },
        preApprovalAmount: { type: "number", description: "Pre-approval amount" },
        notes: { type: "string", description: "Client notes" }
      },
      required: []
    }
  },
  {
    name: "log_activity",
    description: "Log an activity (note, call, showing, etc.) on the current client's timeline.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["note", "call", "email", "sms", "showing"], description: "Activity type" },
        subject: { type: "string", description: "Short subject/title for the activity" },
        body: { type: "string", description: "Detailed description or notes" }
      },
      required: ["type", "subject"]
    }
  },
  {
    name: "search_clients",
    description: "Search the realtor's clients by name or status. Use when the realtor asks to find or list clients.",
    input_schema: {
      type: "object",
      properties: {
        nameQuery: { type: "string", description: "Partial or full name to search for (case-insensitive)" },
        status: { type: "string", enum: ["lead", "active_buyer", "active_seller", "under_contract", "closed", "inactive"], description: "Filter by status" }
      },
      required: []
    }
  }
];

const UPDATE_CLIENT_ALLOWLIST = new Set([
  "fullName", "email", "phone", "status", "source", "timeline",
  "budgetMin", "budgetMax", "preferredLocations", "propertyTypes",
  "bedsMin", "bedsMax", "bathsMin", "bathsMax", "sqftMin", "sqftMax",
  "mustHaveFeatures", "preApprovalStatus", "preApprovalAmount", "notes"
]);

/* --- AI Tool Handlers --- */
async function handleCreateClient(input, uid) {
  const data = {
    fullName: input.fullName || "Unknown",
    email: input.email || "",
    phone: input.phone || "",
    status: input.status || "lead",
    source: input.source || "",
    notes: input.notes || "",
    realtorId: uid,
    createdAt: FieldValue.serverTimestamp(),
    lastActivityDate: FieldValue.serverTimestamp()
  };

  const docRef = await db.collection("clients").add(data);

  // Log creation activity
  await db.collection("activities").add({
    clientId: docRef.id,
    realtorId: uid,
    type: "note",
    subject: "Client created via AI",
    body: `Added ${data.fullName} as a new ${data.status}`,
    timestamp: FieldValue.serverTimestamp()
  });

  return { success: true, clientId: docRef.id, fullName: data.fullName, status: data.status };
}

async function handleUpdateClient(input, uid, clientId) {
  if (!clientId) {
    return { success: false, error: "No client context — update_client requires a client detail page." };
  }

  // Verify ownership
  const clientSnap = await db.doc(`clients/${clientId}`).get();
  if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
    return { success: false, error: "Client not found or access denied." };
  }

  // Filter to allowlisted fields only
  const updates = {};
  for (const [key, value] of Object.entries(input)) {
    if (UPDATE_CLIENT_ALLOWLIST.has(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, error: "No valid fields to update." };
  }

  await db.doc(`clients/${clientId}`).update(updates);
  return { success: true, updatedFields: Object.keys(updates) };
}

async function handleLogActivity(input, uid, clientId) {
  if (!clientId) {
    return { success: false, error: "No client context — log_activity requires a client detail page." };
  }

  // Verify ownership
  const clientSnap = await db.doc(`clients/${clientId}`).get();
  if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
    return { success: false, error: "Client not found or access denied." };
  }

  await db.collection("activities").add({
    clientId,
    realtorId: uid,
    type: input.type || "note",
    subject: input.subject,
    body: input.body || "",
    timestamp: FieldValue.serverTimestamp()
  });

  await db.doc(`clients/${clientId}`).update({
    lastActivityDate: FieldValue.serverTimestamp()
  });

  return { success: true, type: input.type, subject: input.subject };
}

async function handleSearchClients(input, uid) {
  let q = db.collection("clients").where("realtorId", "==", uid);
  if (input.status) {
    q = q.where("status", "==", input.status);
  }

  const snap = await q.get();
  let results = snap.docs.map(d => ({
    id: d.id,
    fullName: d.data().fullName,
    email: d.data().email,
    phone: d.data().phone,
    status: d.data().status,
    lastActivity: d.data().lastActivityDate ? d.data().lastActivityDate.toDate().toISOString() : null
  }));

  // Client-side name filtering
  if (input.nameQuery) {
    const query = input.nameQuery.toLowerCase();
    results = results.filter(c => c.fullName && c.fullName.toLowerCase().includes(query));
  }

  return { success: true, count: results.length, clients: results.slice(0, 20) };
}

async function executeToolCall(toolName, toolInput, uid, clientId) {
  switch (toolName) {
    case "create_client": return handleCreateClient(toolInput, uid);
    case "update_client": return handleUpdateClient(toolInput, uid, clientId);
    case "log_activity": return handleLogActivity(toolInput, uid, clientId);
    case "search_clients": return handleSearchClients(toolInput, uid);
    default: return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

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

        // Add showings context
        const showingsSnap = await db.collection("showings")
          .where("clientId", "==", clientId)
          .where("realtorId", "==", uid)
          .orderBy("showingDate", "desc")
          .limit(10)
          .get();
        const showingsData = showingsSnap.docs.map(d => {
          const s = d.data();
          return {
            address: s.address,
            date: s.showingDate ? s.showingDate.toDate().toISOString() : "unknown",
            status: s.status,
            rating: s.clientRating,
            feedback: s.clientFeedback
          };
        });

        contextText += `

SHOWINGS (${showingsData.length}):
${showingsData.map(s => `- ${s.address} | ${s.date} | ${s.status}${s.rating ? " | Rating: " + s.rating + "/5" : ""}${s.feedback ? " | " + s.feedback : ""}`).join("\n") || "No showings"}`;

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

        // Add showings from new collection
        const newShowingsSnap = await db.collection("showings")
          .where("realtorId", "==", uid)
          .where("showingDate", ">=", nowTs)
          .where("showingDate", "<=", weekFromNow)
          .get();
        if (!newShowingsSnap.empty) {
          const newShowings = newShowingsSnap.docs.map(d => {
            const s = d.data();
            return `  - ${s.showingDate.toDate().toISOString()}: ${s.address} with ${clientMap[s.clientId] || "Unknown"}`;
          });
          contextText += `\n- Scheduled Showings This Week (${newShowings.length}):\n${newShowings.join("\n")}`;
        }

        // Add pending follow-ups
        const followUpsSnap = await db.collection("followUps")
          .where("realtorId", "==", uid)
          .where("status", "==", "pending")
          .get();
        if (!followUpsSnap.empty) {
          const fups = followUpsSnap.docs.map(d => {
            const f = d.data();
            return `  - ${f.title} | Due: ${f.dueDate ? f.dueDate.toDate().toISOString().slice(0, 10) : "?"} | Priority: ${f.priority || "medium"} | Client: ${clientMap[f.clientId] || "Unknown"}`;
          });
          contextText += `\n- Pending Follow-ups (${fups.length}):\n${fups.join("\n")}`;
        }
      }

      const Anthropic = require("@anthropic-ai/sdk");
      const anthropicClient = new Anthropic({ apiKey: anthropicKey.value() });

      const userMessage = contextText
        ? `Here is the current data:\n${contextText}\n\nMy question: ${question}`
        : question;

      // Context-conditional tool selection
      let tools;
      if (context === "client_detail" && clientId) {
        tools = AI_TOOLS; // all 4 tools
      } else if (context === "dashboard") {
        tools = AI_TOOLS.filter(t => t.name === "create_client" || t.name === "search_clients");
      } else {
        tools = [];
      }

      // Agentic loop — up to 5 rounds
      const messages = [{ role: "user", content: userMessage }];
      const actionsPerformed = [];
      const MAX_ROUNDS = 5;

      let finalText = "";
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const apiParams = {
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages
        };
        if (tools.length > 0) {
          apiParams.tools = tools;
        }

        const response = await anthropicClient.messages.create(apiParams);

        // Check if the model wants to use tools
        if (response.stop_reason === "tool_use") {
          // Add assistant message with full content (text + tool_use blocks)
          messages.push({ role: "assistant", content: response.content });

          // Process each tool use block
          const toolResults = [];
          for (const block of response.content) {
            if (block.type === "tool_use") {
              const result = await executeToolCall(block.name, block.input, uid, clientId);
              actionsPerformed.push(block.name);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result)
              });
            }
          }

          // Add tool results as user message and continue loop
          messages.push({ role: "user", content: toolResults });
        } else {
          // end_turn — extract text and break
          finalText = response.content
            .filter(block => block.type === "text")
            .map(block => block.text)
            .join("\n");
          break;
        }
      }

      return { response: finalText, actionsPerformed };

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
   SHARE DOCUMENT VIA EMAIL
   ================================================================ */

exports.shareDocument = onCall(
  { secrets: [sendgridKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    const { clientId, files, to, cc, subject, message } = request.data;

    if (!clientId || !to || !subject || !files || !files.length) {
      throw new HttpsError("invalid-argument", "Recipient, subject, and at least one file are required.");
    }

    // Validate all file URLs
    for (const f of files) {
      if (!f.downloadUrl || !f.downloadUrl.startsWith("https://firebasestorage.googleapis.com/")) {
        throw new HttpsError("invalid-argument", "Invalid file URL.");
      }
    }

    // Verify client ownership
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
      throw new HttpsError("permission-denied", "Access denied.");
    }

    // Get realtor profile
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const replyToEmail = userData.email || request.auth.token.email;
    const replyToName = userData.fullName || "GreenDoor Realtor";

    // Build HTML email
    const fileLinks = files.map(f =>
      `<li><a href="${f.downloadUrl}" style="color:#16a34a;">${f.fileName}</a></li>`
    ).join("");

    let htmlBody = `${(message || "").replace(/\n/g, "<br>")}
<br><br><strong>Shared Documents:</strong>
<ul>${fileLinks}</ul>`;

    if (userData.emailSignature) {
      htmlBody += `<br>--<br>${userData.emailSignature.replace(/\r\n|\r|\n/g, "<br>")}`;
    }

    try {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(sendgridKey.value());

      const msg = {
        to: { email: to },
        from: { email: "greendoor@stoekmedia.com", name: "GreenDoor" },
        replyTo: { email: replyToEmail, name: replyToName },
        subject,
        html: htmlBody
      };
      if (cc) msg.cc = { email: cc };

      await sgMail.send(msg);

      // Log activity
      const fileNames = files.map(f => f.fileName).join(", ");
      await db.collection("activities").add({
        clientId,
        realtorId: uid,
        type: "file_share",
        subject: `Shared ${files.length} file(s): ${fileNames}`,
        body: `Sent to ${to}${cc ? `, CC: ${cc}` : ""}`,
        timestamp: FieldValue.serverTimestamp()
      });

      await db.doc(`clients/${clientId}`).update({
        lastActivityDate: FieldValue.serverTimestamp()
      });

      return { success: true };
    } catch (err) {
      console.error("shareDocument error:", err);
      throw new HttpsError("internal", "Failed to share document.");
    }
  }
);

/* ================================================================
   BOLDSIGN: SEND FOR SIGNATURE (Multi-doc/signer)
   ================================================================ */

exports.sendForSignature = onCall(
  { secrets: [boldsignKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    let { clientId, fileUrl, fileName, signerEmail, signerName, files, signers, title, message, expiryDays } = request.data;

    // Normalize legacy single-file/signer to arrays
    if (!files && fileUrl && fileName) {
      files = [{ fileUrl, fileName }];
    }
    if (!signers && signerEmail && signerName) {
      signers = [{ name: signerName, email: signerEmail, order: 1 }];
    }

    if (!clientId || !files || !files.length || !signers || !signers.length) {
      throw new HttpsError("invalid-argument", "Client, at least one file, and at least one signer are required.");
    }

    // Validate all file URLs
    for (const f of files) {
      if (!f.fileUrl || !f.fileUrl.startsWith("https://firebasestorage.googleapis.com/")) {
        throw new HttpsError("invalid-argument", "Invalid file URL.");
      }
    }

    // Verify client ownership
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
      throw new HttpsError("permission-denied", "Access denied.");
    }

    const envelopeTitle = title || files.map(f => f.fileName).join(", ");

    try {
      const fetch = require("node-fetch");
      const FormData = require("form-data");
      const form = new FormData();

      // Download and append all files
      for (const f of files) {
        const fileResponse = await fetch(f.fileUrl);
        if (!fileResponse.ok) throw new Error("Failed to download file: " + f.fileName);
        const fileBuffer = await fileResponse.buffer();
        form.append("Files", fileBuffer, { filename: f.fileName, contentType: "application/pdf" });
      }

      form.append("Title", envelopeTitle);
      if (message) form.append("Message", message);
      if (expiryDays) form.append("ExpiryDays", String(expiryDays));
      if (signers.length > 1) form.append("EnableSigningOrder", "true");
      form.append("EnableAutoReminder", "true");

      // Append signers
      signers.forEach((s, i) => {
        form.append(`Signers[${i}][Name]`, s.name);
        form.append(`Signers[${i}][EmailAddress]`, s.email);
        form.append(`Signers[${i}][SignerType]`, "Signer");
        form.append(`Signers[${i}][SignerOrder]`, String(s.order || i + 1));
        form.append(`Signers[${i}][FormFields][0][FieldType]`, "Signature");
        form.append(`Signers[${i}][FormFields][0][PageNumber]`, "1");
        form.append(`Signers[${i}][FormFields][0][Bounds][X]`, "100");
        form.append(`Signers[${i}][FormFields][0][Bounds][Y]`, String(100 + i * 80));
        form.append(`Signers[${i}][FormFields][0][Bounds][Width]`, "200");
        form.append(`Signers[${i}][FormFields][0][Bounds][Height]`, "50");
      });

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

      // Store envelope — support both legacy and new fields
      const envelopeData = {
        documentId,
        clientId,
        realtorId: uid,
        title: envelopeTitle,
        files: files.map(f => ({ fileName: f.fileName, fileUrl: f.fileUrl })),
        signers: signers.map(s => ({ name: s.name, email: s.email, order: s.order || 1, status: "sent" })),
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        signedDocumentUrl: null,
        // Legacy compat
        fileName: files[0].fileName,
        signerEmail: signers[0].email,
        signerName: signers[0].name,
        firebaseFileUrl: files[0].fileUrl
      };

      await db.doc(`envelopes/${documentId}`).set(envelopeData);

      // Log activity
      await db.collection("activities").add({
        clientId,
        realtorId: uid,
        type: "email",
        subject: `Sent for signature: ${envelopeTitle}`,
        body: `${files.length} doc(s) sent to ${signers.map(s => s.name).join(", ")} via BoldSign`,
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

      // Update per-signer statuses if available
      const updateData = { status };
      const envelopeData = envelopeSnap.data();
      if (docDetails.signerDetails && envelopeData.signers) {
        const updatedSigners = envelopeData.signers.map(s => {
          const match = docDetails.signerDetails.find(
            sd => sd.signerEmail?.toLowerCase() === s.email?.toLowerCase()
          );
          if (match) {
            s.status = (match.status || "sent").toLowerCase().replace(/\s/g, "_");
          }
          return s;
        });
        updateData.signers = updatedSigners;
      }

      await db.doc(`envelopes/${documentId}`).update(updateData);

      // If completed, download and file the signed document
      if (status === "completed") {
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

/* ================================================================
   INVITE REALTOR
   ================================================================ */

function buildWelcomeEmail(name, resetLink) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;max-width:560px;width:100%;">
  <tr><td style="background:#16a34a;padding:32px 40px;text-align:center;">
    <span style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Green</span><span style="font-size:28px;font-weight:700;color:#dcfce7;letter-spacing:-0.5px;">Door</span>
  </td></tr>
  <tr><td style="padding:40px;">
    <p style="font-size:18px;font-weight:600;color:#1c1917;margin:0 0 16px;">Welcome to GreenDoor, ${name}!</p>
    <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0 0 24px;">Your account has been created. GreenDoor is your all-in-one CRM for managing clients, tracking properties, sending documents, and growing your real estate business.</p>
    <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0 0 24px;">Click the button below to set your password and get started:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;"><tr><td style="background:#16a34a;padding:14px 32px;text-align:center;">
      <a href="${resetLink}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;display:inline-block;">Set Your Password</a>
    </td></tr></table>
    <p style="font-size:13px;color:#9ca3af;line-height:1.6;margin:0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="font-size:13px;color:#16a34a;word-break:break-all;margin:0 0 24px;">${resetLink}</p>
    <p style="font-size:13px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;margin:0;">This link will expire in 1 hour. If you didn't expect this email, you can safely ignore it.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

exports.inviteRealtor = onCall(
  { secrets: [sendgridKey], region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    // Verify caller is admin
    const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data().role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can invite realtors.");
    }

    const { email, fullName, company } = request.data;

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "A valid email address is required.");
    }
    if (!fullName || typeof fullName !== "string") {
      throw new HttpsError("invalid-argument", "Full name is required.");
    }

    const auth = getAuth();

    // Check if user already exists
    try {
      await auth.getUserByEmail(email);
      throw new HttpsError("already-exists", "A user with this email already exists.");
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      // auth/user-not-found is expected — proceed
      if (err.code !== "auth/user-not-found") {
        console.error("getUserByEmail error:", err);
        throw new HttpsError("internal", "Failed to check existing user.");
      }
    }

    try {
      // Create Firebase Auth user with random temp password
      const tempPassword = crypto.randomBytes(16).toString("hex");
      const userRecord = await auth.createUser({
        email,
        password: tempPassword,
        displayName: fullName
      });

      // Create Firestore user doc
      await db.doc(`users/${userRecord.uid}`).set({
        fullName,
        email,
        company: company || "",
        role: "realtor",
        isActive: true,
        onboardingComplete: false,
        createdAt: FieldValue.serverTimestamp(),
        invitedBy: request.auth.uid
      });

      // Generate password reset link
      const resetLink = await auth.generatePasswordResetLink(email, {
        url: "https://stoekmedia.com/greendoor/app/login"
      });

      // Send branded welcome email
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(sendgridKey.value());

      await sgMail.send({
        to: { email, name: fullName },
        from: { email: "greendoor@stoekmedia.com", name: "GreenDoor" },
        subject: "Welcome to GreenDoor — Set Your Password",
        html: buildWelcomeEmail(fullName, resetLink)
      });

      return { success: true, uid: userRecord.uid };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("inviteRealtor error:", err);
      throw new HttpsError("internal", "Failed to invite realtor. Please try again.");
    }
  }
);
