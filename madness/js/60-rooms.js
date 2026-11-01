/* ── State Persistence ── */
const VIEW_LOCAL = ['phase','bracketRegion','fr','fs','liveScoresDate','liveScoresFilter'];

let _isRemoteUpdate = false;
let _firestoreWriteTimer = null;
// Serialized shared state as last written to, or applied from, Firestore. A snapshot carrying the
// same string has nothing new (it is the echo of our own write, or a metadata-only change), so
// _applyRoomSnapshot skips the JSON.parse + full render for it.
let _lastSyncedState = null;
// Newest snapshot that arrived while a pick transaction was in flight ({gen, doc}); see replayDroppedSnapshot.
let _droppedDuringPick = null;
function _debouncedFirestoreWrite(){
  clearTimeout(_firestoreWriteTimer);
  const target = roomId; // the room this change was made in
  _firestoreWriteTimer = setTimeout(() => {
    _firestoreWriteTimer = null;
    // Only write into the room the change belongs to. roomId is read again here because goHome +
    // rejoin inside the 800 ms window used to push the previous room's (or a stale cached) state
    // into the newly entered room.
    if(!roomId || roomId !== target || _isRemoteUpdate) return;
    _writeSharedState();
  }, 800);
}

/* Write the shared (non-view) part of S to the current room's document now. */
function _writeSharedState(){
  const shared = {};
  for(const k in S){ if(!VIEW_LOCAL.includes(k)) shared[k] = S[k]; }
  const json = JSON.stringify(shared);
  _lastSyncedState = json;
  db.collection("rooms").doc(roomId).set({
    state: json,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, {merge: true}).catch(e => {
    console.warn("Firestore write error:", e);
    showToast("Sync error \u2014 changes saved locally");
  });
}

/* Send a pending debounced write right away. Call BEFORE roomId or S change (goHome), so the last
 * edit made in a room reaches that room instead of being dropped or landing in the next one. */
function flushFirestoreWrite(){
  if(_firestoreWriteTimer === null) return;
  clearTimeout(_firestoreWriteTimer);
  _firestoreWriteTimer = null;
  if(roomId && !_isRemoteUpdate) _writeSharedState();
}

function saveState(){
  try { localStorage.setItem(stateKey(), JSON.stringify(S)); } catch(e){}
  if(roomId && !_isRemoteUpdate) _debouncedFirestoreWrite();
}

/* Replace S with the defaults plus whatever this room (or offline play) last cached locally. */
function loadState(){
  S = defaultState();
  try {
    const s = localStorage.getItem(stateKey());
    if(s) Object.assign(S, JSON.parse(s));
    sanitizeSharedState(S);
    // Reconstruct Firestore Timestamp from serialized JSON
    if(S.ds && S.ds.pickDeadline && typeof S.ds.pickDeadline === 'object' && S.ds.pickDeadline.seconds){
      S.ds.pickDeadline = new firebase.firestore.Timestamp(S.ds.pickDeadline.seconds, S.ds.pickDeadline.nanoseconds || 0);
    }
  } catch(e){}
}

/* ── Room Management ── */
async function createRoom(){
  const nameInput = document.getElementById("room-name");
  const raw = nameInput ? nameInput.value.trim() : '';
  if(!raw){ await appAlert("Enter a room name."); return; }
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.length < 2 || code.length > 20){ await appAlert("Room name must be 2-20 letters/numbers."); return; }
  // Courtesy check only (offline with nothing cached it rejects; the transaction below is the real guard).
  const existing = await db.collection("rooms").doc(code).get().catch(() => ({ exists: false }));
  if(existing.exists){ await appAlert("That room name is already taken. Try another."); return; }
  const pin = await appPrompt("Set a 4-digit admin PIN to protect editing:", { title: 'Set Admin PIN', placeholder: '4-digit PIN' });
  if(!pin || !/^\d{4}$/.test(pin.trim())){ await appAlert("PIN must be exactly 4 digits."); return; }
  const hashedPin = await hashPin(pin.trim());
  roomId = code;
  const url = new URL(window.location);
  url.searchParams.set("room", code);
  window.history.replaceState({}, "", url);
  loadState();
  if(!S.bracket) S.bracket = {South:Array(15).fill(null), East:Array(15).fill(null), Midwest:Array(15).fill(null), West:Array(15).fill(null), ff:Array(3).fill(null)};
  if(!S.bracketRegion) S.bracketRegion = "South";
  if(!S.games) S.games = [];
  syncGames();
  // Create inside a transaction: the get() above is only a courtesy check. If someone else grabbed the
  // same code in the meantime, their room (and admin PIN) must not be overwritten.
  const ref = db.collection("rooms").doc(code);
  let created = false, failure = null;
  try {
    created = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if(snap.exists) return false;
      tx.set(ref, { adminPin: hashedPin, state: JSON.stringify(S), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      return true;
    });
  } catch(e){ console.warn("Room create error:", e); failure = e; }
  if(!created){
    roomId = null;
    loadState();
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
    await appAlert(failure ? "Couldn't create the room (offline?). Check your connection and try again." : "That room name was just taken. Try another.");
    return;
  }
  unlockAdmin();
  connectToRoom(code);
  render();
}

function joinRoom(){
  const code = sanitizeRoomCode(document.getElementById("room-code").value);
  if(!code){ showToast('Room code must be 2-20 letters or numbers'); return; }
  roomId = code;
  const url = new URL(window.location);
  url.searchParams.set("room", code);
  window.history.replaceState({}, "", url);
  loadState();
  checkAdminSession();
  connectToRoom(code);
  render();
}

function connectToRoom(code){
  if(unsubRoom) unsubRoom();
  saveRecentRoom(code);
  const gen = ++_roomGeneration;
  _lastSyncedState = null; // never let the previous room's string suppress this room's first snapshot
  _droppedDuringPick = null;
  unsubRoom = db.collection("rooms").doc(code).onSnapshot(doc => {
    if(gen !== _roomGeneration) return; // stale listener
    // Calibrate the draft clock against Firestore's clock (defined in 80-pages.js; unit tests load this file alone).
    if(typeof noteServerTime === 'function') noteServerTime(doc);
    // A pick transaction is currently writing — drop this snapshot.
    // Our transaction commit will deliver its own snapshot with the post-pick state shortly.
    if(_pickInFlight){ _droppedDuringPick = { gen, doc }; return; }
    _applyRoomSnapshot(doc);
  }, err => {
    console.warn("Firestore listen error:", err);
    showToast("Connection error \u2014 working offline");
  });
}

/* Apply the newest snapshot dropped while a pick transaction was in flight. pickTeam calls this once the
 * transaction settles. Without it, a failed pick (team just taken, turn moved on) left the UI on the
 * pre-snapshot state until someone else changed the room, and a commit whose watch update arrived before
 * the transaction promise resolved was dropped the same way. The _lastSyncedState guard makes replaying
 * a snapshot we have since applied free. */
function replayDroppedSnapshot(){
  const d = _droppedDuringPick;
  _droppedDuringPick = null;
  if(!d || d.gen !== _roomGeneration || _pickInFlight) return;
  _applyRoomSnapshot(d.doc);
}

function _applyRoomSnapshot(doc){
  if(!doc.exists){
    // Offline with nothing cached: wait for the server instead of deciding the room is gone.
    if(doc.metadata && doc.metadata.fromCache) return;
    // Unknown code (typo or deleted room). Never create it from here: that used to upload whatever
    // state was in memory (usually the previous room's players and picks) under the new code.
    const code = roomId;
    forgetRecentRoom(code);
    goHome();
    showToast('Room ' + code + ' not found');
    return;
  }
  const data = doc.data();
  if(!data || !data.state) return;
  // Firestore delivers our own write back twice (latency-compensated, then server-acked with the
  // real updatedAt). Both carry the exact string we wrote, so neither needs a parse or a redraw.
  if(data.state === _lastSyncedState) return;
  _lastSyncedState = data.state;
  _isRemoteUpdate = true; // gates saveState's Firestore write; MUST clear even if the parse or render throws
  try {
    const local = {};
    for(const k of VIEW_LOCAL) local[k] = S[k];
    const remote = JSON.parse(data.state);
    Object.assign(S, remote, local);
    sanitizeSharedState(S);
    if(S.ds && S.ds.pickDeadline && typeof S.ds.pickDeadline === 'object' && S.ds.pickDeadline.seconds){
      S.ds.pickDeadline = new firebase.firestore.Timestamp(S.ds.pickDeadline.seconds, S.ds.pickDeadline.nanoseconds || 0);
    }
    localStorage.setItem(stateKey(), JSON.stringify(S));
    render();
    updateAppBadge();
    if('Notification' in window && Notification.permission === 'granted') initFCM().catch(() => {});
  } finally {
    _isRemoteUpdate = false;
  }
}

function getRecentRooms(){
  try {
    const rooms = JSON.parse(localStorage.getItem('mm4_rooms') || '[]');
    // Codes saved before the URL/Join box were sanitised may be junk; the lobby puts them inside an
    // inline onclick string, so only clean codes get a button (escapeHtml decodes back to a quote there).
    return rooms.filter(r => r && typeof r.code === 'string' && sanitizeRoomCode(r.code) === r.code).slice(0, 5);
  } catch(e){ return []; }
}

function saveRecentRoom(code){
  try {
    let rooms = JSON.parse(localStorage.getItem('mm4_rooms') || '[]');
    rooms = rooms.filter(r => r.code !== code);
    rooms.unshift({ code, ts: Date.now() });
    localStorage.setItem('mm4_rooms', JSON.stringify(rooms.slice(0, 10)));
  } catch(e){}
}

/* One-time migration from the single "mm4" key. Before per-room keys, "mm4" held the cached copy of
 * whichever room was open last. Move it under that room's key so the user keeps their cache and
 * Play Offline does not open on the old room's players and picks. Leave it alone when there is no
 * recent room (then it really is offline state). */
function migrateLegacyStateKey(){
  try {
    if(localStorage.getItem('mm4_state_migrated')) return;
    const legacy = localStorage.getItem('mm4');
    const rooms = JSON.parse(localStorage.getItem('mm4_rooms') || '[]');
    const last = rooms[0] && rooms[0].code;
    if(legacy && last){
      if(!localStorage.getItem('mm4_state_' + last)) localStorage.setItem('mm4_state_' + last, legacy);
      localStorage.removeItem('mm4');
    }
    localStorage.setItem('mm4_state_migrated', '1');
  } catch(e){}
}
migrateLegacyStateKey(); // runs once at load, before boot reads any cache

function forgetRecentRoom(code){
  try {
    const rooms = JSON.parse(localStorage.getItem('mm4_rooms') || '[]').filter(r => r && r.code !== code);
    localStorage.setItem('mm4_rooms', JSON.stringify(rooms));
  } catch(e){}
}

function rejoinRoom(code){
  code = sanitizeRoomCode(code);
  if(!code) return;
  roomId = code;
  const url = new URL(window.location);
  url.searchParams.set("room", code);
  window.history.replaceState({}, "", url);
  loadState();
  checkAdminSession();
  connectToRoom(code);
  render();
}

function renderLobby(){
  const recent = getRecentRooms();
  document.getElementById("app").innerHTML = `
    <div class="lobby">
      ${appTitleHTML()}
      <p class="lobby-sub">Create or join a room to sync brackets with friends in real time.</p>
      ${recent.length > 0 ? `
      <div class="lobby-card">
        <h3>Your Tournaments</h3>
        <p>Rejoin a tournament you've been in.</p>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${recent.map(r => `<button class="btn btn-primary" style="width:100%;justify-content:center" onclick="rejoinRoom('${escapeHtml(r.code)}')">${escapeHtml(r.code)}</button>`).join('')}
        </div>
      </div>
      <div class="lobby-or">\u2014 or \u2014</div>` : ''}
      <div class="lobby-card">
        <h3>Create a Room</h3>
        <p>Choose a name for your room and share it with friends.</p>
        <div class="row" style="gap:8px">
          <input id="room-name" placeholder="Room name..." style="flex:1;text-transform:uppercase" onkeydown="if(event.key==='Enter')createRoom()">
          <button class="btn btn-primary" onclick="createRoom()">Create</button>
        </div>
      </div>
      <div class="lobby-or">\u2014 or \u2014</div>
      <div class="lobby-card">
        <h3>Join a Room</h3>
        <p>Enter a room code to join an existing tournament.</p>
        <div class="row" style="gap:8px">
          <input id="room-code" placeholder="Room code..." style="flex:1;text-transform:uppercase" onkeydown="if(event.key==='Enter')joinRoom()">
          <button class="btn btn-primary" onclick="joinRoom()">Join</button>
        </div>
      </div>
      <div style="margin-top:24px;border-top:1px solid var(--g200);padding-top:20px">
        <button class="btn btn-secondary" onclick="startLocal()">Play Offline Instead</button>
      </div>
    </div>`;
  repositionInstallBanner();
}

function startLocal(){
  roomId = null;
  const url = new URL(window.location);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
  loadState();
  render();
}

