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
// What the server held in the last snapshot this device applied (a JSON string), and the shared states this
// device's last few saves sent. _pendingLocalEdits() uses both to tell another phone's change to a key from this
// phone's own save of it that the snapshot does not show yet, or shows for the first time.
let _serverSeen = null;
let _recentSent = [];
// Counts snapshots applied; _writeSharedState uses it to see that one was applied while its write was in flight.
let _snapshotSeq = 0;
// Saves are numbered; _keyWriteNo[key] is the number of the newest save that sent that key.
let _writeSeq = 0;
let _keyWriteNo = {};
// Keys a save of this phone is carrying whose echo has not been seen yet: key -> { v: the value sent (JSON),
// no: the save's number, sent: the transaction has run, held: a snapshot without it was applied meanwhile, acked: the server confirmed the save }.
// Until the echo, a snapshot that shows nothing new for such a key (it is simply older than the save) must not
// take the value off the screen, and must not make the server's older value the baseline for the next save:
// an edit made in that window was built on a view without the first one, or was judged "nothing to send".
let _inFlight = {};
// Set by _pendingLocalEdits(): kept keys whose baseline is the value in flight, not the snapshot's (key -> JSON).
let _pendingBase = {};
// The save whose exact echo _lastSyncedState is waiting for (0: none), and the last snapshot applied.
let _echoWriteNo = 0;
let _lastRoomDoc = null;
function _pendingLocalEdits(remote, baseRaw, seenRaw){
  _pendingBase = {};
  if(!_syncedShared) return null;
  const flying = Object.keys(_inFlight);
  if(!_firestoreWriteTimer && !flying.length) return null;
  const edits = {};
  if(_firestoreWriteTimer) for(const k in S){
    if(VIEW_LOCAL.includes(k)) continue;
    if(JSON.stringify(S[k]) !== JSON.stringify(_syncedShared[k])) edits[k] = S[k];
  }
  // A key the snapshot changed as well is a real conflict: the snapshot wins, as it always has (another phone
  // may have advanced more of the bracket than this one). ds and players have a proper merge below instead.
  let raw = null, seen = null;
  try { raw = baseRaw ? JSON.parse(baseRaw) : null; } catch(e){} // baseRaw: _syncBase as it was before this snapshot
  try { seen = seenRaw ? JSON.parse(seenRaw) : null; } catch(e){} // seenRaw: the previous snapshot applied
  // The snapshot changed a key only if its value is new to this device. It is not new when it is what the server
  // already held (the snapshot is another phone's change to something else, sent before this phone's save in
  // flight landed) or what one of this phone's own recent saves put there (the echo of that save). Without
  // these two, a second tap made while the first tap's save was on its way was dropped by either snapshot.
  const isKnown = (k, theirs) => !!(raw && (theirs === JSON.stringify(raw[k]) || (seen && theirs === JSON.stringify(seen[k]))
      || _recentSent.some(sent => theirs === JSON.stringify(sent[k]))));
  // The same value in a snapshot is this save's echo only once the server has confirmed the save, or this phone
  // has been shown the room the save was built on: before that it can be an older snapshot of an older value.
  const isEcho = f => f.sent && (f.acked || f.sawPre);
  for(const k of Object.keys(edits)){
    if(k === 'ds' || k === 'players') continue;
    const theirs = JSON.stringify(remote[k]);
    const f = _inFlight[k];
    if(!isKnown(k, theirs)){ delete edits[k]; delete _inFlight[k]; continue; }
    if(!f) continue;
    // Edited again while the earlier save of this key is still on its way. If the snapshot does not show that
    // save yet, the baseline is the value in flight: the newer edit may equal what the snapshot shows and still
    // has to be sent, or the save in flight lands after it and undoes it.
    // (Also after the server has confirmed that save: a snapshot from before it can still arrive.)
    if(theirs === f.v && isEcho(f)) delete _inFlight[k]; else _pendingBase[k] = f.v;
  }
  // Keys in flight with no newer edit: keep them on screen while the snapshot is merely older than the save.
  for(const k of flying){
    const f = _inFlight[k];
    if(!f || k in edits) continue;
    const theirs = JSON.stringify(remote[k]);
    // Its echo, something new from another phone, a save the server has already confirmed (a snapshot after
    // that is the server's word), or a value this phone no longer shows: the snapshot wins, as before.
    // (The same value before the save has even been handed over is an older save's echo, not this one's.)
    if(theirs === f.v){ if(isEcho(f)) delete _inFlight[k]; continue; }
    if(f.acked || JSON.stringify(S[k]) !== f.v || !isKnown(k, theirs)){ delete _inFlight[k]; continue; }
    edits[k] = S[k];
    _pendingBase[k] = f.v;
    f.held = true;
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
  _recentSent.push(shared);
  if(_recentSent.length > 4) _recentSent.shift();
  const seqAtStart = _snapshotSeq;
  // A later save from this phone that also carries a key makes this one's copy of that key the older one.
  const writeNo = ++_writeSeq;
  // (Not ds and players: those are merged with the server's copy below, never sent as a whole.)
  if(mine) for(const k of mine){ if(k !== 'ds' && k !== 'players') _keyWriteNo[k] = writeNo; }
  const dropInFlight = () => { for(const k of Object.keys(_inFlight)){ if(_inFlight[k].no === writeNo) delete _inFlight[k]; } };
  let preState = null; // what the server held when the transaction (its last run) read the room
  let expectSynced = _lastSyncedState; // what _lastSyncedState holds unless a snapshot is applied during the write
  let snapshotDuringWrite = false;
  const ref = db.collection("rooms").doc(roomId);
  // A transaction needs the network and only gives up after several retries. Known offline: queue the plain
  // write at once, so the edit is already in Firestore's offline queue if the tab is closed a second later.
  // Same while an earlier plain write for this room is still waiting in that queue (the connection has only just
  // come back): Firestore sends its queue in order, but a transaction does not wait for it. The transaction would
  // commit first and the older queued copy of the room would then land on top of it, undoing this edit.
  if((typeof navigator !== 'undefined' && navigator.onLine === false) || _queuedPlainWrites[roomId]){ _plainSharedWrite(ref, localJson); return; }
  if(mine) for(const k of mine){ if(k !== 'ds' && k !== 'players') _inFlight[k] = { v: JSON.stringify(shared[k]), no: writeNo, sent: false, held: false, acked: false }; }
  // Transaction + mergeSharedState: never roll back a pick that landed since our last snapshot.
  let writtenIds = null;
  // The roster our copy was taken from. Read now, not inside the transaction: a snapshot that arrives while the
  // write is being retried would otherwise make a player somebody else has just added look like one we removed.
  const knownIds = _lastSnapshotPlayerIds;
  db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    // Cleaned like every copy this device shows: the merge below reads its roster and draft state.
    const remote = snap.exists && snap.data().state ? sanitizeSharedState(JSON.parse(snap.data().state)) : null;
    preState = snap.exists ? snap.data().state : null;
    for(const k in _inFlight){ if(_inFlight[k].no === writeNo){ _inFlight[k].sent = true; _inFlight[k].pre = preState; _inFlight[k].sawPre = _serverSeen === preState; } }
    let ours = shared;
    if(remote && mine){
      // Same key order as our own copy, so an untouched server gives back exactly localJson.
      ours = {};
      // Firestore re-runs this function when the document changed under it, which can be after a newer save from
      // this phone has landed: a key that newer save carries is left as the server holds it, not put back.
      for(const k in shared) ours[k] = ((mine.includes(k) && !(_keyWriteNo[k] > writeNo)) || !(k in remote)) ? shared[k] : remote[k];
      for(const k in remote){ if(!(k in ours) && !VIEW_LOCAL.includes(k)) ours[k] = remote[k]; }
    }
    const merged = remote ? mergeSharedState(ours, remote, knownIds) : ours;
    const json = JSON.stringify(merged);
    writtenIds = (merged.players || []).map(p => p.id);
    // The echo of this write is skipped by _applyRoomSnapshot only when it carries exactly what we
    // sent from. If the merge took anything from the server (draft progress, another device's edit), or
    // a snapshot replaced S while the write was in flight, leave the echo to be applied so this device
    // ends up showing what the server holds.
    if(_lastSyncedState !== expectSynced || _snapshotSeq !== seqAtStart) snapshotDuringWrite = true; // the count: two snapshots can end on the string we started from
    _lastSyncedState = expectSynced = (json === localJson && !snapshotDuringWrite) ? json : null;
    if(_lastSyncedState !== null) _echoWriteNo = writeNo;
    tx.set(ref, {
      state: json,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge: true});
  }).then(() => {
    // The server now holds the roster we just wrote, and our own echo is skipped by _applyRoomSnapshot, so
    // record it here. Otherwise a player added on this device and then removed on this device would look
    // like "added elsewhere" to the next merge and come straight back.
    if(writtenIds && roomId && ref.id === roomId){
      // Unless a snapshot was applied while this save was on its way: it put the server's roster on screen, without
      // the players this save was adding. Calling those "known" made the next roster edit from this phone read
      // "known, but not here" as "removed here" and delete them on the server. Only the ones still shown count.
      const shown = _snapshotSeq === seqAtStart ? null : new Set((S.players || []).map(p => p.id));
      // And only the ones this phone sent: a player the merge took from the server (added on another phone while this
      // save was on its way) is not on this screen yet. Known-but-not-here reads as "removed here" in the next merge.
      const sentIds = new Set((shared.players || []).map(p => p.id));
      _lastSnapshotPlayerIds = Array.from(new Set((_lastSnapshotPlayerIds || []).concat(writtenIds.filter(id => sentIds.has(id) && (!shown || shown.has(id))))));
    }
    _writeRetries = 0;
    // The server has the save. A key of it that a snapshot was held back for: if that snapshot is not the state
    // the transaction read (so it may already be newer than this save, with another phone's change on top), show
    // what it said after all. Otherwise the echo is still to come; from here on any snapshot is taken at its word.
    let reapply = false;
    for(const k of Object.keys(_inFlight)){
      const f = _inFlight[k];
      if(f.no !== writeNo) continue;
      f.acked = true;
      // Not a key edited again since (that edit is waiting in the debounce): the older snapshot's value would become
      // its baseline, and where the two are equal the newer edit was judged "nothing to send". It stays in flight,
      // confirmed, so the baseline stays the value this save sent until its echo or the newer save.
      if(f.held && _serverSeen !== preState && JSON.stringify(S[k]) === f.v){ delete _inFlight[k]; reapply = true; }
    }
    if(reapply && roomId && ref.id === roomId && _lastRoomDoc && !_pickInFlight){
      _lastSyncedState = null;
      _applyRoomSnapshot(_lastRoomDoc);
    }
  }).catch(e => {
    // Transactions need the network. Offline, fall back to the plain merge write, which Firestore
    // queues and flushes on reconnect (the pre-transaction behaviour).
    if(e && (e.code === 'unavailable' || e.code === 'failed-precondition' || (typeof navigator !== 'undefined' && navigator.onLine === false))){
      dropInFlight();
      _plainSharedWrite(ref, localJson);
      return;
    }
    // Nothing is on its way any more. Where a snapshot was applied meanwhile, the baseline for this save's keys
    // was the value in flight: put the server's own value back, so the retry sends them again.
    const failedKeys = Object.keys(_inFlight).filter(k => _inFlight[k].no === writeNo);
    dropInFlight();
    if(failedKeys.length && _syncBase !== localJson && _serverSeen && roomId && ref.id === roomId){
      try {
        const server = JSON.parse(_serverSeen), b = JSON.parse(_syncBase);
        for(const k of failedKeys){ b[k] = server[k]; if(_syncedShared) _syncedShared[k] = server[k]; }
        _syncBase = JSON.stringify(b);
        _sharedAtSync = null;
      } catch(err){}
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
  _serverSeen = null;
  _recentSent = [];
  _keyWriteNo = {};
  _inFlight = {};
  _pendingBase = {};
  _echoWriteNo = 0;
  _lastRoomDoc = null;
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
  if(data.state === _lastSyncedState){
    // The exact echo of a save: everything that save (or an earlier one) carried is on the server now.
    if(_echoWriteNo) for(const k of Object.keys(_inFlight)){ if(_inFlight[k].no <= _echoWriteNo) delete _inFlight[k]; }
    return;
  }
  _lastSyncedState = data.state;
  _echoWriteNo = 0;
  _lastRoomDoc = doc;
  for(const k in _inFlight){ if(_inFlight[k].sent && _inFlight[k].pre === data.state) _inFlight[k].sawPre = true; }
  const baseBefore = _syncBase; // what this device had synced before this snapshot (a string: nothing in S can alias it)
  const seenBefore = _serverSeen;
  _syncBase = data.state;
  _serverSeen = data.state;
  _snapshotSeq++;
  _isRemoteUpdate = true; // gates saveState's Firestore write; MUST clear even if the parse or render throws
  try {
    const local = {};
    for(const k of VIEW_LOCAL) local[k] = S[k];
    const remote = sanitizeSharedState(JSON.parse(data.state)); // cleaned before the roster and the pending-edit merge read it
    const pending = _pendingLocalEdits(remote, baseBefore, seenBefore); // before the roster ids and S move on to this snapshot
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
    // Except a key whose earlier value is still in flight: this phone's baseline for it is that value (see _inFlight).
    const flyingBase = Object.keys(_pendingBase);
    if(flyingBase.length){
      const b = JSON.parse(data.state);
      for(const k of flyingBase){
        const v = _pendingBase[k] === undefined ? undefined : JSON.parse(_pendingBase[k]);
        _syncedShared[k] = v;
        b[k] = v === undefined ? undefined : JSON.parse(_pendingBase[k]);
      }
      _syncBase = JSON.stringify(b);
    }
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

