import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, showToast } from "./auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const profile = await getCurrentUser();
  if (!profile) return;

  document.getElementById("set-fullName").value = profile.fullName || "";
  document.getElementById("set-phone").value = profile.phone || "";
  document.getElementById("set-company").value = profile.company || "";
  document.getElementById("set-emailSignature").value = profile.emailSignature || "";

  document.getElementById("settings-loading").classList.add("gd-hidden");
  document.getElementById("settings-content").classList.remove("gd-hidden");
});

window.saveProfile = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const data = {
    fullName: document.getElementById("set-fullName").value.trim(),
    phone: document.getElementById("set-phone").value.trim(),
    company: document.getElementById("set-company").value.trim(),
    emailSignature: document.getElementById("set-emailSignature").value
  };

  try {
    await setDoc(doc(db, "users", user.uid), data, { merge: true });
    showToast("Profile saved!");
  } catch (e) {
    console.error("Save profile error:", e);
    showToast("Failed to save profile.", "error");
  }
};
