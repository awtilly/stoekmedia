/* ── State Persistence ── */
const VIEW_LOCAL = ['phase','bracketRegion','fr','fs','liveScoresDate','liveScoresFilter'];
// Player ids in the last room snapshot we applied; lets mergeSharedState tell "removed here" from "added elsewhere".
let _lastSnapshotPlayerIds = null;
// The shared part of S as this device last received it from, or sent it to, Firestore (taken from S itself, so
// it compares cleanly against S). Baseline for _pendingLocalEdits().
let _syncedShared = null;

function _sharedCopyOfS(){
  const shared = {};
  for(const k in S){ if(!VIEW_LOCAL.includes(k)) shared[k] = S[k]; }
  return JSON.parse(JSON.stringify(shared));
}

/* Shared keys this device has changed since the last sync while that change is still waiting in the 800 ms
 * debounce. A snapshot arriving in that window used to replace S wholesale: the edit vanished from the screen and
 * the debounce then wrote the server's own state back, so it never reached anyone. Returns {key: value to keep}
 * or null. ds and players follow the same rules as the write (mergeSharedState): the server's draft progress
 * wins, local roster changes are kept. */
function _pendingLocalEdits(remote, baseRaw){
  if(!_firestoreWriteTimer || !_syncedShared) return null;
  const edits = {};
  let any = false;
  for(const k in S){
    if(VIEW_LOCAL.includes(k)) continue;
    if(JSON.stringify(S[k]) !== JSON.stringify(_syncedShared[k])){ edits[k] = S[k]; any = true; }
  }
  // A key the snapshot changed as well is a real conflict: the snapshot wins, as it always has (another phone
  // may have advanced more of the bracket than this one). ds and players have a proper merge below instead.
  let raw = null;
  try { raw = baseRaw ? JSON.parse(baseRaw) : null; } catch(e){} // baseRaw: _syncBase as it was before this snapshot
  for(const k of Object.keys(edits)){
    if(k === 'ds' || k === 'players') continue;
    if(!raw || JSON.stringify(remote[k]) !== JSON.stringify(raw[k])) delete edits[k];
  }
  if(!Object.keys(edits).length) return null;
  if('ds' in edits || 'players' in edits){
    const merged = mergeSharedState({ ds: S.ds, players: S.players }, remote, _lastSnapshotPlayerIds);
    if('ds' in edits) edits.ds = merged.ds;
    if('players' in edits) edits.players = merged.players;
  }
  return edits;
}

let _isRemoteUpdate = false;
let _firestoreWriteTimer = null;
// Serialized shared state as last written to, or applied from, Firestore. A snapshot carrying the
// same string has nothing new (it is the echo of our own write, or a metadata-only change), so
// _applyRoomSnapshot skips the JSON.parse + full render for it.
let _lastSyncedState = null;
// The shared state as this device last received it from, or handed it to, Firestore (a JSON string). What S
// differs from it by is what this device has edited since: the base of the merge in _writeSharedState.
let _syncBase = null;
// The shared part of S, serialised from S itself, as of the last snapshot applied or write sent. A save that
// finds it unchanged (a tab switch, a Live filter: view-only keys) has nothing to send. Writing anyway cost a
// document write plus a snapshot on every phone in the room, and it sent this phone's whole copy of the room:
// a phone that was behind (offline, just woken) rolled everyone back to its old copy by switching tabs.
let _sharedAtSync = null;
function _sharedJson(){
  const shared = {};
  for(const k in S){ if(!VIEW_LOCAL.includes(k)) shared[k] = S[k]; }
  return JSON.stringify(shared);
}
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

/* The plain merge write (what every write was before the transaction): Firestore queues it offline and
 * flushes it on reconnect. While still in that room it sends what the device holds NOW, so two fallbacks
 * that finish out of order cannot put an older edit on top of a newer one; `json` is only used for a room
 * that has been left in the meantime. set() resolves once the server has the write (it stays pending while
 * offline), which is how _writeSharedState knows a queued write is still on its way. */
let _queuedPlainWrites = {}; // room id -> plain writes handed to Firestore and not yet acknowledged by the server
// Saves retried after a write failed outright (not offline: see the catch in _writeSharedState). Reset by a write
// that gets through and on entering a room.
let _writeRetries = 0;
function _plainSharedWrite(ref, json){
  const id = ref.id;
  _queuedPlainWrites[id] = (_queuedPlainWrites[id] || 0) + 1;
  const settled = () => { if(--_queuedPlainWrites[id] <= 0) delete _queuedPlainWrites[id]; };
  if(roomId && ref.id === roomId){
    const cur = {};
    for(const k in S){ if(!VIEW_LOCAL.includes(k)) cur[k] = S[k]; }
    json = JSON.stringify(cur);
    _lastSyncedState = json;
    _syncBase = json;
    _sharedAtSync = json;
  }
  ref.set({ state: json, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge: true})
    .then(settled, err => { settled(); console.warn("Firestore offline write error:", err); });
}

/* Write the shared (non-view) part of S to the current room's document now. */
function _writeSharedState(){
  const localJson = _sharedJson();
  if(localJson === _sharedAtSync) return; // nothing shared changed since the last sync
  _sharedAtSync = localJson;
  // A private copy: S can move on (a snapshot, another edit) while the transaction below is retried.
  const shared = JSON.parse(localJson);
  // The server state this device last synced with. Only the keys edited since then are ours to send; every
  // other key goes out as the server holds it at commit time, so a change another device made in the meantime
  // (even one that lands while this write is in flight) is not overwritten with our older copy of it.
  const baseAtStart = _syncBase;
  let base = null;
  try { base = baseAtStart ? JSON.parse(baseAtStart) : null; } catch(e){}
  const mine = base && Object.keys(shared).filter(k => JSON.stringify(shared[k]) !== JSON.stringify(base[k]));
  _syncBase = localJson; // these edits are now with this write; the next write sends only what changes after this
  _syncedShared = JSON.parse(localJson); // nothing is pending any more: this is what the server is being sent
  let expectSynced = _lastSyncedState; // what _lastSyncedState holds unless a snapshot is applied during the write
  let snapshotDuringWrite = false;
  const ref = db.collection("rooms").doc(roomId);
  // A transaction needs the network and only gives up after several retries. Known offline: queue the plain
  // write at once, so the edit is already in Firestore's offline queue if the tab is closed a second later.
  // Same while an earlier plain write for this room is still waiting in that queue (the connection has only just
  // come back): Firestore sends its queue in order, but a transaction does not wait for it. The transaction would
  // commit first and the older queued copy of the room would then land on top of it, undoing this edit.
  if((typeof navigator !== 'undefined' && navigator.onLine === false) || _queuedPlainWrites[roomId]){ _plainSharedWrite(ref, localJson); return; }
  // Transaction + mergeSharedState: never roll back a pick that landed since our last snapshot.
  let writtenIds = null;
  // The roster our copy was taken from. Read now, not inside the transaction: a snapshot that arrives while the
  // write is being retried would otherwise make a player somebody else has just added look like one we removed.
  const knownIds = _lastSnapshotPlayerIds;
  db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    // Cleaned like every copy this device shows: the merge below reads its roster and draft state.
    const remote = snap.exists && snap.data().state ? sanitizeSharedState(JSON.parse(snap.data().state)) : null;
    let ours = shared;
    if(remote && mine){
      // Same key order as our own copy, so an untouched server gives back exactly localJson.
      ours = {};
      for(const k in shared) ours[k] = (mine.includes(k) || !(k in remote)) ? shared[k] : remote[k];
      for(const k in remote){ if(!(k in ours) && !VIEW_LOCAL.includes(k)) ours[k] = remote[k]; }
    }
    const merged = remote ? mergeSharedState(ours, remote, knownIds) : ours;
    const json = JSON.stringify(merged);
    writtenIds = (merged.players || []).map(p => p.id);
    // The echo of this write is skipped by _applyRoomSnapshot only when it carries exactly what we
    // sent from. If the merge took anything from the server (draft progress, another device's edit), or
    // a snapshot replaced S while the write was in flight, leave the echo to be applied so this device
    // ends up showing what the server holds.
    if(_lastSyncedState !== expectSynced) snapshotDuringWrite = true;
    _lastSyncedState = expectSynced = (json === localJson && !snapshotDuringWrite) ? json : null;
    tx.set(ref, {
      state: json,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge: true});
  }).then(() => {
    // The server now holds the roster we just wrote, and our own echo is skipped by _applyRoomSnapshot, so
    // record it here. Otherwise a player added on this device and then removed on this device would look
    // like "added elsewhere" to the next merge and come straight back.
    if(writtenIds && roomId && ref.id === roomId) _lastSnapshotPlayerIds = Array.from(new Set((_lastSnapshotPlayerIds || []).concat(writtenIds)));
    _writeRetries = 0;
  }).catch(e => {
    // Transactions need the network. Offline, fall back to the plain merge write, which Firestore
    // queues and flushes on reconnect (the pre-transaction behaviour).
    if(e && (e.code === 'unavailable' || e.code === 'failed-precondition' || (typeof navigator !== 'undefined' && navigator.onLine === false))){
      _plainSharedWrite(ref, localJson);
      return;
    }
    // Nothing was written: go back to the earlier base, so the next write still carries these edits. The
    // pending-edit baseline goes back too (unless a snapshot moved it on during the write): until the save is
    // retried, a snapshot from another phone must keep these edits the way it keeps an edit in the debounce.
    if(_syncBase === localJson){
      _syncBase = baseAtStart;
      try { _syncedShared = baseAtStart ? JSON.parse(baseAtStart) : null; } catch(err){}
    }
    if(_sharedAtSync === localJson) _sharedAtSync = null;
    console.warn("Firestore write error:", e);
    // Try again shortly rather than waiting for the next save: the toast used to promise "saved locally", but
    // the next snapshot replaced S and the local copy and nothing was armed to send the edit again. A few tries,
    // then give up: a write the server refuses for good would otherwise loop every 800 ms while the tab is open.
    if(roomId && ref.id === roomId && ++_writeRetries <= 5){
      _debouncedFirestoreWrite();
      showToast("Sync error \u2014 trying again");
    } else {
      showToast("Sync error \u2014 changes saved locally");
    }
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
  S.joinKey = newJoinKey();
  rememberJoinKey(code, S.joinKey);
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
  _lastSnapshotPlayerIds = null; // the previous room's roster says nothing about this one
  _syncedShared = null;
  saveRecentRoom(code);
  const gen = ++_roomGeneration;
  _lastSyncedState = null; // never let the previous room's string suppress this room's first snapshot
  _syncBase = null;
  // What this phone holds on entering a room is its cached copy of that room (or the state createRoom has just
  // written), not an edit: with no snapshot yet (offline, nothing in Firestore's cache) a tab switch must not send it.
  _sharedAtSync = _sharedJson();
  _droppedDuringPick = null;
  _writeRetries = 0;
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
  const baseBefore = _syncBase; // what this device had synced before this snapshot (a string: nothing in S can alias it)
  _syncBase = data.state;
  _isRemoteUpdate = true; // gates saveState's Firestore write; MUST clear even if the parse or render throws
  try {
    const local = {};
    for(const k of VIEW_LOCAL) local[k] = S[k];
    const remote = sanitizeSharedState(JSON.parse(data.state)); // cleaned before the roster and the pending-edit merge read it
    const pending = _pendingLocalEdits(remote, baseBefore); // before the roster ids and S move on to this snapshot
    _lastSnapshotPlayerIds = (remote.players || []).map(p => p.id);
    Object.assign(S, remote, local, pending || {});
    sanitizeSharedState(S);
    if(S.ds && S.ds.pickDeadline && typeof S.ds.pickDeadline === 'object' && S.ds.pickDeadline.seconds){
      S.ds.pickDeadline = new firebase.firestore.Timestamp(S.ds.pickDeadline.seconds, S.ds.pickDeadline.nanoseconds || 0);
    }
    // Baseline = what the server holds. Keys kept from a pending edit stay "edited" (the debounce is still
    // running and will send them), so a second snapshot in the same window does not wipe them either.
    _syncedShared = _sharedCopyOfS();
    if(pending) for(const k in pending) _syncedShared[k] = remote[k] === undefined ? undefined : JSON.parse(JSON.stringify(remote[k])); // a copy: S may hold the same object
    // The no-change baseline is the server's state in S's key order, not S itself: a pending edit kept above
    // still has to count as a change when the debounce fires.
    _sharedAtSync = JSON.stringify(_syncedShared);
    // The offline copy is a convenience; a full storage must not stop the screen from updating.
    try { localStorage.setItem(stateKey(), JSON.stringify(S)); } catch(e){}
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

