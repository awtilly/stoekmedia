import { db } from "./firebase-config.js";
import { doc, setDoc, serverTimestamp } from "./vendor/firebase.js";

/* Native push registration. The Capacitor plugin's `registration` event carries
   an FCM token (AppDelegate swaps the APNs token for one before posting it),
   which we park on the user doc for the Cloud Functions sender. */
export async function initPush(uid) {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  const push = cap.Plugins?.PushNotifications;
  if (!push) return;

  push.addListener("registration", async ({ value }) => {
    try {
      await setDoc(doc(db, "users", uid), {
        fcmTokens: { [value]: { platform: "ios", updatedAt: serverTimestamp() } }
      }, { merge: true });
    } catch (e) {
      console.warn("push: token save failed", e);
    }
  });

  push.addListener("registrationError", (e) => {
    console.warn("push: registration error", e);
  });

  push.addListener("pushNotificationActionPerformed", (action) => {
    const url = action?.notification?.data?.url;
    // Same-directory CRM pages only — never navigate to arbitrary URLs.
    if (url && /^[\w-]+\.html(\?[\w=&-]*)?$/.test(url)) {
      window.location.href = url;
    }
  });

  const finish = async () => {
    await push.register();
    push.removeAllDeliveredNotifications().catch(() => {});
  };

  /* Don't ask on first launch — the realtor hasn't seen why yet. The prompt is
     triggered by window.gdRequestPush() the first time they create something a
     reminder would be sent for (follow-up, showing, event). Once granted, later
     launches register silently. */
  window.gdRequestPush = async () => {
    try {
      let p = await push.checkPermissions();
      if (p.receive === "prompt") p = await push.requestPermissions();
      if (p.receive === "granted") await finish();
    } catch (e) { console.warn("push: request failed", e); }
  };

  const perm = await push.checkPermissions();
  if (perm.receive === "granted") await finish();
}
