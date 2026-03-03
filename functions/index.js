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

const SYSTEM_PROMPT = `You are GreenDoor AI, an intelligent voice-first assistant for real estate professionals. You help realtors manage their clients, schedule showings, set follow-ups, and keep their CRM up to date — all through natural conversation.

CORE BEHAVIOR:
- Understand casual, messy, spoken language. Realtors talk fast — they'll say "Thursday" not "2026-02-27". They'll say "John" not "John Smith". Handle typos, abbreviations, and incomplete sentences.
- When you can figure out what they mean, just do it. Don't ask for clarification you don't need.
- When critical info is missing (like a date for a showing, or which client they mean when there are multiple matches), ask a short follow-up question. Keep it conversational, not robotic.
- Today's date is ${new Date().toISOString().slice(0, 10)} (${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getDay()]}). Use this to resolve relative dates: "Thursday" = the coming Thursday, "next week" = next Monday, "tomorrow" = the next day, etc.
- After taking an action, confirm briefly what you did. Example: "Done — scheduled a showing at 455 W Test St for Thursday at 10:30 AM."

MATCHING CLIENTS:
- When the user mentions a name, fuzzy-match it against the client list in context. "John" matches "John Smith" if there's only one John. If ambiguous, ask: "I see John Smith and John Davis — which one?"
- If you're already on a client's detail page, assume they mean that client unless they specify otherwise.

DRAFTING EMAILS:
- Write emails ready to send — no brackets or placeholders. Use the client's real name and details.
- Format with proper greeting and sign-off.

TOOLS:
- You have tools to create showings, follow-ups, events, update clients, log activities, and more. Use them proactively when the user's intent is clear.
- If the user says something like "I have a showing with John Thursday at 10:30 at 455 W Test St" — use create_showing immediately.
- If they say "remind me to call Sarah next Monday" — use create_followup.
- If they say "add a team meeting Friday at 2pm" — use create_event.

Use markdown formatting: **bold** for emphasis, bullet points for lists. Be concise and actionable.`;

/* --- AI Tool Definitions --- */
const AI_TOOLS = [
  {
    name: "create_client",
    description: "Create a new client in the CRM with full profile details. Always extract structured data into the proper fields — never put budget, pre-approval, location, or property preferences into notes. Use notes only for truly unstructured info.",
    input_schema: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "Client's full name" },
        email: { type: "string", description: "Client's email address" },
        phone: { type: "string", description: "Client's phone number" },
        status: { type: "string", enum: ["lead", "active_buyer", "active_seller", "under_contract", "closed", "inactive"], description: "Client status (default: lead)" },
        source: { type: "string", description: "How the client was acquired (e.g. referral, zillow, open_house)" },
        timeline: { type: "string", description: "Buying/selling timeline (e.g. '1-3 months', 'ASAP', 'spring 2026')" },
        budgetMin: { type: "number", description: "Minimum budget in dollars" },
        budgetMax: { type: "number", description: "Maximum budget in dollars" },
        preferredLocations: { type: "array", items: { type: "string" }, description: "Preferred cities, neighborhoods, or areas" },
        propertyTypes: { type: "array", items: { type: "string" }, description: "Property types of interest (e.g. Single Family, Condo, Townhouse)" },
        bedsMin: { type: "number", description: "Minimum bedrooms" },
        bedsMax: { type: "number", description: "Maximum bedrooms" },
        bathsMin: { type: "number", description: "Minimum bathrooms" },
        bathsMax: { type: "number", description: "Maximum bathrooms" },
        sqftMin: { type: "number", description: "Minimum square footage" },
        sqftMax: { type: "number", description: "Maximum square footage" },
        mustHaveFeatures: { type: "array", items: { type: "string" }, description: "Must-have features (e.g. pool, garage, fenced yard)" },
        preApprovalStatus: { type: "string", description: "Pre-approval status (e.g. 'pre-approved', 'pre-qualified', 'not started', 'in progress')" },
        preApprovalAmount: { type: "number", description: "Pre-approval amount in dollars" },
        notes: { type: "string", description: "Any additional unstructured notes (do NOT put budget, pre-approval, or preferences here — use the dedicated fields)" }
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
  },
  {
    name: "create_showing",
    description: "Schedule a property showing for a client. Use when the realtor says they have a showing, wants to schedule one, or mentions showing a property. Resolve relative dates like 'Thursday' or 'next Tuesday' to actual ISO dates before calling.",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Property address for the showing" },
        showingDate: { type: "string", description: "ISO 8601 datetime string for the showing start (e.g. 2026-03-05T10:30:00)" },
        duration: { type: "number", description: "Duration in minutes (default: 60)" },
        mlsNumber: { type: "string", description: "MLS number if known" },
        listingPrice: { type: "number", description: "Listing price if known" },
        notes: { type: "string", description: "Any notes about the showing" },
        clientId: { type: "string", description: "Client ID. Use the current client if on client detail page, or resolve from name if mentioned." },
        createFollowUp: { type: "boolean", description: "Whether to auto-create a follow-up reminder for the day after (default: true)" }
      },
      required: ["address", "showingDate"]
    }
  },
  {
    name: "update_showing",
    description: "Update an existing showing — reschedule, complete, or cancel it. Use when the realtor wants to change a showing's time, mark it done, or cancel it.",
    input_schema: {
      type: "object",
      properties: {
        showingId: { type: "string", description: "The showing document ID" },
        showingDate: { type: "string", description: "New ISO 8601 datetime if rescheduling" },
        status: { type: "string", enum: ["scheduled", "completed", "cancelled"], description: "New status" },
        clientRating: { type: "number", description: "Client rating 1-5 (when completing)" },
        clientFeedback: { type: "string", description: "Client feedback (when completing)" },
        realtorNotes: { type: "string", description: "Realtor notes" }
      },
      required: ["showingId"]
    }
  },
  {
    name: "create_followup",
    description: "Create a follow-up reminder. Use when the realtor says 'remind me', 'follow up', 'don't forget to', or anything about a future task related to a client.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the follow-up (e.g. 'Call Sarah about listing')" },
        dueDate: { type: "string", description: "ISO 8601 date string for when it's due (e.g. 2026-03-05)" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Priority level (default: medium)" },
        notes: { type: "string", description: "Additional notes" },
        clientId: { type: "string", description: "Client ID if associated with a client" }
      },
      required: ["title", "dueDate"]
    }
  },
  {
    name: "create_event",
    description: "Create a calendar event. Use when the realtor wants to add a meeting, appointment, or any time-blocked event that isn't a property showing.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        startDate: { type: "string", description: "ISO 8601 datetime for event start" },
        endDate: { type: "string", description: "ISO 8601 datetime for event end (default: 1 hour after start)" },
        allDay: { type: "boolean", description: "Whether it's an all-day event" },
        description: { type: "string", description: "Event description" },
        color: { type: "string", description: "Event color: #3b82f6 (blue), #22c55e (green), #f59e0b (amber), #ef4444 (red), #8b5cf6 (purple)" },
        clientId: { type: "string", description: "Associated client ID if relevant" }
      },
      required: ["title", "startDate"]
    }
  },
  {
    name: "add_listing",
    description: "Add a new listing to the shared listings database.",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Full street address" },
        city: { type: "string", description: "City" },
        state: { type: "string", description: "State (2-letter code)" },
        zip: { type: "string", description: "ZIP code" },
        listingPrice: { type: "number", description: "Listing price" },
        bedrooms: { type: "number", description: "Number of bedrooms" },
        bathrooms: { type: "number", description: "Number of bathrooms" },
        squareFeet: { type: "number", description: "Square footage" },
        propertyType: { type: "string", description: "Property type (Single Family, Condo, Townhouse, Multi-Family, Land)" },
        mlsNumber: { type: "string", description: "MLS number" },
        status: { type: "string", enum: ["active", "pending", "sold", "coming_soon", "withdrawn"], description: "Listing status" }
      },
      required: ["address"]
    }
  },
  {
    name: "match_listing_to_client",
    description: "Match an existing listing to a client. Use when the realtor wants to bookmark/assign a listing for a specific client.",
    input_schema: {
      type: "object",
      properties: {
        listingId: { type: "string", description: "The listing document ID to match" },
        clientId: { type: "string", description: "The client document ID to match to" }
      },
      required: ["listingId", "clientId"]
    }
  },
  {
    name: "search_listings",
    description: "Search listings by address, price range, or features. Returns matching listings.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text (address, city, MLS#)" },
        priceMin: { type: "number", description: "Minimum price filter" },
        priceMax: { type: "number", description: "Maximum price filter" },
        bedrooms: { type: "number", description: "Minimum bedrooms" }
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
    timeline: input.timeline || "",
    budgetMin: input.budgetMin || null,
    budgetMax: input.budgetMax || null,
    preferredLocations: input.preferredLocations || [],
    propertyTypes: input.propertyTypes || [],
    bedsMin: input.bedsMin || null,
    bedsMax: input.bedsMax || null,
    bathsMin: input.bathsMin || null,
    bathsMax: input.bathsMax || null,
    sqftMin: input.sqftMin || null,
    sqftMax: input.sqftMax || null,
    mustHaveFeatures: input.mustHaveFeatures || [],
    preApprovalStatus: input.preApprovalStatus || "",
    preApprovalAmount: input.preApprovalAmount || null,
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

async function handleCreateShowing(input, uid, clientId) {
  const resolvedClientId = input.clientId || clientId;
  if (!resolvedClientId) {
    return { success: false, error: "No client specified. Which client is this showing for?" };
  }

  // Verify ownership
  const clientSnap = await db.doc(`clients/${resolvedClientId}`).get();
  if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
    return { success: false, error: "Client not found or access denied." };
  }

  const startDate = new Date(input.showingDate);
  if (isNaN(startDate.getTime())) {
    return { success: false, error: "Invalid date. Please provide a valid date and time." };
  }

  const duration = input.duration || 60;
  const endDate = new Date(startDate.getTime() + duration * 60000);

  const data = {
    clientId: resolvedClientId,
    realtorId: uid,
    address: input.address,
    mlsNumber: input.mlsNumber || "",
    listingPrice: input.listingPrice || null,
    showingDate: Timestamp.fromDate(startDate),
    endDate: Timestamp.fromDate(endDate),
    status: "scheduled",
    realtorNotes: input.notes || "",
    propertyId: null,
    clientRating: null,
    clientFeedback: "",
    disclosuresSent: false,
    followUpId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const showingRef = await db.collection("showings").add(data);

  // Log activity
  await db.collection("activities").add({
    clientId: resolvedClientId,
    realtorId: uid,
    type: "showing",
    subject: `Showing scheduled: ${input.address}`,
    body: `${startDate.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
    timestamp: FieldValue.serverTimestamp()
  });
  await db.doc(`clients/${resolvedClientId}`).update({ lastActivityDate: FieldValue.serverTimestamp() });

  // Auto-create follow-up
  if (input.createFollowUp !== false) {
    const fuDate = new Date(startDate.getTime() + 86400000);
    await db.collection("followUps").add({
      realtorId: uid,
      clientId: resolvedClientId,
      title: `Follow up: ${input.address} showing`,
      dueDate: Timestamp.fromDate(fuDate),
      priority: "medium",
      status: "pending",
      notes: "",
      sourceType: "showing",
      sourceId: showingRef.id,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  // Auto-import: create skeleton listing + match
  try {
    const addrLower = (input.address || "").toLowerCase();
    const listingsSnap = await db.collection("listings")
      .where("address.full", "==", input.address)
      .limit(1)
      .get();

    let listingId = null;
    if (!listingsSnap.empty) {
      listingId = listingsSnap.docs[0].id;
    } else {
      const listingRef = await db.collection("listings").add({
        address: { full: input.address, street: input.address, city: "", state: "", zip: "", county: "", neighborhood: "", lat: null, lng: null },
        listingPrice: input.listingPrice || null,
        mlsNumber: input.mlsNumber || "",
        status: "active",
        source: "showing_import",
        addedBy: uid,
        photos: [],
        features: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      listingId = listingRef.id;
    }

    const matchSnap = await db.collection("clientListingMatches")
      .where("listingId", "==", listingId)
      .where("clientId", "==", resolvedClientId)
      .where("realtorId", "==", uid)
      .limit(1)
      .get();
    if (matchSnap.empty) {
      await db.collection("clientListingMatches").add({
        listingId,
        clientId: resolvedClientId,
        realtorId: uid,
        matchScore: null,
        status: "shown",
        clientRating: null,
        clientFeedback: "",
        realtorNotes: "",
        matchedAt: FieldValue.serverTimestamp()
      });
    }
  } catch (importErr) {
    console.warn("Auto-import listing from showing:", importErr);
  }

  return {
    success: true,
    showingId: showingRef.id,
    address: input.address,
    date: startDate.toISOString(),
    clientName: clientSnap.data().fullName
  };
}

async function handleUpdateShowing(input, uid) {
  if (!input.showingId) {
    return { success: false, error: "No showing ID provided." };
  }

  const showingSnap = await db.doc(`showings/${input.showingId}`).get();
  if (!showingSnap.exists || showingSnap.data().realtorId !== uid) {
    return { success: false, error: "Showing not found or access denied." };
  }

  const updates = { updatedAt: FieldValue.serverTimestamp() };
  if (input.showingDate) {
    const newDate = new Date(input.showingDate);
    if (!isNaN(newDate.getTime())) {
      updates.showingDate = Timestamp.fromDate(newDate);
      const duration = 60;
      updates.endDate = Timestamp.fromDate(new Date(newDate.getTime() + duration * 60000));
    }
  }
  if (input.status) updates.status = input.status;
  if (input.clientRating) updates.clientRating = input.clientRating;
  if (input.clientFeedback) updates.clientFeedback = input.clientFeedback;
  if (input.realtorNotes) updates.realtorNotes = input.realtorNotes;

  await db.doc(`showings/${input.showingId}`).update(updates);

  // Log activity if completing
  if (input.status === "completed") {
    const showing = showingSnap.data();
    await db.collection("activities").add({
      clientId: showing.clientId,
      realtorId: uid,
      type: "showing",
      subject: `Showing completed: ${showing.address}`,
      body: input.clientRating ? `Rating: ${input.clientRating}/5` : "",
      timestamp: FieldValue.serverTimestamp()
    });
    await db.doc(`clients/${showing.clientId}`).update({ lastActivityDate: FieldValue.serverTimestamp() });
  }

  return { success: true, showingId: input.showingId, updates: Object.keys(updates) };
}

async function handleCreateFollowUp(input, uid, clientId) {
  const resolvedClientId = input.clientId || clientId;

  const dueDate = new Date(input.dueDate);
  if (isNaN(dueDate.getTime())) {
    return { success: false, error: "Invalid due date." };
  }

  const data = {
    realtorId: uid,
    clientId: resolvedClientId || null,
    title: input.title,
    dueDate: Timestamp.fromDate(dueDate),
    priority: input.priority || "medium",
    status: "pending",
    notes: input.notes || "",
    sourceType: null,
    sourceId: null,
    createdAt: FieldValue.serverTimestamp()
  };

  const docRef = await db.collection("followUps").add(data);
  return {
    success: true,
    followUpId: docRef.id,
    title: input.title,
    dueDate: dueDate.toISOString().slice(0, 10)
  };
}

async function handleCreateEvent(input, uid) {
  const startDate = new Date(input.startDate);
  if (isNaN(startDate.getTime())) {
    return { success: false, error: "Invalid start date." };
  }

  const endDate = input.endDate ? new Date(input.endDate) : new Date(startDate.getTime() + 3600000);

  const data = {
    realtorId: uid,
    title: input.title,
    description: input.description || "",
    startDate: Timestamp.fromDate(startDate),
    endDate: Timestamp.fromDate(endDate),
    allDay: input.allDay || false,
    color: input.color || "#3b82f6",
    clientId: input.clientId || null,
    createdAt: FieldValue.serverTimestamp()
  };

  const docRef = await db.collection("events").add(data);
  return {
    success: true,
    eventId: docRef.id,
    title: input.title,
    date: startDate.toISOString()
  };
}

async function executeToolCall(toolName, toolInput, uid, clientId) {
  switch (toolName) {
    case "create_client": return handleCreateClient(toolInput, uid);
    case "update_client": return handleUpdateClient(toolInput, uid, clientId);
    case "log_activity": return handleLogActivity(toolInput, uid, clientId);
    case "search_clients": return handleSearchClients(toolInput, uid);
    case "create_showing": return handleCreateShowing(toolInput, uid, clientId);
    case "update_showing": return handleUpdateShowing(toolInput, uid);
    case "create_followup": return handleCreateFollowUp(toolInput, uid, clientId);
    case "create_event": return handleCreateEvent(toolInput, uid);
    case "add_listing": return handleAddListing(toolInput, uid);
    case "match_listing_to_client": return handleMatchListingToClient(toolInput, uid);
    case "search_listings": return handleSearchListings(toolInput, uid);
    default: return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

/* ================================================================
   LISTING AI TOOL HANDLERS
   ================================================================ */

async function handleAddListing(input, uid) {
  const data = {
    address: {
      full: input.address,
      street: input.address,
      city: input.city || "",
      state: input.state || "",
      zip: input.zip || "",
      county: "",
      neighborhood: "",
      lat: null,
      lng: null
    },
    listingPrice: input.listingPrice || null,
    bedrooms: input.bedrooms || null,
    bathrooms: input.bathrooms || null,
    squareFeet: input.squareFeet || null,
    propertyType: input.propertyType || "",
    mlsNumber: input.mlsNumber || "",
    status: input.status || "active",
    source: "ai_assistant",
    addedBy: uid,
    photos: [],
    features: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const ref = await db.collection("listings").add(data);
  return { success: true, listingId: ref.id, address: input.address };
}

async function handleMatchListingToClient(input, uid) {
  if (!input.listingId || !input.clientId) {
    return { success: false, error: "Both listingId and clientId are required." };
  }

  // Verify listing exists
  const listingSnap = await db.doc(`listings/${input.listingId}`).get();
  if (!listingSnap.exists) {
    return { success: false, error: "Listing not found." };
  }

  // Verify client ownership
  const clientSnap = await db.doc(`clients/${input.clientId}`).get();
  if (!clientSnap.exists || clientSnap.data().realtorId !== uid) {
    return { success: false, error: "Client not found or access denied." };
  }

  // Check for existing match
  const existingSnap = await db.collection("clientListingMatches")
    .where("listingId", "==", input.listingId)
    .where("clientId", "==", input.clientId)
    .where("realtorId", "==", uid)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    return { success: true, message: "Already matched.", matchId: existingSnap.docs[0].id };
  }

  const ref = await db.collection("clientListingMatches").add({
    listingId: input.listingId,
    clientId: input.clientId,
    realtorId: uid,
    matchScore: null,
    status: "interested",
    clientRating: null,
    clientFeedback: "",
    realtorNotes: "",
    matchedAt: FieldValue.serverTimestamp()
  });

  return {
    success: true,
    matchId: ref.id,
    clientName: clientSnap.data().fullName,
    address: listingSnap.data().address?.full
  };
}

async function handleSearchListings(input, uid) {
  let q = db.collection("listings");
  const results = [];

  const snap = await q.orderBy("createdAt", "desc").limit(50).get();
  snap.forEach(d => {
    const l = d.data();
    const addr = (l.address?.full || "").toLowerCase();
    const mls = (l.mlsNumber || "").toLowerCase();
    const search = (input.query || "").toLowerCase();

    if (search && !addr.includes(search) && !mls.includes(search)) return;
    if (input.priceMin && l.listingPrice < input.priceMin) return;
    if (input.priceMax && l.listingPrice > input.priceMax) return;
    if (input.bedrooms && (l.bedrooms || 0) < input.bedrooms) return;

    results.push({
      id: d.id,
      address: l.address?.full,
      price: l.listingPrice,
      beds: l.bedrooms,
      baths: l.bathrooms,
      sqft: l.squareFeet,
      type: l.propertyType,
      status: l.status,
      mlsNumber: l.mlsNumber
    });
  });

  return { success: true, count: results.length, listings: results.slice(0, 10) };
}

/* ================================================================
   SYNC MLS LISTINGS (Phase 2 stub)
   ================================================================ */

exports.syncMlsListings = onCall(
  { region: "us-central1", maxInstances: 1 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    // Phase 2: SimplyRETS MLS feed integration
    return { success: true, message: "MLS sync not yet configured.", synced: 0 };
  }
);

exports.askAssistant = onCall(
  { secrets: [anthropicKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    const { question, clientId, context, history } = request.data;

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

        // Load matched listings (clientListingMatches + listings join)
        const matchesSnap = await db.collection("clientListingMatches")
          .where("clientId", "==", clientId)
          .where("realtorId", "==", uid)
          .get();
        const properties = [];
        for (const md of matchesSnap.docs) {
          const m = md.data();
          let listingData = {};
          try {
            const ls = await db.doc(`listings/${m.listingId}`).get();
            if (ls.exists) listingData = ls.data();
          } catch (e) { /* listing deleted */ }
          properties.push({
            address: listingData.address?.full || "Unknown",
            price: listingData.listingPrice,
            beds: listingData.bedrooms,
            baths: listingData.bathrooms,
            sqft: listingData.squareFeet,
            type: listingData.propertyType,
            matchStatus: m.status,
            matchScore: m.matchScore,
            rating: m.clientRating,
            feedback: m.clientFeedback
          });
        }

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

MATCHED LISTINGS (${properties.length}):
${properties.map(p => `- ${p.address} | $${p.price?.toLocaleString() || "?"} | ${p.beds || "?"}bd/${p.baths || "?"}ba | ${p.type || "?"} | Match: ${p.matchStatus} | Score: ${p.matchScore || "?"}% | Rating: ${p.rating || "?"}/5${p.feedback ? " | Feedback: " + p.feedback : ""}`).join("\n") || "No matched listings"}

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
            id: d.id,
            address: s.address,
            date: s.showingDate ? s.showingDate.toDate().toISOString() : "unknown",
            status: s.status,
            rating: s.clientRating,
            feedback: s.clientFeedback
          };
        });

        contextText += `

SHOWINGS (${showingsData.length}):
${showingsData.map(s => `- [ID: ${s.id}] ${s.address} | ${s.date} | ${s.status}${s.rating ? " | Rating: " + s.rating + "/5" : ""}${s.feedback ? " | " + s.feedback : ""}`).join("\n") || "No showings"}`;

      } else if (context === "general") {
        // Lightweight context for non-specific pages
        const clientsSnap = await db.collection("clients")
          .where("realtorId", "==", uid)
          .get();

        const statusCounts = {};
        clientsSnap.forEach(d => {
          const s = d.data().status || "lead";
          statusCounts[s] = (statusCounts[s] || 0) + 1;
        });

        const now = Date.now();
        const sevenDaysMs = 7 * 86400000;
        const nowTs = Timestamp.now();
        const weekFromNow = Timestamp.fromDate(new Date(now + sevenDaysMs));

        const showingsSnap = await db.collection("showings")
          .where("realtorId", "==", uid)
          .where("showingDate", ">=", nowTs)
          .where("showingDate", "<=", weekFromNow)
          .get();

        const clientMap = {};
        clientsSnap.forEach(d => { clientMap[d.id] = d.data().fullName; });

        const showings = showingsSnap.docs.map(d => {
          const s = d.data();
          return `  - ${s.showingDate.toDate().toISOString()}: ${s.address} with ${clientMap[s.clientId] || "Unknown"}`;
        });

        contextText = `
GENERAL CONTEXT:
- Total Clients: ${clientsSnap.size}
- By Status: ${Object.entries(statusCounts).map(([s, n]) => `${s}: ${n}`).join(", ") || "none"}
- Upcoming Showings This Week (${showings.length}):
${showings.join("\n") || "  No showings scheduled"}`;

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
- Client List: ${clients.map(c => `${c.name} [ID: ${c.id}] (${c.status})`).join(", ")}
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
        tools = AI_TOOLS; // all tools
      } else if (context === "dashboard" || context === "general") {
        tools = AI_TOOLS.filter(t => ["create_client", "search_clients", "create_event", "create_followup", "create_showing", "add_listing", "search_listings"].includes(t.name));
      } else {
        tools = [];
      }

      // Build messages with conversation history
      const messages = [];
      if (history && Array.isArray(history)) {
        const safeHistory = history.slice(-20); // last 10 exchanges max
        for (const msg of safeHistory) {
          if (msg && (msg.role === "user" || msg.role === "assistant") && msg.content) {
            messages.push({ role: msg.role, content: String(msg.content).slice(0, 4000) });
          }
        }
      }
      messages.push({ role: "user", content: userMessage });
      const actionsPerformed = [];
      const MAX_ROUNDS = 8;

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
   SENDGRID SENDER VERIFICATION
   ================================================================ */

exports.requestSenderVerification = onCall(
  { secrets: [sendgridKey], region: "us-central1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");

    const uid = request.auth.uid;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const email = userData.email || request.auth.token.email;
    const fullName = userData.fullName || "Realtor";

    if (!email) throw new HttpsError("failed-precondition", "No email address on your profile.");

    const fetch = require("node-fetch");
    // Check if already verified
    const listRes = await fetch("https://api.sendgrid.com/v3/verified_senders", {
      headers: { Authorization: `Bearer ${sendgridKey.value()}` }
    });
    const listData = await listRes.json();
    const existing = (listData.results || []).find(s => s.from_email === email);

    if (existing && existing.verified) {
      await db.doc(`users/${uid}`).update({
        senderVerified: true,
        sendgridSenderId: existing.id
      });
      return { alreadyVerified: true };
    }

    // If pending, delete and re-create to resend verification email
    if (existing && !existing.verified) {
      await fetch(`https://api.sendgrid.com/v3/verified_senders/${existing.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sendgridKey.value()}` }
      });
    }

    // Create new sender identity — triggers verification email
    const createRes = await fetch("https://api.sendgrid.com/v3/verified_senders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridKey.value()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nickname: `${fullName} (GreenDoor)`,
        from_email: email,
        from_name: fullName,
        reply_to: email,
        reply_to_name: fullName,
        address: "123 Main St",
        city: "New York",
        state: "NY",
        zip: "10001",
        country: "US"
      })
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error("SendGrid create sender error:", createRes.status, errBody);
      throw new HttpsError("internal", "Failed to send verification email. Please try again.");
    }

    const created = await createRes.json();
    await db.doc(`users/${uid}`).update({
      senderVerified: false,
      sendgridSenderId: created.id
    });

    return { success: true, email };
  }
);

exports.checkSenderVerification = onCall(
  { secrets: [sendgridKey], region: "us-central1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");

    const uid = request.auth.uid;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};

    if (!userData.sendgridSenderId) {
      return { verified: false, noSender: true };
    }

    const fetch = require("node-fetch");
    const listRes = await fetch("https://api.sendgrid.com/v3/verified_senders", {
      headers: { Authorization: `Bearer ${sendgridKey.value()}` }
    });
    const listData = await listRes.json();
    const sender = (listData.results || []).find(s => s.id === userData.sendgridSenderId);

    if (!sender) {
      await db.doc(`users/${uid}`).update({ senderVerified: false, sendgridSenderId: null });
      return { verified: false, noSender: true };
    }

    if (sender.verified && !userData.senderVerified) {
      await db.doc(`users/${uid}`).update({ senderVerified: true });
    }

    return { verified: sender.verified, email: sender.from_email };
  }
);

exports.removeSenderVerification = onCall(
  { secrets: [sendgridKey], region: "us-central1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");

    const uid = request.auth.uid;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};

    if (userData.sendgridSenderId) {
      const fetch = require("node-fetch");
      await fetch(`https://api.sendgrid.com/v3/verified_senders/${userData.sendgridSenderId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sendgridKey.value()}` }
      });
    }

    await db.doc(`users/${uid}`).update({
      senderVerified: false,
      sendgridSenderId: null
    });

    return { success: true };
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      throw new HttpsError("invalid-argument", "Invalid recipient email address.");
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
    const realtorEmail = userData.email || request.auth.token.email;
    const realtorName = userData.fullName || "GreenDoor Realtor";

    // Append email signature if set
    let htmlBody = body;
    if (userData.emailSignature) {
      htmlBody += `<br><br>--<br>${userData.emailSignature.replace(/\r\n|\r|\n/g, "<br>")}`;
    }

    // If sender is verified, send from their email; otherwise use GreenDoor with reply-to
    const fromEmail = userData.senderVerified ? realtorEmail : "greendoor@stoekmedia.com";
    const fromName = userData.senderVerified ? realtorName : "GreenDoor";

    try {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(sendgridKey.value());

      const msg = {
        to: { email: to, name: toName || "" },
        from: { email: fromEmail, name: fromName },
        subject,
        html: htmlBody
      };

      // Only add reply-to if sending from GreenDoor (not needed when from = realtor)
      if (!userData.senderVerified) {
        msg.replyTo = { email: realtorEmail, name: realtorName };
      }

      await sgMail.send(msg);

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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      throw new HttpsError("invalid-argument", "Invalid recipient email address.");
    }
    if (cc && !emailRegex.test(cc)) {
      throw new HttpsError("invalid-argument", "Invalid CC email address.");
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
    const realtorEmail = userData.email || request.auth.token.email;
    const realtorName = userData.fullName || "GreenDoor Realtor";

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

    const fromEmail = userData.senderVerified ? realtorEmail : "greendoor@stoekmedia.com";
    const fromName = userData.senderVerified ? realtorName : "GreenDoor";

    try {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(sendgridKey.value());

      const msg = {
        to: { email: to },
        from: { email: fromEmail, name: fromName },
        subject,
        html: htmlBody
      };
      if (!userData.senderVerified) {
        msg.replyTo = { email: realtorEmail, name: realtorName };
      }
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
   BOLDSIGN: EMBEDDED SIGNATURE REQUEST (Drag-and-drop field placement)
   ================================================================ */

exports.createEmbeddedSignatureRequest = onCall(
  { secrets: [boldsignKey], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const uid = request.auth.uid;
    let { clientId, files, signers, title, message, expiryDays } = request.data;

    if (!clientId || !files || !files.length || !signers || !signers.length) {
      throw new HttpsError("invalid-argument", "Client, at least one file, and at least one signer are required.");
    }

    for (const f of files) {
      if (!f.fileUrl || !f.fileUrl.startsWith("https://firebasestorage.googleapis.com/")) {
        throw new HttpsError("invalid-argument", "Invalid file URL.");
      }
    }

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

      // Signers — no FormFields; the realtor places them in the embedded editor
      signers.forEach((s, i) => {
        form.append(`Signers[${i}][Name]`, s.name);
        form.append(`Signers[${i}][EmailAddress]`, s.email);
        form.append(`Signers[${i}][SignerType]`, "Signer");
        form.append(`Signers[${i}][SignerOrder]`, String(s.order || i + 1));
      });

      // Embedded editor options
      form.append("ShowToolbar", "true");
      form.append("ShowSendButton", "true");
      form.append("ShowNavigationButtons", "true");
      form.append("ShowPreviewButton", "true");
      form.append("SendViewOption", "PreparePage");

      // Link valid for 1 hour
      const validTill = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      form.append("SendLinkValidTill", validTill);

      const bsResponse = await fetch("https://api.boldsign.com/v1/document/createEmbeddedRequestUrl", {
        method: "POST",
        headers: {
          "X-API-KEY": boldsignKey.value(),
          ...form.getHeaders()
        },
        body: form
      });

      if (!bsResponse.ok) {
        const errorText = await bsResponse.text();
        console.error("BoldSign embedded request error:", bsResponse.status, errorText);
        throw new Error("BoldSign API error: " + bsResponse.status);
      }

      const bsData = await bsResponse.json();
      const { documentId, sendUrl } = bsData;

      // Store envelope as draft — activity logged when realtor actually sends
      await db.doc(`envelopes/${documentId}`).set({
        documentId,
        clientId,
        realtorId: uid,
        title: envelopeTitle,
        files: files.map(f => ({ fileName: f.fileName, fileUrl: f.fileUrl })),
        signers: signers.map(s => ({ name: s.name, email: s.email, order: s.order || 1, status: "draft" })),
        status: "draft",
        createdAt: FieldValue.serverTimestamp(),
        signedDocumentUrl: null,
        fileName: files[0].fileName,
        signerEmail: signers[0].email,
        signerName: signers[0].name,
        firebaseFileUrl: files[0].fileUrl
      });

      return { success: true, sendUrl, documentId };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("createEmbeddedSignatureRequest error:", err);
      throw new HttpsError("internal", "Failed to create embedded signature request.");
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
  const baseFileName = envelopeData.title || envelopeData.files?.[0]?.fileName || envelopeData.fileName || "document.pdf";
  const signedFileName = `SIGNED_${baseFileName}`;
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
    subject: "Document signed: " + (envelopeData.title || envelopeData.fileName),
    body: "Signed by " + (envelopeData.signers?.map(s => s.name).join(", ") || envelopeData.signerName || "signer"),
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
      } else {
        // Signature header missing — only allow verification pings (no documentId)
        const body = req.body || {};
        const hasDocumentId = body.data?.documentId || body.event?.documentId || body.documentId;
        if (hasDocumentId) {
          res.status(401).send("Missing webhook signature");
          return;
        }
      }
    }

    try {
      const payload = req.body;
      const event = payload.event || {};
      const eventType = (event.eventType || payload.eventType || "").toLowerCase();
      const documentId = payload.data?.documentId || event.documentId || payload.documentId;

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
      const envelopeData = envelopeSnap.data();
      const updateData = { status: newStatus };

      // Update per-signer statuses from webhook payload
      const signerDetails = payload.data?.signerDetails;
      if (signerDetails && envelopeData.signers) {
        updateData.signers = envelopeData.signers.map(s => {
          const match = signerDetails.find(
            sd => sd.signerEmail?.toLowerCase() === s.email?.toLowerCase()
          );
          if (match) {
            s.status = (match.status || "sent").toLowerCase().replace(/\s/g, "_");
          }
          return s;
        });
      }

      await db.doc(`envelopes/${documentId}`).update(updateData);

      // If a draft transitions to sent, log the activity (deferred from createEmbeddedSignatureRequest)
      if (newStatus === "sent" && envelopeData.status === "draft") {
        await db.doc(`envelopes/${documentId}`).update({ sentAt: FieldValue.serverTimestamp() });

        await db.collection("activities").add({
          clientId: envelopeData.clientId,
          realtorId: envelopeData.realtorId,
          type: "email",
          subject: `Sent for signature: ${envelopeData.title || envelopeData.fileName}`,
          body: `${envelopeData.files?.length || 1} doc(s) sent to ${envelopeData.signers?.map(s => s.name).join(", ") || envelopeData.signerName || "signer"} via BoldSign`,
          timestamp: FieldValue.serverTimestamp()
        });

        await db.doc(`clients/${envelopeData.clientId}`).update({
          lastActivityDate: FieldValue.serverTimestamp()
        });
      }

      // If completed, download and file the signed document
      if (newStatus === "completed") {
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
   BOLDSIGN: STRESS TEST (Admin Only)
   ================================================================ */

exports.stressTestBoldSign = onCall(
  { secrets: [boldsignKey, boldsignWebhookSecret], region: "us-central1", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    // Admin-only
    const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data().role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can run diagnostics.");
    }

    const fetch = require("node-fetch");
    const FormData = require("form-data");
    const apiKey = boldsignKey.value();
    const secret = boldsignWebhookSecret.value();
    const adminEmail = callerSnap.data().email || request.auth.token.email;
    const results = [];
    let testDocumentId = null;

    // Helper
    function record(test, passed, details, rawResponse) {
      results.push({ test, passed, details, ...(rawResponse ? { rawResponse } : {}) });
    }

    // --- Test 1: API Key ---
    try {
      const resp = await fetch(
        "https://api.boldsign.com/v1/document/list?Page=1&PageSize=1",
        { headers: { "X-API-KEY": apiKey } }
      );
      if (resp.ok) {
        const data = await resp.json();
        record("API Key", true, `Key valid. ${data.result?.length ?? 0} doc(s) returned.`);
      } else {
        const text = await resp.text();
        record("API Key", false, `HTTP ${resp.status}: ${text}`);
      }
    } catch (err) {
      record("API Key", false, err.message);
    }

    // --- Test 2: Send Document ---
    try {
      // Create a tiny test PDF
      const pdfBytes = Buffer.from(
        "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n" +
        "trailer<</Size 4/Root 1 0 R>>\nstartxref\n206\n%%EOF"
      );

      const form = new FormData();
      form.append("Title", "GreenDoor Stress Test");
      form.append("Message", "Automated diagnostic — safe to ignore.");
      form.append("Signers[0][Name]", "GreenDoor Admin");
      form.append("Signers[0][EmailAddress]", adminEmail);
      form.append("Signers[0][SignerType]", "Signer");
      form.append("Signers[0][SignerOrder]", "1");
      form.append("Signers[0][FormFields][0][FieldType]", "Signature");
      form.append("Signers[0][FormFields][0][PageNumber]", "1");
      form.append("Signers[0][FormFields][0][Bounds][X]", "100");
      form.append("Signers[0][FormFields][0][Bounds][Y]", "100");
      form.append("Signers[0][FormFields][0][Bounds][Width]", "200");
      form.append("Signers[0][FormFields][0][Bounds][Height]", "50");
      form.append("Files", pdfBytes, { filename: "stress-test.pdf", contentType: "application/pdf" });
      form.append("ExpiryDays", "1");

      const resp = await fetch("https://api.boldsign.com/v1/document/send", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, ...form.getHeaders() },
        body: form
      });

      if (resp.ok) {
        const data = await resp.json();
        testDocumentId = data.documentId;
        record("Send Document", true, `Sent. documentId: ${testDocumentId}`);
      } else {
        const text = await resp.text();
        record("Send Document", false, `HTTP ${resp.status}: ${text}`);
      }
    } catch (err) {
      record("Send Document", false, err.message);
    }

    // --- Test 3: Get Properties ---
    if (testDocumentId) {
      try {
        const resp = await fetch(
          `https://api.boldsign.com/v1/document/properties?documentId=${testDocumentId}`,
          { headers: { "X-API-KEY": apiKey } }
        );
        if (resp.ok) {
          const data = await resp.json();
          record("Get Properties", true, `Status: ${data.status}. Signers: ${data.signerDetails?.length ?? 0}`);

          // --- Test 4: Field Mapping ---
          const signer = data.signerDetails?.[0];
          if (signer && typeof signer.signerEmail === "string" && typeof signer.status === "string") {
            record("Field Mapping", true, `signerEmail="${signer.signerEmail}", status="${signer.status}"`);
          } else {
            record("Field Mapping", false, "signerDetails missing expected fields (signerEmail, status)", JSON.stringify(signer || null));
          }
        } else {
          const text = await resp.text();
          record("Get Properties", false, `HTTP ${resp.status}: ${text}`);
          record("Field Mapping", false, "Skipped — properties call failed");
        }
      } catch (err) {
        record("Get Properties", false, err.message);
        record("Field Mapping", false, "Skipped — properties call failed");
      }
    } else {
      record("Get Properties", false, "Skipped — no documentId from send");
      record("Field Mapping", false, "Skipped — no documentId from send");
    }

    // --- Test 5: Download ---
    if (testDocumentId) {
      try {
        const resp = await fetch(
          `https://api.boldsign.com/v1/document/download?documentId=${testDocumentId}`,
          { headers: { "X-API-KEY": apiKey } }
        );
        if (resp.ok) {
          const buf = await resp.buffer();
          const isPdf = buf.length > 4 && buf.slice(0, 5).toString().startsWith("%PDF");
          record("Download", isPdf, isPdf ? `Valid PDF, ${buf.length} bytes` : `Got ${buf.length} bytes but not a PDF`);
        } else {
          const text = await resp.text();
          record("Download", false, `HTTP ${resp.status}: ${text}`);
        }
      } catch (err) {
        record("Download", false, err.message);
      }
    } else {
      record("Download", false, "Skipped — no documentId from send");
    }

    // --- Test 6: Webhook HMAC ---
    try {
      if (!secret) {
        record("Webhook HMAC", false, "BOLDSIGN_WEBHOOK_SECRET not configured");
      } else {
        const testTimestamp = String(Math.floor(Date.now() / 1000));
        const testBody = '{"test":true}';
        const sig = crypto.createHmac("sha256", secret)
          .update(testTimestamp + "." + testBody, "utf8")
          .digest("hex");
        const valid = sig && sig.length === 64 && /^[0-9a-f]+$/.test(sig);
        record("Webhook HMAC", valid, valid ? `HMAC generated OK (${sig.substring(0, 16)}...)` : "HMAC generation produced invalid output");
      }
    } catch (err) {
      record("Webhook HMAC", false, err.message);
    }

    // --- Test 7: Void / Cleanup ---
    if (testDocumentId) {
      try {
        const resp = await fetch(
          `https://api.boldsign.com/v1/document/void?documentId=${testDocumentId}`,
          {
            method: "POST",
            headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ message: "GreenDoor stress test cleanup" })
          }
        );
        if (resp.ok || resp.status === 204) {
          record("Void/Cleanup", true, "Test document voided successfully");
        } else {
          const text = await resp.text();
          record("Void/Cleanup", false, `HTTP ${resp.status}: ${text}`);
        }
      } catch (err) {
        record("Void/Cleanup", false, err.message);
      }
    } else {
      record("Void/Cleanup", false, "Skipped — no documentId to void");
    }

    const passed = results.filter(r => r.passed).length;
    return { results, summary: `${passed}/${results.length} passed` };
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

/* ================================================================
   PARSE LISTING URL — Fetches a listing page and extracts details via Claude
   ================================================================ */
exports.parseListingUrl = onCall(
  { secrets: [anthropicKey], region: "us-central1", maxInstances: 5 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");

    const { url } = request.data;
    if (!url || typeof url !== "string") {
      throw new HttpsError("invalid-argument", "URL is required.");
    }

    // Basic URL validation
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      throw new HttpsError("invalid-argument", "Please provide a valid URL.");
    }

    try {
      const fetch = require("node-fetch");

      // Fetch the page HTML
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5"
        },
        timeout: 15000,
        redirect: "follow"
      });

      if (!response.ok) {
        throw new HttpsError("unavailable", `Could not fetch the page (HTTP ${response.status}). The site may be blocking automated requests.`);
      }

      let html = await response.text();
      // Truncate to ~50K chars to stay within Claude's limits
      if (html.length > 50000) {
        html = html.substring(0, 50000);
      }

      const Anthropic = require("@anthropic-ai/sdk");
      const anthropicClient = new Anthropic({ apiKey: anthropicKey.value() });

      const extractionPrompt = `Extract property listing details from this HTML. Return a JSON object with these fields (use null for any field you cannot find):

{
  "address": {
    "full": "full address string",
    "street": "street address",
    "city": "city",
    "state": "2-letter state code",
    "zip": "zip code",
    "county": "county if available",
    "neighborhood": "neighborhood if available"
  },
  "listingPrice": number (just the number, no $ or commas),
  "bedrooms": number,
  "bathrooms": number (total: full + half*0.5),
  "squareFeet": number,
  "propertyType": "Single Family" | "Condo" | "Townhouse" | "Multi-Family" | "Land" | other,
  "yearBuilt": number,
  "lotSize": "string like 0.25 acres or 10,890 sqft",
  "garageSpaces": number,
  "stories": number,
  "features": ["array", "of", "feature", "strings"],
  "mlsNumber": "MLS number string",
  "description": "property description text",
  "status": "active" | "pending" | "sold" | "coming_soon",
  "listingUrl": "${url}"
}

Return ONLY the JSON object, no markdown, no explanation.

HTML:
${html}`;

      const aiResponse = await anthropicClient.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: extractionPrompt }]
      });

      const text = aiResponse.content[0]?.text || "{}";

      // Parse the JSON from Claude's response
      let parsed;
      try {
        // Handle case where Claude wraps in ```json blocks
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      } catch {
        throw new HttpsError("internal", "Failed to parse listing details from the page.");
      }

      // Ensure listingUrl is set
      parsed.listingUrl = url;

      return { success: true, listing: parsed };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("parseListingUrl error:", err);
      throw new HttpsError("internal", "Failed to extract listing details. The site may not be accessible or the page format may not be supported.");
    }
  }
);

/* ================================================================
   OFFBOARD REALTOR
   ================================================================ */
exports.offboardRealtor = onCall(
  { region: "us-central1", timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data().role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can offboard realtors.");
    }

    const { targetUid, clientDispositions, options } = request.data;

    if (!targetUid || typeof targetUid !== "string") {
      throw new HttpsError("invalid-argument", "Target user ID is required.");
    }

    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Target user not found.");
    }

    const targetData = targetSnap.data();
    const adminName = callerSnap.data().fullName || request.auth.uid;

    try {
      // 1. Process client dispositions
      if (clientDispositions && typeof clientDispositions === "object") {
        const clientIds = Object.keys(clientDispositions);

        for (let i = 0; i < clientIds.length; i += 400) {
          const batch = db.batch();
          const chunk = clientIds.slice(i, i + 400);

          for (const clientId of chunk) {
            const disp = clientDispositions[clientId];
            const clientRef = db.doc(`clients/${clientId}`);

            if (disp.action === "reassign" && disp.targetRealtorId) {
              batch.update(clientRef, { realtorId: disp.targetRealtorId });

              // Also reassign related docs
              const relatedCollections = ["activities", "files", "showings", "followUps", "events", "bookmarkedProperties"];
              for (const col of relatedCollections) {
                const relSnap = await db.collection(col)
                  .where("realtorId", "==", targetUid)
                  .where("clientId", "==", clientId)
                  .get();
                relSnap.forEach(d => batch.update(d.ref, { realtorId: disp.targetRealtorId }));
              }
            } else if (disp.action === "delete") {
              batch.delete(clientRef);
            } else {
              // unassign — clear realtorId
              batch.update(clientRef, { realtorId: null });
            }
          }

          await batch.commit();
        }
      }

      // 2. Delete selected data
      if (options?.deleteFiles) {
        await deleteCollectionByRealtor("files", targetUid);
        // Also delete from Storage
        try {
          const storage = getStorage();
          const bucket = storage.bucket();
          const [files] = await bucket.getFiles({ prefix: `greendoor/${targetUid}/` });
          for (const file of files) {
            await file.delete().catch(() => {});
          }
        } catch (e) {
          console.warn("Storage cleanup error:", e.message);
        }
      }

      if (options?.deleteActivities) {
        await deleteCollectionByRealtor("activities", targetUid);
        await deleteCollectionByRealtor("showings", targetUid);
        await deleteCollectionByRealtor("followUps", targetUid);
        await deleteCollectionByRealtor("events", targetUid);
      }

      if (options?.deleteEnvelopes) {
        await deleteCollectionByRealtor("envelopes", targetUid);
      }

      // 3. Disable Auth account
      if (options?.disableAuth) {
        try {
          const authAdmin = getAuth();
          await authAdmin.updateUser(targetUid, { disabled: true });
        } catch (e) {
          console.warn("Auth disable error:", e.message);
        }
      }

      // 4. Mark user doc as offboarded
      await db.doc(`users/${targetUid}`).update({
        isActive: false,
        offboardedAt: FieldValue.serverTimestamp(),
        offboardedBy: request.auth.uid
      });

      // 5. Write audit log
      await db.collection("adminAuditLog").add({
        action: "offboard",
        targetUser: targetData.email || targetUid,
        details: `Offboarded ${targetData.fullName || targetUid}. Files: ${options?.deleteFiles ? "deleted" : "kept"}, Activities: ${options?.deleteActivities ? "deleted" : "kept"}, Auth: ${options?.disableAuth ? "disabled" : "kept"}.`,
        adminUid: request.auth.uid,
        adminName,
        timestamp: FieldValue.serverTimestamp()
      });

      return { success: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("offboardRealtor error:", err);
      throw new HttpsError("internal", "Offboarding failed. Please try again.");
    }
  }
);

async function deleteCollectionByRealtor(collectionName, realtorId) {
  const snap = await db.collection(collectionName)
    .where("realtorId", "==", realtorId)
    .get();

  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

/* ================================================================
   RESEND INVITE
   ================================================================ */
exports.resendInvite = onCall(
  { secrets: [sendgridKey], region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data().role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can resend invites.");
    }

    const { targetUid } = request.data;
    if (!targetUid || typeof targetUid !== "string") {
      throw new HttpsError("invalid-argument", "Target user ID is required.");
    }

    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Target user not found.");
    }

    const targetData = targetSnap.data();

    try {
      const authAdmin = getAuth();
      const resetLink = await authAdmin.generatePasswordResetLink(targetData.email, {
        url: "https://stoekmedia.com/greendoor/app/login"
      });

      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(sendgridKey.value());

      await sgMail.send({
        to: { email: targetData.email, name: targetData.fullName },
        from: { email: "greendoor@stoekmedia.com", name: "GreenDoor" },
        subject: "GreenDoor — Set Your Password",
        html: buildWelcomeEmail(targetData.fullName, resetLink)
      });

      await db.doc(`users/${targetUid}`).update({
        lastInviteSentAt: FieldValue.serverTimestamp()
      });

      return { success: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("resendInvite error:", err);
      throw new HttpsError("internal", "Failed to resend invite.");
    }
  }
);
