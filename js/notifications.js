import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

async function checkNotifications(uid) {
  if (Notification.permission === "default") {
    // Don't auto-prompt — wait for user action
    return;
  }
  if (Notification.permission !== "granted") return;

  // Only check once per hour
  const lastCheck = localStorage.getItem("gd-notif-last-check");
  const hourAgo = Date.now() - 3600000;
  if (lastCheck && parseInt(lastCheck) > hourAgo) return;
  localStorage.setItem("gd-notif-last-check", Date.now().toString());

  const now = new Date();
  const notifications = [];

  // 1. Overdue follow-ups
  try {
    const fuSnap = await getDocs(query(
      collection(db, "followUps"),
      where("realtorId", "==", uid),
      where("status", "==", "outstanding"),
      where("dueDate", "<=", Timestamp.fromDate(now))
    ));
    if (fuSnap.size > 0) {
      notifications.push({
        title: `${fuSnap.size} overdue follow-up${fuSnap.size > 1 ? "s" : ""}`,
        body: fuSnap.docs.map(d => d.data().title).slice(0, 3).join(", "),
        tag: "overdue-followups"
      });
    }
  } catch (e) { /* skip if query fails */ }

  // 2. Stale clients (14+ days no contact)
  try {
    const staleDate = new Date(now.getTime() - 14 * 86400000);
    const clientSnap = await getDocs(query(
      collection(db, "clients"),
      where("realtorId", "==", uid),
      where("status", "in", ["active_buyer", "active_seller", "under_contract"]),
      where("lastActivityDate", "<=", Timestamp.fromDate(staleDate))
    ));
    if (clientSnap.size > 0) {
      notifications.push({
        title: `${clientSnap.size} client${clientSnap.size > 1 ? "s" : ""} need${clientSnap.size === 1 ? "s" : ""} attention`,
        body: "Active clients haven't been contacted in 14+ days",
        tag: "stale-clients"
      });
    }
  } catch (e) { /* skip */ }

  // 3. Closing deadlines (next 3 days)
  try {
    const threeDays = new Date(now.getTime() + 3 * 86400000);
    const closingSnap = await getDocs(query(
      collection(db, "clients"),
      where("realtorId", "==", uid),
      where("status", "==", "under_contract"),
      where("closingDate", "<=", Timestamp.fromDate(threeDays)),
      where("closingDate", ">=", Timestamp.fromDate(now))
    ));
    if (closingSnap.size > 0) {
      notifications.push({
        title: `${closingSnap.size} closing${closingSnap.size > 1 ? "s" : ""} in the next 3 days`,
        body: closingSnap.docs.map(d => d.data().fullName).slice(0, 3).join(", "),
        tag: "closing-deadlines"
      });
    }
  } catch (e) { /* skip */ }

  // 4. Today's showings
  try {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);
    const showSnap = await getDocs(query(
      collection(db, "showings"),
      where("realtorId", "==", uid),
      where("showingDate", ">=", Timestamp.fromDate(todayStart)),
      where("showingDate", "<", Timestamp.fromDate(todayEnd))
    ));
    if (showSnap.size > 0) {
      notifications.push({
        title: `${showSnap.size} showing${showSnap.size > 1 ? "s" : ""} today`,
        body: showSnap.docs.map(d => d.data().address || "Property").slice(0, 3).join(", "),
        tag: "today-showings"
      });
    }
  } catch (e) { /* skip */ }

  // Show notifications
  notifications.forEach(n => {
    new Notification(n.title, {
      body: n.body,
      icon: "/greendoor/app/icons/icon-192.png",
      tag: n.tag,
      badge: "/greendoor/app/icons/icon-192.png"
    });
  });
}

// Permission request function (called from UI)
window.requestNotificationPermission = async function () {
  if (!("Notification" in window)) return false;
  const result = await Notification.requestPermission();
  return result === "granted";
};

// Auto-check on auth
onAuthStateChanged(auth, (user) => {
  if (user && "Notification" in window && Notification.permission === "granted") {
    // Delay check to not block page load
    setTimeout(() => checkNotifications(user.uid), 3000);
  }
});
