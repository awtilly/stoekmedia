const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const anthropicKey = defineSecret("ANTHROPIC_API_KEY");

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

    // Rate limiting: 50 requests per day
    const today = new Date().toISOString().slice(0, 10);
    const rateLimitRef = db.doc(`rateLimits/${uid}`);
    const rateLimitSnap = await rateLimitRef.get();
    const rateLimitData = rateLimitSnap.exists ? rateLimitSnap.data() : {};

    if (rateLimitData.date === today && rateLimitData.count >= 50) {
      throw new HttpsError("resource-exhausted", "Daily AI limit reached (50 requests). Try again tomorrow.");
    }

    if (rateLimitData.date === today) {
      await rateLimitRef.update({ count: FieldValue.increment(1) });
    } else {
      await rateLimitRef.set({ date: today, count: 1 });
    }

    let contextText = "";

    try {
      if (clientId && context === "client_detail") {
        // Fetch client data and verify ownership
        const clientSnap = await db.doc(`clients/${clientId}`).get();
        if (!clientSnap.exists) {
          throw new HttpsError("not-found", "Client not found.");
        }
        const client = clientSnap.data();
        if (client.realtorId !== uid) {
          throw new HttpsError("permission-denied", "You do not have access to this client.");
        }

        // Fetch activities
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

        // Fetch properties
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

        // Fetch file names
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
        // Dashboard summary
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

        // Upcoming showings in next 7 days
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

      // Call Anthropic API
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
