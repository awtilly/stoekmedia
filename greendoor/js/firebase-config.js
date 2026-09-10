import { initializeApp } from "./vendor/firebase.js";
import { getAuth, initializeAuth, browserLocalPersistence, inMemoryPersistence } from "./vendor/firebase.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from "./vendor/firebase.js";
import { getStorage } from "./vendor/firebase.js";
import { getFunctions, httpsCallable } from "./vendor/firebase.js";

/* Two keys, one project. The web key is referrer-locked to stoekmedia.com,
   which the native shell cannot satisfy (capacitor://localhost sends no
   referrer). The app key is service-scoped instead of referrer-locked. */
const IS_NATIVE = !!window.Capacitor?.isNativePlatform?.();
const firebaseConfig = {
  apiKey: IS_NATIVE
    ? "AIzaSyALFa7ZSLFR__4uxWAluXMSvXVH3_OUWfo"
    : "AIzaSyDEPiHPEURzn_gtiTaR-rbCGg06JYUSlQY",
  authDomain: "greendoor-2da47.firebaseapp.com",
  projectId: "greendoor-2da47",
  storageBucket: "greendoor-2da47.firebasestorage.app",
  messagingSenderId: "975315709404",
  appId: "1:975315709404:web:c03a1663f999eb49783319"
};

const app = initializeApp(firebaseConfig);
/* getAuth() pulls in browser popup/redirect machinery that stalls under the
   capacitor:// scheme; native gets a plain initializeAuth instead.
   Persistence is localStorage, NOT IndexedDB: WKWebView's IndexedDB can stall
   on open (seen on iOS 18.7 and again on the iOS 26.3 simulator, 2026-09-10),
   which left Auth un-resolved and every page on a spinner. localStorage is
   synchronous and persistent in Capacitor's WKWebView. */
export const auth = IS_NATIVE
  ? initializeAuth(app, { persistence: [browserLocalPersistence, inMemoryPersistence] })
  : getAuth(app);
/* Offline cache: client lists, listings and the calendar render instantly from
   IndexedDB and sync when the connection returns. Multi-tab safe. */
/* WebKit's streaming transport breaks Firestore's WebChannel — listeners
   silently die and retry forever. That's every WKWebView (native shell) AND
   Safari itself; the SDK's auto-detection doesn't catch it, so long polling
   is forced on the whole engine family. Chrome/Firefox keep the default. */
const IS_WEBKIT = IS_NATIVE || /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
/* NO IndexedDB persistence in the native shell: WKWebView's indexedDB.open()
   can hang forever (seen on iOS 18.7 — SDK stalls at "SimpleDb Opening
   database" and every query spins behind it, diag'd 2026-09-07). The app only
   does one-shot reads, so a memory cache costs little; browsers keep the
   persistent multi-tab cache. */
export const db = initializeFirestore(app, {
  localCache: IS_NATIVE
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ...(IS_WEBKIT ? { experimentalForceLongPolling: true } : {})
});
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
export { httpsCallable };
