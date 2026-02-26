import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
export const db = getFirestore(app);
export const storage = getStorage(app);
