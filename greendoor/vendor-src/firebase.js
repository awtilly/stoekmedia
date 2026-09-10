/* Single-file Firebase bundle for GreenDoor.
   Explicit re-exports only — everything the app imports, nothing more.
   Rebuild with: npm run vendor */
export { initializeApp } from 'firebase/app';
export {
  getAuth, initializeAuth, indexedDBLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, confirmPasswordReset, verifyPasswordResetCode
} from 'firebase/auth';
export {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager, memoryLocalCache,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, onSnapshot,
  getCountFromServer, writeBatch, serverTimestamp, Timestamp
} from 'firebase/firestore';
export {
  getStorage, ref, uploadBytes, uploadBytesResumable,
  getDownloadURL, deleteObject, listAll
} from 'firebase/storage';
export { getFunctions, httpsCallable } from 'firebase/functions';
export { setLogLevel } from 'firebase/firestore';
