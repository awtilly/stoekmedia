import { initializeApp } from "./vendor/firebase.js";
import { getAuth, initializeAuth, indexedDBLocalPersistence } from "./vendor/firebase.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "./vendor/firebase.js";
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
   capacitor:// scheme; native gets a plain IndexedDB-persisted auth instead. */
export const auth = IS_NATIVE
  ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
  : getAuth(app);
/* Offline cache: client lists, listings and the calendar render instantly from
   IndexedDB and sync when the connection returns. Multi-tab safe. */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  /* WKWebView's streaming transport breaks Firestore's WebChannel — listeners
     silently die and retry forever. Long polling is the reliable path there. */
  ...(IS_NATIVE ? { experimentalForceLongPolling: true } : {})
});
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
export { httpsCallable };
