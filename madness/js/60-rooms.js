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
let _writeNoRoom = null; // the room _keyWriteNo and _rosterRemovedNo are about
// Keys a save of this phone is carrying whose echo has not been seen yet: key -> { v: the value sent (JSON),
// no: the save's number, sent: the transaction has run, held: a snapshot without it was applied meanwhile, acked: the server confirmed the save }.
// Until the echo, a snapshot that shows nothing new for such a key (it is simply older than the save) must not
// take the value off the screen, and must not make the server's older value the baseline for the next save:
// an edit made in that window was built on a view without the first one, or was judged "nothing to send".
let _inFlight = {};
// Players a save of this phone is adding (id -> that save's number) until the room shows them or the save ends.
// A snapshot from before that save has no such player: it must not take them off this screen (see _applyRoomSnapshot).
let _rosterInFlight = {};
// Players this phone added and took off again before the room was seen to hold them (id -> how many more times a
// snapshot bringing them is answered with the removal). The room can still get them from the save that added them.
let _rosterGone = {};
// Players a confirmed save added → { no: that save's number, at: commit time of the room it read, pre: that room's state }:
// they stay in _rosterInFlight until a snapshot later than that room arrives (one older than the save has no say).
let _rosterAcked = {};
// Players a save of this phone removed (id -> that save's number): an older save still on its way leaves them out.
let _rosterRemovedNo = {};
// Players a save of this phone is removing (id -> that save's number) until the save is confirmed or has failed:
// a snapshot from before that save still has them and must not put them back on this screen.
let _rosterRemoving = {};
// The roster ids known when the last visit ended ({ visit, ids }): a save of that visit still on its way asks them.
let _knownAtExit = null;
// The ids above that `players` (a roster of this phone) does not list: "removed here", whatever the server says.
function _removedHereIds(players){
  const has = id => (players || []).some(p => p && p.id === id);
  return Object.keys(_rosterInFlight).concat(Object.keys(_rosterGone)).filter(id => !has(id));
}
// Set by _pendingLocalEdits(): kept keys whose baseline is the value in flight, not the snapshot's (key -> JSON).
let _pendingBase = {};
// The save whose exact echo _lastSyncedState is waiting for (0: none), and the last snapshot applied.
let _echoWriteNo = 0;
let _lastRoomDoc = null;
// A snapshot with no commit time (a room last written by the previous version of the app), while a confirmed save's
// added player is waited for: snapshots arrive in server order, so once the room that save read has been seen every
// later one is newer than the save (even one that reads the same: the player added and taken off again). Before
// that only one that has the player is; the third without it ends the wait anyway (updates can be merged on the way).
function _bareEndsWait(a, state, has){ if(has || a.seen) return true; if(state === a.pre){ a.seen = true; return false; } return ++a.bare >= 3; }
// The player ids of the last applied snapshot when its commit time is later than `preAt` (the room a save read), else
// null: such a snapshot is the save itself or newer, so a player the save added and it lacks was removed since.
function _laterRosterIds(preAt, preState){
  if(!_lastRoomDoc || !_lastRoomDoc.exists) return null;
  const d = _lastRoomDoc.data(), at = _docAt(d);
  if(!at || !preAt || _notAfter(at, preAt, d.state === preState)) return null;
  try { return new Set((JSON.parse(d.state).players || []).map(p => p && p.id)); } catch(e){ return null; }
}
// True when the snapshot carries a commit time strictly later than `preAt` (so it is not the room a save read, even if it reads the same).
function _laterThan(doc, preAt){ const at = doc && doc.exists ? _docAt(doc.data()) : null; return !!(at && preAt) && (at.s > preAt.s || (at.s === preAt.s && at.n > preAt.n)); }
// The commit time a room document carries (every write sends updatedAt: serverTimestamp()), or null: a snapshot
// of a write of this phone that the server has not stamped yet, or a document from before the field existed.
function _docAt(data){
  const t = data && data.updatedAt;
  return t && typeof t.seconds === 'number' ? { s: t.seconds, n: t.nanoseconds || 0 } : null;
}
// True when both times are known and `at` is not later than `pre`. Equal times: only when the caller says the
// document is the very one `pre` was read from (`same`); two different documents with one stamp are not ordered.
function _notAfter(at, pre, same){ return !!(at && pre) && (at.s < pre.s || (at.s === pre.s && (at.n < pre.n || (at.n === pre.n && same !== false)))); }
function _pendingLocalEdits(remote, baseRaw, seenRaw, at){
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
  // A snapshot stamped no later than the room a save was built on is older than that save: never its echo, and
  // never the server's word on a key the save carries, even after the server has confirmed the save (snapshots
  // sent before the commit can still arrive after the confirmation).
  const older = f => f.sent && _notAfter(at, f.preAt, _serverSeen === f.pre);
  const isEcho = f => f.sent && (f.acked || f.sawPre) && !older(f);
  for(const k of Object.keys(edits)){
    if(k === 'ds' || k === 'players') continue;
    const theirs = JSON.stringify(remote[k]);
    const f = _inFlight[k];
    if(!isKnown(k, theirs) && !(f && older(f))){ delete edits[k]; delete _inFlight[k]; continue; }
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
    if(JSON.stringify(S[k]) !== f.v || (!older(f) && (f.acked || !isKnown(k, theirs)))){ delete _inFlight[k]; continue; }
    edits[k] = S[k];
    _pendingBase[k] = f.v;
    f.held = true;
  }
  if(!Object.keys(edits).length) return null;
  if('ds' in edits || 'players' in edits){
    const gone = _removedHereIds(S.players);
    const merged = mergeSharedState({ ds: S.ds, players: S.players }, remote, gone.length ? (_lastSnapshotPlayerIds || []).concat(gone) : _lastSnapshotPlayerIds);
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
function _plainSharedWrite(ref, json, left){ // left: the visit this save was made in is over (see here() in _writeSharedState)
  const id = ref.id;
  _queuedPlainWrites[id] = (_queuedPlainWrites[id] || 0) + 1;
  const settled = () => { if(--_queuedPlainWrites[id] <= 0) delete _queuedPlainWrites[id]; };
  if(!left && roomId && ref.id === roomId){
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
  if(_recentSent.length > 12) _recentSent.shift();
  const seqAtStart = _snapshotSeq;
  // A later save from this phone that also carries a key makes this one's copy of that key the older one.
  const writeNo = ++_writeSeq;
  // (Not ds and players: those are merged with the server's copy below, never sent as a whole.)
  if(mine) for(const k of mine){ if(k !== 'ds' && k !== 'players') _keyWriteNo[k] = writeNo; }
  // (One no longer on this screen was removed here in the meantime: remembered, a later snapshot can still bring them.)
  const dropRoster = () => { for(const id of Object.keys(_rosterInFlight)){ if(_rosterInFlight[id] !== writeNo) continue; delete _rosterInFlight[id]; if(here() && !(S.players || []).some(p => p && p.id === id)) _rosterGone[id] = 3; } };
  const dropInFlight = () => { dropRoster(); for(const id of Object.keys(_rosterRemoving)){ if(_rosterRemoving[id] === writeNo) delete _rosterRemoving[id]; } for(const k of Object.keys(_inFlight)){ if(_inFlight[k].no === writeNo) delete _inFlight[k]; } };
  let preAtSaved = null;
  let preState = null; // what the server held when the transaction (its last run) read the room
  let expectSynced = _lastSyncedState; // what _lastSyncedState holds unless a snapshot is applied during the write
  let snapshotDuringWrite = false;
  const ref = db.collection("rooms").doc(roomId);
  // Still the visit of the room this save was started in. After Home and back into the same room the save still
  // lands, but the bookkeeping and the screen belong to the new visit: it must not read or change them.
  const visit = _roomGeneration, here = () => !!roomId && ref.id === roomId && visit === _roomGeneration;
  // A transaction needs the network and only gives up after several retries. Known offline: queue the plain
  // write at once, so the edit is already in Firestore's offline queue if the tab is closed a second later.
  // Same while an earlier plain write for this room is still waiting in that queue (the connection has only just
  // come back): Firestore sends its queue in order, but a transaction does not wait for it. The transaction would
  // commit first and the older queued copy of the room would then land on top of it, undoing this edit.
  if((typeof navigator !== 'undefined' && navigator.onLine === false) || _queuedPlainWrites[roomId]){ _plainSharedWrite(ref, localJson); return; }
  if(mine) for(const k of mine){ if(k !== 'ds' && k !== 'players') _inFlight[k] = { v: JSON.stringify(shared[k]), no: writeNo, sent: false, held: false, acked: false }; }
  const adding = []; // the players this save is adding
  if(mine && mine.includes('players')){
    for(const p of ((base && base.players) || [])){ if(p && p.id && !(shared.players || []).some(q => q && q.id === p.id)) { _rosterRemovedNo[p.id] = writeNo; _rosterRemoving[p.id] = writeNo; } }
    const had = new Set(((base && base.players) || []).map(p => p.id));
    for(const p of (shared.players || [])){ if(p && p.id && !had.has(p.id)){ _rosterInFlight[p.id] = writeNo; adding.push(p.id); } }
  }
  // Transaction + mergeSharedState: never roll back a pick that landed since our last snapshot.
  let writtenIds = null;
  // The roster our copy was taken from. Read now, not inside the transaction: a snapshot that arrives while the
  // write is being retried would otherwise make a player somebody else has just added look like one we removed.
  // Plus the players an earlier save of this phone is still adding and this copy no longer has: they were removed
  // here before that save was confirmed. The server may hold them by the time this save reads the room, and they
  // are not "added on another phone".
  const goneInFlight = _removedHereIds(shared.players);
  const knownIds = goneInFlight.length ? (_lastSnapshotPlayerIds || []).concat(goneInFlight) : _lastSnapshotPlayerIds;
  db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    // Cleaned like every copy this device shows: the merge below reads its roster and draft state.
    const remote = snap.exists && snap.data().state ? sanitizeSharedState(JSON.parse(snap.data().state)) : null;
    preState = snap.exists ? snap.data().state : null;
    const preAt = snap.exists ? _docAt(snap.data()) : null;
    preAtSaved = preAt;
    for(const k in _inFlight){ if(_inFlight[k].no === writeNo){ _inFlight[k].sent = true; _inFlight[k].pre = preState; _inFlight[k].preAt = preAt; _inFlight[k].sawPre = _serverSeen === preState; } }
    let ours = shared;
    if(remote && mine){
      // Same key order as our own copy, so an untouched server gives back exactly localJson.
      ours = {};
      // Firestore re-runs this function when the document changed under it, which can be after a newer save from
      // this phone has landed: a key that newer save carries is left as the server holds it, not put back.
      for(const k in shared) ours[k] = ((mine.includes(k) && !(_keyWriteNo[k] > writeNo)) || !(k in remote)) ? shared[k] : remote[k];
      for(const k in remote){ if(!(k in ours) && !VIEW_LOCAL.includes(k)) ours[k] = remote[k]; }
    }
    // A player this save was adding who has been taken off this phone again since: a later save carries (or has
    // already made) that removal, and this one may be landing after it. Not written.
    // (Also one an earlier save of this phone was adding: this save was started while they were still listed.)
    {
      const off = (here() ? adding.filter(id => !(S.players || []).some(p => p && p.id === id)).concat(_removedHereIds(S.players)) : [])
        .concat(Object.keys(_rosterRemovedNo).filter(id => _rosterRemovedNo[id] > writeNo)); // removed by a newer save of this phone
      if(off.length) ours = Object.assign({}, ours, { players: (ours.players || []).filter(p => !(p && off.includes(p.id))) });
    }
    // A player this save lists whom the server does not have and this phone no longer shows (removed elsewhere and
    // taken off this screen by a snapshot while the save was waiting): not written back.
    if(remote && here()){
      const shownNow = new Set((S.players || []).map(p => p && p.id)), there = new Set((remote.players || []).map(p => p && p.id));
      if((ours.players || []).some(p => p && !shownNow.has(p.id) && !there.has(p.id))) ours = Object.assign({}, ours, { players: ours.players.filter(p => !p || shownNow.has(p.id) || there.has(p.id)) });
    }
    // Players this save lists who have become known since it started (an earlier save of this phone was confirmed):
    // if the server no longer has them they were removed on another phone, not added by this save.
    let known = knownIds;
    // (After Home, or Home and back: the ids as they were when this save's visit ended.)
    const knownNow = visit === _roomGeneration ? _lastSnapshotPlayerIds : (_knownAtExit && _knownAtExit.visit === visit ? _knownAtExit.ids : null);
    if(knownNow){
      const late = knownNow.filter(id => !(known || []).includes(id) && (shared.players || []).some(p => p && p.id === id));
      if(late.length) known = (known || []).concat(late);
    }
    const merged = remote ? mergeSharedState(ours, remote, known, true) : ours;
    const json = JSON.stringify(merged);
    writtenIds = (merged.players || []).map(p => p.id);
    for(const id of Object.keys(_rosterInFlight)){ if(_rosterInFlight[id] === writeNo && !writtenIds.includes(id)){ delete _rosterInFlight[id]; if(here() && !(S.players || []).some(p => p && p.id === id)) _rosterGone[id] = 3; } }
    // The echo of this write is skipped by _applyRoomSnapshot only when it carries exactly what we
    // sent from. If the merge took anything from the server (draft progress, another device's edit), or
    // a snapshot replaced S while the write was in flight, leave the echo to be applied so this device
    // ends up showing what the server holds.
    if(visit === _roomGeneration){ // (not here(): at Home, between visits, this is as it always was)
    if(_lastSyncedState !== expectSynced || _snapshotSeq !== seqAtStart) snapshotDuringWrite = true; // the count: two snapshots can end on the string we started from
    _lastSyncedState = expectSynced = (json === localJson && !snapshotDuringWrite) ? json : null;
    if(_lastSyncedState !== null) _echoWriteNo = writeNo;
    }
    tx.set(ref, {
      state: json,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge: true});
  }).then(() => {
    // The server now holds the roster we just wrote, and our own echo is skipped by _applyRoomSnapshot, so
    // record it here. Otherwise a player added on this device and then removed on this device would look
    // like "added elsewhere" to the next merge and come straight back.
    if(writtenIds && here()){
      // Unless a snapshot was applied while this save was on its way: it put the server's roster on screen, without
      // the players this save was adding. Calling those "known" made the next roster edit from this phone read
      // "known, but not here" as "removed here" and delete them on the server. Only the ones still shown count.
      const shown = _snapshotSeq === seqAtStart ? null : new Set((S.players || []).map(p => p.id));
      // And only the ones this phone sent: a player the merge took from the server (added on another phone while this
      // save was on its way) is not on this screen yet. Known-but-not-here reads as "removed here" in the next merge.
      const sentIds = new Set((shared.players || []).map(p => p.id));
      _lastSnapshotPlayerIds = Array.from(new Set((_lastSnapshotPlayerIds || []).concat(writtenIds.filter(id => sentIds.has(id) && (!shown || shown.has(id))))));
    }
    for(const id of Object.keys(_rosterRemoving)){ if(_rosterRemoving[id] === writeNo) delete _rosterRemoving[id]; }
    // Unless an update later than the room this save read has already been applied and does not have the player:
    // another phone took them off after this save. Nothing newer is promised, so there is nothing to wait for;
    // that update is shown again below, now that the player is no longer on their way.
    let rosterReapply = false;
    if(preAtSaved && here()){
      let lastIds = null; // the players of the last applied update, when it is later than the room this save read
      for(const id of Object.keys(_rosterInFlight)){
        if(_rosterInFlight[id] !== writeNo || !(S.players || []).some(p => p && p.id === id)) continue;
        if(lastIds === null) lastIds = _laterRosterIds(preAtSaved, preState) || false;
        if(lastIds && !lastIds.has(id)) rosterReapply = true;
        else _rosterAcked[id] = { no: writeNo, at: preAtSaved, pre: preState, seen: _serverSeen === preState, bare: 0 };
      }
    }
    for(const id of Object.keys(_rosterInFlight)){ if(_rosterInFlight[id] === writeNo && !(_rosterAcked[id] && _rosterAcked[id].no === writeNo)){ delete _rosterInFlight[id]; if(here() && !(S.players || []).some(p => p && p.id === id)) _rosterGone[id] = 3; } } // confirmed: its echo brings these players, and a snapshot after it may already have them removed again
    _writeRetries = 0;
    // The server has the save. A key of it that a snapshot was held back for: if that snapshot is not the state
    // the transaction read (so it may already be newer than this save, with another phone's change on top), show
    // what it said after all. Otherwise the echo is still to come; from here on any snapshot is taken at its word.
    let reapply = rosterReapply;
    for(const k of Object.keys(_inFlight)){
      const f = _inFlight[k];
      if(f.no !== writeNo) continue;
      f.acked = true;
      // Not a key edited again since (that edit is waiting in the debounce): the older snapshot's value would become
      // its baseline, and where the two are equal the newer edit was judged "nothing to send". It stays in flight,
      // confirmed, so the baseline stays the value this save sent until its echo or the newer save.
      // Nor when that snapshot is stamped no later than the room this save was built on: it is older than the save,
      // and the save's own snapshot (or a later one) is still to come.
      if(f.held && (_serverSeen !== preState || _laterThan(_lastRoomDoc, f.preAt)) && JSON.stringify(S[k]) === f.v && !_notAfter(_lastRoomDoc && _lastRoomDoc.exists ? _docAt(_lastRoomDoc.data()) : null, f.preAt, !!(_lastRoomDoc && _lastRoomDoc.exists) && _lastRoomDoc.data().state === f.pre)){ delete _inFlight[k]; reapply = true; }
    }
    if(reapply && here() && _lastRoomDoc && !_pickInFlight){
      _lastSyncedState = null;
      _applyRoomSnapshot(_lastRoomDoc);
    }
  }).catch(e => {
    // Transactions need the network. Offline, fall back to the plain merge write, which Firestore
    // queues and flushes on reconnect (the pre-transaction behaviour).
    if(e && (e.code === 'unavailable' || e.code === 'failed-precondition' || (typeof navigator !== 'undefined' && navigator.onLine === false))){
      dropInFlight();
      _plainSharedWrite(ref, localJson, !here());
      return;
    }
    // Nothing is on its way any more. Where a snapshot was applied meanwhile, the baseline for this save's keys
    // was the value in flight: put the server's own value back, so the retry sends them again.
    const failedKeys = Object.keys(_inFlight).filter(k => _inFlight[k].no === writeNo);
    const failedRoster = Object.keys(_rosterInFlight).filter(id => _rosterInFlight[id] === writeNo);
    const failedRemoving = Object.keys(_rosterRemoving).filter(id => _rosterRemoving[id] === writeNo);
    dropInFlight();
    if(failedKeys.length && _syncBase !== localJson && _serverSeen && here()){
      try {
        const server = JSON.parse(_serverSeen), b = JSON.parse(_syncBase);
        for(const k of failedKeys){ b[k] = server[k]; if(_syncedShared) _syncedShared[k] = server[k]; }
        _syncBase = JSON.stringify(b);
        _sharedAtSync = null;
      } catch(err){}
    }
    if((failedRoster.length || failedRemoving.length) && _syncBase !== localJson && _serverSeen && here()){
      try {
        const server = JSON.parse(_serverSeen), there = new Set((server.players || []).map(p => p && p.id));
        if(failedRoster.some(id => !there.has(id) && (S.players || []).some(p => p.id === id)) || failedRemoving.some(id => there.has(id) && !(S.players || []).some(p => p.id === id))){
          const b = JSON.parse(_syncBase);
          b.players = server.players || [];
          if(_syncedShared) _syncedShared.players = JSON.parse(JSON.stringify(b.players));
          _syncBase = JSON.stringify(b);
          _sharedAtSync = null;
        }
      } catch(err){}
    }
    // Nothing was written: go back to the earlier base, so the next write still carries these edits. The
    // pending-edit baseline goes back too (unless a snapshot moved it on during the write): until the save is
    // retried, a snapshot from another phone must keep these edits the way it keeps an edit in the debounce.
    if(here() && _syncBase === localJson){
      _syncBase = baseAtStart;
      try { _syncedShared = baseAtStart ? JSON.parse(baseAtStart) : null; } catch(err){}
    }
    if(here() && _sharedAtSync === localJson) _sharedAtSync = null;
    console.warn("Firestore write error:", e);
    // Try again shortly rather than waiting for the next save: the toast used to promise "saved locally", but
    // the next snapshot replaced S and the local copy and nothing was armed to send the edit again. A few tries,
    // then give up: a write the server refuses for good would otherwise loop every 800 ms while the tab is open.
    if(here() && ++_writeRetries <= 5){
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
  if(_firestoreWriteTimer !== null){
    clearTimeout(_firestoreWriteTimer);
    _firestoreWriteTimer = null;
    if(roomId && !_isRemoteUpdate) _writeSharedState();
  }
  // Leaving: a player added and taken off again in this visit stays off. The save that was adding them can still be
  // on its way while the phone is at Home, where it has no screen to ask.
  if(roomId) for(const id of _removedHereIds(S.players)) _rosterRemovedNo[id] = _writeSeq + 1;
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
    // A day picked on the Live tab is a look back, not a setting. It is stored with the rest of the view state,
    // and restoring it opened the Live tab on that old day in every later session (and this phone then never
    // processed today's finals). A new session starts on today; the filter and the tab are still remembered.
    S.liveScoresDate = '';
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
  // A new room starts blank. loadState() brought back whatever this phone had cached under the same code (last
  // year's pool of that name, since removed from the server) and created the "new" room with its players, picks
  // and finished draft.
  S = defaultState();
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
  _knownAtExit = _lastSnapshotPlayerIds ? { visit: _roomGeneration, ids: _lastSnapshotPlayerIds } : null;
  _lastSnapshotPlayerIds = null; // the previous room's roster says nothing about this one
  _syncedShared = null;
  _serverSeen = null;
  // (_recentSent too: the update that brings a save from the last visit is this phone's own value, not another phone's change.)
  if(code !== _writeNoRoom){ _recentSent = []; _keyWriteNo = {}; _rosterRemovedNo = {}; _writeNoRoom = code; } // kept for the same room: a save from the last visit may still be on its way
  else { for(const id of _removedHereIds(S.players)) _rosterRemovedNo[id] = _writeSeq + 1; } // added and taken off again in the last visit (S is this phone's cached copy of that screen): the save that was adding them leaves them out
  _inFlight = {};
  _pendingBase = {};
  _rosterInFlight = {};
  _rosterGone = {};
  _rosterAcked = {};
  _rosterRemoving = {};
  _echoWriteNo = 0;
  _lastRoomDoc = null;
  saveRecentRoom(code);
  const gen = ++_roomGeneration;
  _awaitingRoom = true;
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
  _awaitingRoom = false;
  const data = doc.data();
  if(!data || !data.state) return;
  // Firestore delivers our own write back twice (latency-compensated, then server-acked with the
  // real updatedAt). Both carry the exact string we wrote, so neither needs a parse or a redraw.
  if(data.state === _lastSyncedState){
    // The exact echo of a save: everything that save (or an earlier one) carried is on the server now.
    // (Unless it is stamped no later than the room that save was built on: the same string, but an older state.)
    const echoAt = _docAt(data);
    // The same text as the last update applied, with a later commit time: a newer room that happens to read the same
    // (a value changed and changed back). Nothing to draw, but it is the last word: a save confirmed after it asks.
    const newer = !!(_lastRoomDoc && _lastRoomDoc.exists && _lastRoomDoc.data().state === data.state && _laterThan(doc, _docAt(_lastRoomDoc.data())));
    if(newer) _lastRoomDoc = doc;
    if(_echoWriteNo) for(const k of Object.keys(_inFlight)){ const f = _inFlight[k]; if(f.no <= _echoWriteNo && !(f.sent && _notAfter(echoAt, f.preAt, data.state === f.pre))) delete _inFlight[k]; }
    // Its new players are in the room from here on: "known", so removing one before the save is confirmed is a removal.
    if(_echoWriteNo) for(const id of Object.keys(_rosterRemoving)){ if(_rosterRemoving[id] <= _echoWriteNo) delete _rosterRemoving[id]; }
    if(_echoWriteNo) for(const id of Object.keys(_rosterInFlight)){
      if(_rosterInFlight[id] > _echoWriteNo) continue;
      delete _rosterInFlight[id];
      if(!(S.players || []).some(p => p && p.id === id)) _rosterGone[id] = 3; // taken off again here: see _rosterGone
      if(!(_lastSnapshotPlayerIds || []).includes(id)) _lastSnapshotPlayerIds = (_lastSnapshotPlayerIds || []).concat([id]);
    }
    // Unless it is such a newer room and a player a confirmed save added is still waited for: the room no longer
    // has them (another phone took exactly that player off), and only applying it ends the wait. The same for a
    // setting of a confirmed save that an older update was held back for: this is the newer update it waits for.
    if(!(newer && !_echoWriteNo && (Object.keys(_rosterAcked).length || Object.keys(_inFlight).some(k => _inFlight[k].acked)))) return;
  }
  _lastSyncedState = data.state;
  _echoWriteNo = 0;
  _lastRoomDoc = doc;
  const baseBefore = _syncBase; // what this device had synced before this snapshot (a string: nothing in S can alias it)
  const seenBefore = _serverSeen;
  _syncBase = data.state;
  _serverSeen = data.state;
  _snapshotSeq++;
  let goneBack = [];
  _isRemoteUpdate = true; // gates saveState's Firestore write; MUST clear even if the parse or render throws
  try {
    const local = {};
    for(const k of VIEW_LOCAL) local[k] = S[k];
    const remote = sanitizeSharedState(JSON.parse(data.state)); // cleaned before the roster and the pending-edit merge read it
    const pending = _pendingLocalEdits(remote, baseBefore, seenBefore, _docAt(data)); // before the roster ids and S move on to this snapshot
    // From the next snapshot on, the same value is the save's echo. Not for this one: it is the room the save was
    // built on, and it can already hold that value while an older save of this phone is about to change it.
    for(const k in _inFlight){ if(_inFlight[k].sent && _inFlight[k].pre === data.state) _inFlight[k].sawPre = true; }
    const knownBefore = _lastSnapshotPlayerIds;
    _lastSnapshotPlayerIds = (remote.players || []).map(p => p.id);
    const shownBefore = S.players || [];
    // A removal still waiting to be saved (in the baseline, off this screen) and this snapshot has no such player
    // either: it may simply be older than the player. Remembered, in case a newer snapshot brings them (see _rosterGone).
    if(_firestoreWriteTimer && _syncedShared) for(const p of (_syncedShared.players || [])){
      if(p && p.id && !shownBefore.some(q => q && q.id === p.id) && !(remote.players || []).some(q => q && q.id === p.id)) _rosterGone[p.id] = 3;
    }
    Object.assign(S, remote, local, pending || {});
    // Players a save of this phone is still adding: this snapshot is older than that save, not a removal. Kept on
    // screen (as this phone last showed them); one the room now has, or one removed here since, is no longer waited for.
    // A player a confirmed save added is waited for until a snapshot later than the room that save read.
    { const at = _docAt(data); for(const id of Object.keys(_rosterAcked)){ const a = _rosterAcked[id]; if(_rosterInFlight[id] !== a.no){ delete _rosterAcked[id]; continue; } if(at ? !_notAfter(at, a.at, data.state === a.pre) : _bareEndsWait(a, data.state, (remote.players || []).some(p => p && p.id === id))){ delete _rosterAcked[id]; delete _rosterInFlight[id]; } else if(data.state === a.pre) a.seen = true; } }
    let rosterKept = false;
    for(const id of Object.keys(_rosterInFlight)){
      const mine = shownBefore.find(p => p && p.id === id);
      if(!mine){ delete _rosterInFlight[id]; _rosterGone[id] = 3; continue; }
      if((remote.players || []).some(p => p.id === id)){ delete _rosterInFlight[id]; continue; }
      if(!(S.players || []).some(p => p.id === id)){ S.players = (S.players || []).concat([mine]); rosterKept = true; }
    }
    // A player a save of this phone is removing: this snapshot is older than that save. Kept off the screen.
    const stillRemoving = Object.keys(_rosterRemoving).filter(id => !shownBefore.some(p => p && p.id === id) && (S.players || []).some(p => p && p.id === id));
    if(stillRemoving.length){ S.players = S.players.filter(p => !(p && stillRemoving.includes(p.id))); rosterKept = true; }
    // A player removed here before the room showed them, and this snapshot brings them (from the save that added
    // them): the removal stands on this screen and is saved again below. Answered a few times at most.
    for(const id of Object.keys(_rosterGone)){ if(shownBefore.some(p => p && p.id === id)) delete _rosterGone[id]; } // listed here again on purpose
    goneBack = Object.keys(_rosterGone).filter(id => (S.players || []).some(p => p && p.id === id));
    if(goneBack.length){
      S.players = S.players.filter(p => !(p && goneBack.includes(p.id)));
      for(const id of goneBack){ if(--_rosterGone[id] <= 0) delete _rosterGone[id]; }
    }
    if(knownBefore){
      const there = new Set(_lastSnapshotPlayerIds);
      for(const p of (S.players || [])){ if(p && !there.has(p.id) && knownBefore.includes(p.id)) _lastSnapshotPlayerIds.push(p.id); }
      // Taken off this screen with the roster edit still to be saved: this snapshot may simply be older than them.
      if(pending && 'players' in pending) for(const id of knownBefore){ if(!there.has(id) && !_lastSnapshotPlayerIds.includes(id) && !shownBefore.some(p => p && p.id === id)) _lastSnapshotPlayerIds.push(id); }
    }
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
    if(rosterKept){
      const b = JSON.parse(_syncBase);
      // With a roster edit of this phone still waiting to be saved, the screen holds players the room has never
      // been sent: the baseline must not take them, or the save would find nothing of its own in the roster.
      if(pending && 'players' in pending) b.players = (b.players || []).filter(p => !(p && stillRemoving.includes(p.id)));
      else b.players = JSON.parse(JSON.stringify(S.players));
      _syncBase = JSON.stringify(b);
    }
    // Players a save in flight is adding, still shown here, that this (older) snapshot does not have: they stay in
    // the baseline too. Where another roster change was pending they were kept on screen by that merge, and the
    // baseline became the snapshot's roster: taking them off again was then "nothing to send".
    const flyingKept = Object.keys(_rosterInFlight).filter(id => (S.players || []).some(p => p && p.id === id) && !(remote.players || []).some(p => p && p.id === id));
    if(flyingKept.length){
      const b = JSON.parse(_syncBase);
      const missing = S.players.filter(p => p && flyingKept.includes(p.id) && !(b.players || []).some(q => q && q.id === p.id));
      if(missing.length){
        b.players = (b.players || []).concat(JSON.parse(JSON.stringify(missing)));
        _syncBase = JSON.stringify(b);
        if(!(_syncedShared.players || []).some(q => q && missing.some(m => m.id === q.id))) _syncedShared.players = (_syncedShared.players || []).concat(JSON.parse(JSON.stringify(missing)));
      }
    }
    if(goneBack.length){
      // The baseline keeps them, so the roster counts as edited and the save takes them out of the room.
      const b = JSON.parse(_syncBase);
      const back = (remote.players || []).filter(p => p && goneBack.includes(p.id) && !(b.players || []).some(q => q && q.id === p.id));
      if(back.length){ b.players = (b.players || []).concat(back); _syncBase = JSON.stringify(b); }
      if(!(pending && 'players' in pending)) _syncedShared.players = JSON.parse(JSON.stringify(b.players || []));
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
  if(goneBack.length) _debouncedFirestoreWrite();
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

