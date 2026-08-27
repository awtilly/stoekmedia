import { initializeApp } from "./vendor/firebase.js";
import { getAuth } from "./vendor/firebase.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "./vendor/firebase.js";
import { getStorage } from "./vendor/firebase.js";
import { getFunctions, httpsCallable } from "./vendor/firebase.js";

const firebaseConfig = {
  apiKey: "AIzaSyDEPiHPEURzn_gtiTaR-rbCGg06JYUSlQY",
  authDomain: "greendoor-2da47.firebaseapp.com",
  projectId: "greendoor-2da47",
  storageBucket: "greendoor-2da47.firebasestorage.app",
  messagingSenderId: "975315709404",
  appId: "1:975315709404:web:c03a1663f999eb49783319"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
/* Offline cache: client lists, listings and the calendar render instantly from
   IndexedDB and sync when the connection returns. Multi-tab safe. */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
export { httpsCallable };
