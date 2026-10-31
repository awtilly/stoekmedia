/* ── Security: SHA-256 Hashing (salted) ── */
function generateSalt(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function rawHash(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin) {
  const salt = generateSalt();
  const hash = await rawHash(salt + pin);
  return salt + ':' + hash;
}

async function verifyPin(pin, stored) {
  // New salted format: "salt:hash"
  if (stored.includes(':')) {
    const [salt, hash] = stored.split(':');
    return (await rawHash(salt + pin)) === hash;
  }
  // Legacy unsalted 64-char hex hash — verify then migrate
  return (await rawHash(pin)) === stored;
}

async function migratePin(pin) {
  return await hashPin(pin);
}

/* ── Admin PIN Protection ── */
let adminUnlocked = false;

const ADMIN_SESSION_HOURS = 4;
function adminSessionKey(){ return roomId ? 'mm4_admin_' + roomId : null; }

function checkAdminSession(){
  if(!roomId){ adminUnlocked = false; return; }
  const k = adminSessionKey();
  if(!k){ adminUnlocked = false; return; }
  try {
    const raw = localStorage.getItem(k);
    if(!raw){ adminUnlocked = false; return; }
    const ts = Number(raw);
    if(Date.now() - ts > ADMIN_SESSION_HOURS * 3600 * 1000){
      localStorage.removeItem(k);
      adminUnlocked = false;
    } else {
      adminUnlocked = true;
    }
  } catch(e){ adminUnlocked = false; }
}

function unlockAdmin(){
  adminUnlocked = true;
  const k = adminSessionKey();
  if(k) localStorage.setItem(k, String(Date.now()));
}

function lockAdmin(){
  adminUnlocked = false;
  const k = adminSessionKey();
  if(k) localStorage.removeItem(k);
  render();
}

let _pinFailCount = 0;

/* True only when a stored session exists and is older than the 4 h window. */
function adminSessionExpired(){
  const k = adminSessionKey();
  if(!k) return false;
  try {
    const raw = localStorage.getItem(k);
    if(!raw) return false;
    return Date.now() - Number(raw) > ADMIN_SESSION_HOURS * 3600 * 1000;
  } catch(e){ return false; }
}

async function requireAdmin(){
  if(!roomId) return true;
  // A tab left open past the 4 h window stays unlocked in memory; drop it so the PIN is asked again.
  if(adminUnlocked && adminSessionExpired()) checkAdminSession();
  if(adminUnlocked) return true;
  let doc;
  try {
    doc = await db.collection("rooms").doc(roomId).get();
  } catch(e){
    console.warn('requireAdmin: could not read the room', e);
    showToast("Can't verify the PIN right now. Check your connection and try again.");
    return false;
  }
  const data = doc.exists ? doc.data() : null;
  if(!data || !data.adminPin){
    const pin = await appPrompt("This room has no admin PIN yet.\nSet a 4-digit PIN to protect editing:", { title: 'Set Admin PIN', placeholder: '4-digit PIN' });
    if(!pin || !/^\d{4}$/.test(pin.trim())){ await appAlert("PIN must be exactly 4 digits."); return false; }
    const hashed = await hashPin(pin.trim());
    // Two devices can both see "no PIN yet". The first PIN written wins; the other device is told and asked for it,
    // instead of silently replacing the commissioner's PIN with its own.
    const ref = db.collection("rooms").doc(roomId);
    let alreadySet = false;
    try {
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        const d = cur.exists ? cur.data() : null;
        if(d && d.adminPin){ alreadySet = true; return; }
        tx.set(ref, { adminPin: hashed, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
    } catch(e){
      console.warn('requireAdmin: could not save the PIN', e);
      showToast("Couldn't save the PIN. Check your connection and try again.");
      return false;
    }
    if(alreadySet){
      await appAlert("Someone else just set this room's admin PIN. Enter that PIN to continue.");
      return requireAdmin();
    }
    unlockAdmin();
    return true;
  }

  // Rate-limit: exponential backoff after failures
  if (_pinFailCount > 0) {
    const delay = Math.min(1000 * Math.pow(2, _pinFailCount - 1), 8000);
    await new Promise(r => setTimeout(r, delay));
  }

  const entry = await appPrompt("Enter 4-digit admin PIN:", { title: 'Admin PIN' });
  if(!entry) return false;

  /* Legacy plaintext PIN migration (no colon, not 64 hex chars) */
  if(!data.adminPin.includes(':') && data.adminPin.length !== 64){
    if(entry.trim() === data.adminPin){
      const hashed = await hashPin(entry.trim());
      await db.collection("rooms").doc(roomId).set({ adminPin: hashed, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      _pinFailCount = 0;
      unlockAdmin();
      return true;
    }
    _pinFailCount++;
    await appAlert("Incorrect PIN.");
    return false;
  }

  const ok = await verifyPin(entry.trim(), data.adminPin);
  if(ok){
    // Migrate unsalted hash to salted on successful verify
    if(!data.adminPin.includes(':')){
      const salted = await migratePin(entry.trim());
      await db.collection("rooms").doc(roomId).set({ adminPin: salted, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    _pinFailCount = 0;
    unlockAdmin();
    return true;
  }
  _pinFailCount++;
  await appAlert("Incorrect PIN.");
  return false;
}

/* ── Player Identity ── */
function getMyPlayerId(){ return roomId ? localStorage.getItem('mm4_me_' + roomId) : null; }
function setMyPlayerId(id){ if(roomId) localStorage.setItem('mm4_me_' + roomId, id); }

async function claimPlayer(id){
  const player = S.players.find(p => p.id === id);
  if(!player) return;
  // If player has a PIN hash, require PIN entry
  if(player.pinHash){
    const pin = await appPrompt('Enter your 4-digit PIN:', { title: 'Verify Identity' });
    if(!pin) return;
    const ok = await verifyPin(pin.trim(), player.pinHash);
    if(!ok){
      await appAlert('Incorrect PIN.');
      return;
    }
    // Migrate unsalted to salted
    if(!player.pinHash.includes(':')){
      player.pinHash = await migratePin(pin.trim());
      saveState();
    }
  } else if(player.passphraseHash){
    // Legacy passphrase support: prompt, verify, then migrate to PIN
    const pass = await appPrompt('Enter your passphrase:', { title: 'Verify Identity' });
    if(!pass) return;
    const ok = await verifyPin(pass.trim(), player.passphraseHash);
    if(!ok){
      await appAlert('Incorrect passphrase.');
      return;
    }
    // Migrate: prompt for new PIN
    const newPin = await appPrompt('Set a 4-digit PIN to replace your passphrase:', { title: 'Upgrade to PIN', placeholder: '4-digit PIN' });
    if(newPin && /^\d{4}$/.test(newPin.trim())){
      player.pinHash = await hashPin(newPin.trim());
      delete player.passphraseHash;
      saveState();
    }
  } else {
    // No credential at all (a 2026 room from before PINs, or a state edited by hand). Every
    // creation path sets a PIN, so instead of letting any tap take the seat, lock it now.
    const newPin = await appPrompt('This seat has no PIN yet. Set a 4-digit PIN to claim it:', { title: 'Set your PIN', placeholder: '4-digit PIN' });
    if(!newPin || !/^\d{4}$/.test(newPin.trim())){ showToast('PIN must be 4 digits'); return; }
    player.pinHash = await hashPin(newPin.trim());
    saveState();
  }
  setMyPlayerId(id);
  render();
}

async function selfRegister(){
  // ds.order was fixed when the draft started; a player added now has no turn and no teams (removePlayer has the same guard).
  if(S.ds && S.ds.started){ showToast('The draft has started. Ask the commissioner to reset it before new players join.'); return; }
  const name = document.getElementById('join-name').value.trim();
  const pin = document.getElementById('join-pin').value.trim();
  if(!name){ showToast('Enter your name'); return; }
  if(!/^\d{4}$/.test(pin)){ showToast('PIN must be 4 digits'); return; }
  if(S.players.some(p => p.name.toLowerCase() === name.toLowerCase())){
    showToast('That name is taken. Tap your name below to rejoin.');
    return;
  }
  const pinHash = await hashPin(pin);
  const player = { id: generateId(), name, pinHash, teamIds: [] };
  S.players.push(player);
  setMyPlayerId(player.id);
  saveState();
  render();
}

async function adminJoinAsPlayer(){
  if(!adminUnlocked) return;
  const name = await appPrompt('Enter your player name:', { title: 'Join as Player' });
  if(!name || !name.trim()) return;
  const n = name.trim();
  if(S.players.some(p => p.name.toLowerCase() === n.toLowerCase())){
    showToast('That name is already taken');
    return;
  }
  const pin = await appPrompt('Set a 4-digit PIN for ' + n + ':', { title: 'Player PIN', placeholder: '4-digit PIN' });
  if(!pin || !/^\d{4}$/.test(pin.trim())){ showToast('PIN must be 4 digits'); return; }
  const pinHash = await hashPin(pin.trim());
  const player = { id: generateId(), name: n, pinHash, teamIds: [] };
  S.players.push(player);
  setMyPlayerId(player.id);
  saveState();
  render();
}

function renderJoinScreen(){
  const players = S.players || [];
  document.getElementById("app").innerHTML = `
    <div class="lobby">
      <h1><span>March Madness</span> Draft</h1>
      <p class="lobby-sub">Welcome to room <strong>${roomId}</strong></p>
      <div class="lobby-card">
        <h3>Join as New Player</h3>
        <p>Enter your name and a 4-digit PIN to join the draft.</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="join-name" type="text" placeholder="Your name" style="width:100%" autocomplete="off">
          <input id="join-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="4-digit PIN" style="width:100%" autocomplete="off">
          <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="selfRegister()">Join</button>
        </div>
      </div>
      ${players.length > 0 ? `
        <div class="lobby-or">or</div>
        <div class="lobby-card">
          <h3>Returning Player?</h3>
          <p>Tap your name and enter your PIN to rejoin.</p>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${players.map(p => `<button class="btn btn-secondary" style="width:100%;justify-content:center" onclick="claimPlayer('${p.id}')">${escapeHtml(p.name)}</button>`).join('')}
          </div>
        </div>
      ` : ''}
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:center">
        <button class="btn btn-secondary btn-sm" onclick="goHome()">Switch Tournament</button>
      </div>
    </div>`;
}

