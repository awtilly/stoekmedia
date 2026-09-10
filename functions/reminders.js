/* ------------------------------------------------------------------ */
/*  sendReminders — scheduled push for follow-ups due today and         */
/*  showings starting within the hour.                                  */
/*                                                                      */
/*  Runs every 15 minutes. Writes a users/{uid}/notifications doc for   */
/*  each item (sendPushOnNotification in index.js fans that out to the  */
/*  realtor's devices) and stamps reminderSentAt on the source doc so   */
/*  nothing is sent twice. Follow-ups fire once at/after 8am in the     */
/*  realtor's timezone (users/{uid}.timezone, default America/Chicago). */
/* ------------------------------------------------------------------ */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const DEFAULT_TZ = "America/Chicago";
const FOLLOWUP_HOUR = 8;          // local hour to start sending "due today" reminders
const SHOWING_LEAD_MIN = 60;      // remind this many minutes before a showing
const SHOWING_WINDOW_MIN = 15;    // scheduler cadence; catches showings in (lead-window, lead]

function localParts(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit"
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function fmtTime(date, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
}

exports.sendReminders = onSchedule(
  { schedule: "every 15 minutes", region: "us-central1", timeZone: "America/Chicago" },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const tzCache = new Map();
    const tzFor = async (uid) => {
      if (tzCache.has(uid)) return tzCache.get(uid);
      let tz = DEFAULT_TZ;
      try {
        const u = await db.doc(`users/${uid}`).get();
        if (u.exists && typeof u.data().timezone === "string" && u.data().timezone) tz = u.data().timezone;
        // Validate the tz string; fall back if Intl rejects it.
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
      } catch (_) { tz = DEFAULT_TZ; }
      tzCache.set(uid, tz);
      return tz;
    };

    let sent = 0;

    /* ---- Showings: starting in (now + lead - window, now + lead] ---- */
    const lo = new Date(now.getTime() + (SHOWING_LEAD_MIN - SHOWING_WINDOW_MIN) * 60000);
    const hi = new Date(now.getTime() + SHOWING_LEAD_MIN * 60000);
    const showings = await db.collection("showings")
      .where("showingDate", ">", Timestamp.fromDate(lo))
      .where("showingDate", "<=", Timestamp.fromDate(hi))
      .get();

    for (const doc of showings.docs) {
      const s = doc.data();
      if (s.reminderSentAt || !s.realtorId) continue;
      if (s.status && s.status !== "scheduled") continue;
      const tz = await tzFor(s.realtorId);
      const when = s.showingDate.toDate();
      let clientName = "";
      if (s.clientId) {
        try {
          const c = await db.doc(`clients/${s.clientId}`).get();
          clientName = c.exists ? (c.data().fullName || "") : "";
        } catch (_) {}
      }
      const addr = s.address || "your showing";
      await db.collection(`users/${s.realtorId}/notifications`).add({
        type: "showing_reminder",
        title: `Showing at ${fmtTime(when, tz)}`,
        body: clientName ? `${clientName} — ${addr}` : addr,
        url: s.clientId ? `client-detail.html?id=${s.clientId}&tab=showings` : "calendar.html",
        read: false,
        createdAt: FieldValue.serverTimestamp()
      });
      await doc.ref.update({ reminderSentAt: FieldValue.serverTimestamp() });
      sent++;
    }

    /* ---- Follow-ups: due today (local), not yet reminded, local hour >= 8 ---- */
    // Query a generous UTC window around "today" and resolve the local date per user.
    const winLo = new Date(now.getTime() - 36 * 3600000);
    const winHi = new Date(now.getTime() + 36 * 3600000);
    const followUps = await db.collection("followUps")
      .where("dueDate", ">=", Timestamp.fromDate(winLo))
      .where("dueDate", "<=", Timestamp.fromDate(winHi))
      .get();

    for (const doc of followUps.docs) {
      const f = doc.data();
      if (f.reminderSentAt || !f.realtorId) continue;
      if (f.status && f.status !== "pending") continue;
      const tz = await tzFor(f.realtorId);
      const nowLocal = localParts(now, tz);
      if (nowLocal.hour < FOLLOWUP_HOUR) continue;
      const dueLocal = localParts(f.dueDate.toDate(), tz);
      if (dueLocal.ymd !== nowLocal.ymd) continue;
      let clientName = "";
      if (f.clientId) {
        try {
          const c = await db.doc(`clients/${f.clientId}`).get();
          clientName = c.exists ? (c.data().fullName || "") : "";
        } catch (_) {}
      }
      await db.collection(`users/${f.realtorId}/notifications`).add({
        type: "followup_due",
        title: clientName ? `Follow up with ${clientName}` : "Follow-up due today",
        body: f.title || "",
        url: f.clientId ? `client-detail.html?id=${f.clientId}&tab=activity` : "calendar.html",
        read: false,
        createdAt: FieldValue.serverTimestamp()
      });
      await doc.ref.update({ reminderSentAt: FieldValue.serverTimestamp() });
      sent++;
    }

    if (sent) console.log(`sendReminders: ${sent} reminder(s) queued`);
  }
);
