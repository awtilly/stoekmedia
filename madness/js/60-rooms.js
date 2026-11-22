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
// The ones of them the server refused: they put nothing in the room, so they are the first to leave the list.
const _refusedSent = new WeakSet();
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
// The roster ids known when each of the last few visits ended (visit number -> ids): a save of that visit still on
// its way asks them. (Not only the last visit's: Home and back twice, and a save from the first visit lands last.)
let _knownAtExit = {};
// Saves still on their way, counted per visit they were started in: that visit's _knownAtExit entry is kept for them.
let _visitSaves = {};
// The saves whose last run is not over yet, by write number.
let _savesRunning = {};
// What each running save lists, and whether it has built the roster it writes: a save that gives up while adding
// a player hands that player to a running save that lists them and has still to build its roster.
let _saveSends = {};
let _saveBuilt = {};
/** The earliest other running save of this phone that lists the player and has not built its roster yet. */
function _addHeir(id, writeNo){
  const nos = Object.keys(_savesRunning).map(Number).filter(n => n !== writeNo && (_saveSends[n] || []).includes(id)).sort((a, b) => a - b);
  // (Or, failing that, one that has built its roster with the player in it: it is about to land them. Or any
  // other: a run that is sent round again builds its roster anew; if it never writes them, they are sent again.)
  return nos.filter(n => !_saveBuilt[n])[0] || nos.filter(n => Array.isArray(_saveBuilt[n]) && _saveBuilt[n].includes(id))[0] || nos[0];
}
let _handedOver = {}; // player id -> the save their add was handed to
/** A handed-over player the heir did not write, still on this screen: out of the baseline, and a save is armed. */
function _resendHandedOver(id){
  const next = _addHeir(id, _handedOver[id]);
  if(next){ _rosterInFlight[id] = next; _handedOver[id] = next; return; } // another running save still lists them
  delete _handedOver[id];
  try {
    const b = JSON.parse(_syncBase);
    b.players = (b.players || []).filter(p => !(p && p.id === id));
    _syncBase = JSON.stringify(b);
    if(_syncedShared && _syncedShared.players) _syncedShared.players = _syncedShared.players.filter(p => !(p && p.id === id));
    _sharedAtSync = null;
    _debouncedFirestoreWrite();
  } catch(err){}
}
// Every roster id an update or a confirmed save of this visit has shown to be in the room, also one removed since.
let _knownEver = [];
/** For a save of an earlier visit: plus the players this phone has been shown in the same room since it came back. */
function _knownSince(atExit, code){
  if(!roomId || code !== roomId || !_lastSnapshotPlayerIds) return atExit;
  return (atExit || []).concat(_knownEver, _lastSnapshotPlayerIds);
}
// The ids above that `players` (a roster of this phone) does not list: "removed here", whatever the server says.
function _removedHereIds(players){
  const has = id => (players || []).some(p => p && p.id === id);
  return Object.keys(_rosterInFlight).concat(Object.keys(_rosterGone)).filter(id => !has(id));
}
// Set by _pendingLocalEdits(): kept keys whose baseline is the value in flight, not the snapshot's (key -> JSON).
let _pendingBase = {};
// The save whose exact echo _lastSyncedState is waiting for (0: none), and the last snapshot applied.
let _echoWriteNo = 0;
// What each running save last wrote and the commit time of the room it read (write number -> { json, at }), and the
// saves whose own write this phone has since been shown by a room update (write number -> that text): such a save has
// landed, whatever its transaction is told afterwards.
let _saveWrote = {};
let _landedSeen = {};
// Players a refused save was adding (id -> true): the save may have landed all the same.
let _refusedAdds = {};
// Players this phone is adding whom a run of one of its saves has found in the room: the add has landed, whatever
// the phone is told about that save afterwards. (Ids are made on this phone, so nobody else can have added them.)
let _addLanded = {};
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
  const flying = Object.keys(_inFlight);
  if(!_syncedShared && !flying.length) return null;
  if(!_firestoreWriteTimer && !flying.length) return null;
  const edits = {};
  if(_firestoreWriteTimer && _syncedShared) for(const k in S){
    if(VIEW_LOCAL.includes(k)) continue;
    if(JSON.stringify(S[k]) !== JSON.stringify(_syncedShared[k]) || _resendKeys[k] > 0) edits[k] = S[k]; // (or left unsent by a refused save)
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
    if(JSON.stringify(S[k]) !== f.v || (!older(f) && (f.acked || !(isKnown(k, theirs) || (f.carried && !seenRaw))))){ delete _inFlight[k]; continue; }
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
// Settings of a save that was refused: key -> that save's number. The next save carries them whatever the baseline
// says (earlier saves of this phone leave those keys to the refused one, so nothing else would deliver them).
let _resendKeys = {};
function _plainSharedWrite(ref, json){
  const id = ref.id;
  _queuedPlainWrites[id] = (_queuedPlainWrites[id] || 0) + 1;
  const settled = () => { if(--_queuedPlainWrites[id] <= 0) delete _queuedPlainWrites[id]; };
  // (Also for a save of an earlier visit when the phone is back in this room: that visit's copy is older than
  // the room this screen was drawn from, and sent whole it took out what every phone had added since.)
  if(roomId && ref.id === roomId){
    const cur = {};
    for(const k in S){ if(!VIEW_LOCAL.includes(k)) cur[k] = S[k]; }
    json = JSON.stringify(cur);
    _lastSyncedState = json;
    _syncBase = json;
    _sharedAtSync = json;
  }
  const visit = _roomGeneration;
  ref.set({ state: json, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge: true})
    .then(() => {
      settled();
      // The server has this phone's whole copy now: its players are in the room, as after a confirmed save. Without
      // this, one added by this write and taken off again here looked like a player another phone had added, the
      // removal was not sent, and the player stayed in the room for everybody but this phone.
      if(roomId !== id || visit !== _roomGeneration || !_lastSnapshotPlayerIds) return;
      try { _lastSnapshotPlayerIds = Array.from(new Set(_lastSnapshotPlayerIds.concat((JSON.parse(json).players || []).map(p => p && p.id).filter(Boolean)))); } catch(e){}
    }, err => { settled(); console.warn("Firestore offline write error:", err); });
}

/* Write the shared (non-view) part of S to the current room's document now. */
function _writeSharedState(){
  const localJson = _sharedJson();
  // (A setting a refused save left unsent still goes out when the screen reads like the room again: a room update
  // can show the value on this screen while an earlier save of this phone, built with the value before it, is
  // still on its way and would land last.)
  if(localJson === _sharedAtSync && !Object.keys(_resendKeys).length) return; // nothing shared changed since the last sync
  _sharedAtSync = localJson;
  // A private copy: S can move on (a snapshot, another edit) while the transaction below is retried.
  const shared = JSON.parse(localJson);
  // The server state this device last synced with. Only the keys edited since then are ours to send; every
  // other key goes out as the server holds it at commit time, so a change another device made in the meantime
  // (even one that lands while this write is in flight) is not overwritten with our older copy of it.
  const baseAtStart = _syncBase;
  let base = null;
  try { base = baseAtStart ? JSON.parse(baseAtStart) : null; } catch(e){}
  const resend = _resendKeys;
  _resendKeys = {};
  const mine = base && Object.keys(shared).filter(k => JSON.stringify(shared[k]) !== JSON.stringify(base[k]) || (resend[k] > 0 && resend[k] <= _writeSeq));
  _syncBase = localJson; // these edits are now with this write; the next write sends only what changes after this
  _syncedShared = JSON.parse(localJson); // nothing is pending any more: this is what the server is being sent
  _recentSent.push(shared);
  // (Retries of a refused save would otherwise push out the save that did land: its value in a later room update
  // then read as another phone's change and replaced the edit still waiting to be sent.)
  if(_recentSent.length > 12){ const i = _recentSent.findIndex(x => _refusedSent.has(x)); _recentSent.splice(i < 0 ? 0 : i, 1); }
  const seqAtStart = _snapshotSeq;
  // A later save from this phone that also carries a key makes this one's copy of that key the older one.
  const writeNo = ++_writeSeq;
  // (Not ds and players: those are merged with the server's copy below, never sent as a whole.)
  if(mine) for(const k of mine){ if(k !== 'ds' && k !== 'players') _keyWriteNo[k] = writeNo; }
  // (One no longer on this screen was removed here in the meantime: remembered, a later snapshot can still bring them.)
  const dropRoster = handOver => { for(const id of Object.keys(_rosterInFlight)){ if(_rosterInFlight[id] !== writeNo) continue; const heir = handOver && _addHeir(id, writeNo); if(heir){ _rosterInFlight[id] = heir; _handedOver[id] = heir; continue; } delete _rosterInFlight[id]; if(here() && !(S.players || []).some(p => p && p.id === id)) _rosterGone[id] = 3; } };
  const dropInFlight = handOver => { dropRoster(handOver); for(const id of Object.keys(_rosterRemoving)){ if(_rosterRemoving[id] === writeNo) delete _rosterRemoving[id]; } for(const k of Object.keys(_inFlight)){ if(_inFlight[k].no === writeNo) delete _inFlight[k]; } };
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
  _saveSends[writeNo] = (shared.players || []).map(p => p && p.id);
  const adding = []; // the players this save is adding
  if(mine && mine.includes('players')){
    for(const p of ((base && base.players) || [])){ if(p && p.id && !(shared.players || []).some(q => q && q.id === p.id)) { _rosterRemovedNo[p.id] = writeNo; _rosterRemoving[p.id] = writeNo; } }
    const had = new Set(((base && base.players) || []).map(p => p.id));
    for(const p of (shared.players || [])){ if(p && p.id && !had.has(p.id)){ _rosterInFlight[p.id] = writeNo; adding.push(p.id); } }
  }
  // Players this save lists whom an earlier save of this phone was still adding when it started: id -> that save.
  const earlier = {};
  for(const p of (shared.players || [])){ const no = p && _rosterInFlight[p.id]; if(no && no !== writeNo) earlier[p.id] = no; }
  // Transaction + mergeSharedState: never roll back a pick that landed since our last snapshot.
  let writtenIds = null;
  // The roster our copy was taken from. Read now, not inside the transaction: a snapshot that arrives while the
  // write is being retried would otherwise make a player somebody else has just added look like one we removed.
  // Plus the players an earlier save of this phone is still adding and this copy no longer has: they were removed
  // here before that save was confirmed. The server may hold them by the time this save reads the room, and they
  // are not "added on another phone".
  const goneInFlight = _removedHereIds(shared.players);
  const knownIds = goneInFlight.length ? (_lastSnapshotPlayerIds || []).concat(goneInFlight) : _lastSnapshotPlayerIds;
  let awayTries = 0; // see the catch: runs of this save after its visit ended
  let again = false; // set by the catch when the save is to be run once more
  const attempt = () => db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    // Cleaned like every copy this device shows: the merge below reads its roster and draft state.
    const remote = snap.exists && snap.data().state ? sanitizeSharedState(JSON.parse(snap.data().state)) : null;
    preState = snap.exists ? snap.data().state : null;
    if(remote) for(const p of (remote.players || [])){ if(p && (_rosterInFlight[p.id] || adding.includes(p.id) || earlier[p.id])) _addLanded[p.id] = true; } // (adding / earlier: after Home and back the new visit no longer has them as on their way)
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
      // A player handed to this save by one that gave up, where the roster is not among the keys this save sends:
      // written with the room's roster, as a save that sends its roster would. (It used to be left to the screen to
      // send them again once this save was confirmed; after Home there is no screen, and the player was lost.)
      if(!mine.includes('players')){
        const handed = (shared.players || []).filter(p => p && _handedOver[p.id] === writeNo && !(remote.players || []).some(q => q && q.id === p.id));
        if(handed.length) ours.players = (remote.players || []).concat(handed);
      }
      // The rosters (who picked which team) change only together with the draft state: a pick, an undo, a reset.
      // A save that does not carry the draft state takes them as the room holds them. (Its copy of the draft state
      // is the room's by now, so the merge below cannot tell that its copy of the rosters is the older one: a
      // seat claimed with a PIN, a late joiner or a player moved in the list while a pick was landing took that
      // pick's team off the roster again.)
      if(!mine.includes('ds') && Array.isArray(ours.players)){
        const picks = {};
        for(const p of (remote.players || [])){ if(p && p.id) picks[p.id] = p.teamIds || []; }
        ours.players = ours.players.map(p => (p && picks[p.id]) ? Object.assign({}, p, { teamIds: picks[p.id] }) : p);
      }
    }
    // A player this save was adding who has been taken off this phone again since: a later save carries (or has
    // already made) that removal, and this one may be landing after it. Not written.
    // (Also one an earlier save of this phone was adding: this save was started while they were still listed.)
    {
      const off = (here() ? adding.filter(id => !(S.players || []).some(p => p && p.id === id)).concat(_removedHereIds(S.players)) : [])
        .concat(Object.keys(_rosterRemovedNo).filter(id => _rosterRemovedNo[id] > writeNo)); // removed by a newer save of this phone
      if(off.length) ours = Object.assign({}, ours, { players: (ours.players || []).filter(p => !(p && off.includes(p.id))) });
    }
    // A player an earlier save of this phone is still adding (that save is still running) whom the room does not
    // have: left to that save. Either it has not landed yet and adds them itself, or it has landed, its confirmation
    // is still on its way and somebody took the player off since: writing them here would put a removed player back.
    if(remote){
      const there = new Set((remote.players || []).map(p => p && p.id));
      const early = (ours.players || []).filter(p => p && earlier[p.id] && _savesRunning[earlier[p.id]] && !there.has(p.id)).map(p => p.id);
      if(early.length) ours = Object.assign({}, ours, { players: ours.players.filter(p => !(p && early.includes(p.id))) });
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
    const knownNow = here() ? _lastSnapshotPlayerIds : (visit === _roomGeneration ? _knownEver.concat(_lastSnapshotPlayerIds || []) : _knownSince(_knownAtExit[visit] || null, ref.id)); // away: no screen to ask, so every id the visit saw
    if(knownNow){
      const late = knownNow.filter(id => !(known || []).includes(id) && (shared.players || []).some(p => p && p.id === id));
      if(late.length) known = (known || []).concat(late);
    }
    // And the players it lists whom a run of a save of this phone has read in the room (see _addLanded).
    {
      const landed = (shared.players || []).map(p => p && p.id).filter(id => id && _addLanded[id] && !(known || []).includes(id));
      if(landed.length) known = (known || []).concat(landed);
    }
    let merged = remote ? mergeSharedState(ours, remote, known, true) : ours;
    // Reset Draft carried by this save and still the newest word on the draft: the rosters go with it. (The reset
    // is tapped on a screen; a pick that landed before this phone was shown it is not on that screen, so "the
    // players" were not among the keys this save changed and the pick's team stayed on a roster of a draft that
    // had not started.)
    if(mine && mine.includes('ds') && merged.ds && !merged.ds.started && (merged.players || []).some(p => p && p.teamIds && p.teamIds.length)){
      merged = Object.assign({}, merged, { players: merged.players.map(p => (p && p.teamIds && p.teamIds.length) ? Object.assign({}, p, { teamIds: [] }) : p) });
    }
    _saveBuilt[writeNo] = true; // from here on this save's roster is fixed: a player handed to it now would not be written
    const json = JSON.stringify(merged);
    _saveWrote[writeNo] = { json, at: preAt };
    if(json === preState) _landedSeen[writeNo] = json; // the room this run read already holds exactly what it writes
    writtenIds = (merged.players || []).map(p => p.id);
    _saveBuilt[writeNo] = writtenIds; // what this run writes: see _addHeir
    for(const id of Object.keys(_rosterInFlight)){ if(_rosterInFlight[id] === writeNo && !writtenIds.includes(id)){ delete _rosterInFlight[id]; if(here() && !(S.players || []).some(p => p && p.id === id)) _rosterGone[id] = 3; else if(here() && _syncBase && _handedOver[id] === writeNo) _resendHandedOver(id); } }
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
  }).catch(e => {
    // Told the save failed, after this phone has been shown the room with the save in it: only the confirmation
    // was lost. It is a confirmed save. (Treated as refused, the baseline went back to before the save: a player
    // it had added, taken off this screen next, was never removed from the room, and a setting tapped back was
    // "nothing to send".)
    // (What its LAST run wrote: Firestore can run a save again after an earlier run has landed.)
    if(visit === _roomGeneration && _saveWrote[writeNo] && _landedSeen[writeNo] === _saveWrote[writeNo].json) return;
    throw e;
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
    // Confirmed after its visit ended: the players it sent and wrote are known to the saves of that visit still on their way.
    if(writtenIds && !here()){
      const sent = new Set((shared.players || []).map(p => p.id)), ids = writtenIds.filter(id => sent.has(id));
      if(visit === _roomGeneration) _lastSnapshotPlayerIds = Array.from(new Set((_lastSnapshotPlayerIds || []).concat(ids)));
      else if(_knownAtExit[visit]) _knownAtExit[visit] = Array.from(new Set(_knownAtExit[visit].concat(ids)));
    }
    // A player handed to this save after it had built its roster without them: it did not write them. Sent again.
    if(writtenIds && here()) for(const id of Object.keys(_rosterInFlight)){
      if(_rosterInFlight[id] !== writeNo || _handedOver[id] !== writeNo || writtenIds.includes(id)) continue;
      delete _rosterInFlight[id];
      if((S.players || []).some(p => p && p.id === id) && _syncBase) _resendHandedOver(id); else _rosterGone[id] = 3;
    }
    const tookOff = Object.keys(_rosterRemoving).filter(id => _rosterRemoving[id] === writeNo); // the players this save removed
    for(const p of (shared.players || [])){ if(p) delete _refusedAdds[p.id]; } // a confirmed save of this phone listed them itself: in the room for certain, and known
    for(const id of tookOff) delete _rosterRemoving[id];
    // Unless an update later than the room this save read has already been applied and does not have the player:
    // another phone took them off after this save. Nothing newer is promised, so there is nothing to wait for;
    // that update is shown again below, now that the player is no longer on their way.
    let rosterReapply = false;
    if(preAtSaved && here()){
      let lastIds = null; // the players of the last applied update, when it is later than the room this save read
      // A player this save took off whom such an update has: put back since (a phone that was offline wrote its
      // old copy of the room). The room holds them and nothing more is on its way from here: shown again below.
      for(const id of tookOff){
        if((S.players || []).some(p => p && p.id === id)) continue;
        if(lastIds === null) lastIds = _laterRosterIds(preAtSaved, preState) || false;
        if(lastIds && lastIds.has(id)) rosterReapply = true;
      }
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
    // The room was busy (the transaction lost every race) and this save's visit is over: inside a visit the retry
    // below sends the edit again, but that reads the screen, and the screen is no longer this visit's. The save
    // itself is still good (its own keys over whatever the room holds then), so it is run again, a few times.
    if(e && e.code === 'aborted' && !here() && ++awayTries <= 5){ again = true; return; }
    _refusedSent.add(shared);
    // (The save may have landed all the same and its update is still to come. That update must not be skipped as
    // this save's echo: it is how this phone learns the room holds what it sent, such as a player it added.)
    if(visit === _roomGeneration && _echoWriteNo === writeNo && expectSynced !== null && _lastSyncedState === expectSynced){ _lastSyncedState = _lastRoomDoc && _lastRoomDoc.exists ? _lastRoomDoc.data().state : null; _echoWriteNo = 0; }
    const failedKeys = Object.keys(_inFlight).filter(k => _inFlight[k].no === writeNo);
    if(here()) for(const k of failedKeys) _resendKeys[k] = writeNo;
    const failedRoster = Object.keys(_rosterInFlight).filter(id => _rosterInFlight[id] === writeNo);
    if(here() && !(e && e.code === 'aborted')) for(const id of failedRoster) _refusedAdds[id] = true; // (not a save the busy room never let through: that one did not land)
    const failedRemoving = Object.keys(_rosterRemoving).filter(id => _rosterRemoving[id] === writeNo);
    dropInFlight(true); // a player this save was adding goes to a later save that still lists them
    // (A later save of this phone that started with the very same text has made the baseline its own: going back
    // to this save's starting point would undo what that save is carrying.)
    const baseMoved = _syncBase !== localJson || _writeSeq !== writeNo;
    if(failedKeys.length && baseMoved && _serverSeen && here()){
      try {
        const server = JSON.parse(_serverSeen), b = JSON.parse(_syncBase);
        // (Where the screen shows what the room was last seen to hold, the retry would find nothing to send, and an
        // earlier save of this phone that is still on its way with the previous value would win: there the baseline
        // goes back to what this save started from, so the retry sends the key again.)
        const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
        for(const k of failedKeys){ const v = base && same(server[k], S[k]) && !same(base[k], S[k]) ? base[k] : server[k]; b[k] = v; if(_syncedShared) _syncedShared[k] = v; }
        _syncBase = JSON.stringify(b);
        _sharedAtSync = null;
      } catch(err){}
    }
    if((failedRoster.length || failedRemoving.length) && baseMoved && _serverSeen && here()){
      try {
        const server = JSON.parse(_serverSeen), there = new Set((server.players || []).map(p => p && p.id));
        // (A removal also counts when this phone knows the player to be in the room from a confirmed save of its
        // own: that save's echo is not applied, so the room as last seen can still be without them. They go back
        // into the baseline as the refused save started with them.)
        const knownGone = failedRemoving.filter(id => !there.has(id) && (_lastSnapshotPlayerIds || []).includes(id) && !(S.players || []).some(p => p.id === id));
        if(knownGone.length || failedRoster.some(id => !there.has(id) && (S.players || []).some(p => p.id === id)) || failedRemoving.some(id => there.has(id) && !(S.players || []).some(p => p.id === id))){
          const b = JSON.parse(_syncBase);
          // (Players another save of this phone is still adding stay in the baseline, as a snapshot keeps them, and
          // so do players a confirmed save of this phone added whom the room as last seen does not show yet: one
          // taken off this screen next is then a removal to send, not "nothing changed".)
          const flying = (b.players || []).filter(p => p && (_rosterInFlight[p.id] || (_lastSnapshotPlayerIds || []).includes(p.id)) && !there.has(p.id) && !knownGone.includes(p.id));
          b.players = (server.players || []).concat(flying, ((base && base.players) || []).filter(p => p && knownGone.includes(p.id)));
          if(_syncedShared) _syncedShared.players = JSON.parse(JSON.stringify(b.players));
          _syncBase = JSON.stringify(b);
          _sharedAtSync = null;
        }
      } catch(err){}
    }
    // Nothing was written: go back to the earlier base, so the next write still carries these edits. The
    // pending-edit baseline goes back too (unless a snapshot moved it on during the write): until the save is
    // retried, a snapshot from another phone must keep these edits the way it keeps an edit in the debounce.
    if(here() && !baseMoved){
      _syncBase = baseAtStart;
      try { _syncedShared = baseAtStart ? JSON.parse(baseAtStart) : null; } catch(err){}
      // A key of this save that the screen has since put back to what the save started from (an edit waiting in
      // the debounce): that starting value can be one an earlier save of this phone was still sending, and that
      // save leaves the key to this one. Where the room was last seen to hold something else, the room's value
      // is the baseline, so the retry sends the key instead of finding nothing changed.
      if(failedKeys.length && base && _serverSeen && _syncedShared){
        try {
          const server = JSON.parse(_serverSeen), same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
          const back = failedKeys.filter(k => same(base[k], S[k]) && !same(server[k], S[k]));
          for(const k of back) _syncedShared[k] = server[k];
          if(back.length){ const b = JSON.parse(baseAtStart); for(const k of back) b[k] = server[k]; _syncBase = JSON.stringify(b); }
        } catch(err){}
      }
      // A player this save was left to add (their own adding save had failed) is listed in that starting point as
      // already sent. Still on this screen, not in the room as last seen, no other save adding them: out of the
      // baseline, so the retry adds them and they are waited for like any new player.
      if(failedRoster.length && _serverSeen && _syncBase){
        try {
          const there = new Set((JSON.parse(_serverSeen).players || []).map(p => p && p.id));
          const lost = failedRoster.filter(id => !_rosterInFlight[id] && !there.has(id) && (S.players || []).some(p => p && p.id === id));
          const b = lost.length ? JSON.parse(_syncBase) : null;
          if(b && (b.players || []).some(p => p && lost.includes(p.id))){
            b.players = b.players.filter(p => !(p && lost.includes(p.id)));
            _syncBase = JSON.stringify(b);
            if(_syncedShared && _syncedShared.players) _syncedShared.players = _syncedShared.players.filter(p => !(p && lost.includes(p.id)));
            _sharedAtSync = null;
          }
        } catch(err){}
      }
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
  // Counted until its last run is over: connectToRoom keeps what this save's visit knew for as long as it runs.
  _visitSaves[visit] = (_visitSaves[visit] || 0) + 1;
  _savesRunning[writeNo] = true;
  const over = () => { if(again){ again = false; run(); return; } delete _savesRunning[writeNo]; delete _saveWrote[writeNo]; delete _landedSeen[writeNo]; delete _saveSends[writeNo]; delete _saveBuilt[writeNo]; for(const id of Object.keys(_handedOver)){ if(_handedOver[id] === writeNo) delete _handedOver[id]; } if(--_visitSaves[visit] <= 0) delete _visitSaves[visit]; };
  const run = () => attempt().then(over, over);
  run();
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
  if(_lastSnapshotPlayerIds){ _knownAtExit[_roomGeneration] = Array.from(new Set(_knownEver.concat(_lastSnapshotPlayerIds))); const old = Object.keys(_knownAtExit).filter(v => !_visitSaves[v]); while(old.length > 4) delete _knownAtExit[old.shift()]; }
  _knownEver = [];
  _lastSnapshotPlayerIds = null; // the previous room's roster says nothing about this one
  _syncedShared = null;
  _serverSeen = null;
  // (_recentSent too: the update that brings a save from the last visit is this phone's own value, not another phone's change.)
  const changedRoom = code !== _writeNoRoom;
  const goneAtExit = changedRoom ? [] : _removedHereIds(S.players); // read before the lists below are emptied
  if(changedRoom){ _recentSent = []; _keyWriteNo = {}; _rosterRemovedNo = {}; _addLanded = {}; _writeNoRoom = code; } // kept for the same room: a save from the last visit may still be on its way
  else { for(const id of _removedHereIds(S.players)) _rosterRemovedNo[id] = _writeSeq + 1; } // added and taken off again in the last visit (S is this phone's cached copy of that screen): the save that was adding them leaves them out
  // A setting a save from the last visit to this room is still carrying stays in flight (`carried`): until that save
  // is seen, the value it sent is this phone's baseline for the setting, as it was before Home.
  { const kept = {}; if(!changedRoom) for(const k of Object.keys(_inFlight)){ const f = _inFlight[k]; if(!f.acked) kept[k] = Object.assign(f, { held: false, carried: true }); } _inFlight = kept; }
  _pendingBase = {};
  _rosterInFlight = {};
  _rosterGone = {};
  // Added and taken off again in the last visit to this room: the save that was adding them may already have
  // written them. An update of this visit that brings them is answered with the removal, as it was before Home.
  for(const id of goneAtExit) _rosterGone[id] = 3;
  _rosterAcked = {};
  _rosterRemoving = {};
  _refusedAdds = {};
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
  _resendKeys = {}; // the refused saves of the room just left are not this room's
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
  // (Exactly what a running save wrote, stamped later than the room that save read: the save is in the room.)
  for(const no of Object.keys(_saveWrote)){ if(data.state === _saveWrote[no].json && _laterThan(doc, _saveWrote[no].at)) _landedSeen[no] = data.state; }
  // Firestore delivers our own write back twice (latency-compensated, then server-acked with the
  // real updatedAt). Both carry the exact string we wrote, so neither needs a parse or a redraw.
  if(data.state === _lastSyncedState){
    // The exact echo of a save: everything that save (or an earlier one) carried is on the server now.
    // (Unless it is stamped no later than the room that save was built on: the same string, but an older state.)
    const echoAt = _docAt(data);
    // The same text as the last update applied, with a later commit time: a newer room that happens to read the same
    // (a value changed and changed back). Nothing to draw, but it is the last word: a save confirmed after it asks.
    const newer = !!(_lastRoomDoc && _lastRoomDoc.exists && _lastRoomDoc.data().state === data.state && _laterThan(doc, _docAt(_lastRoomDoc.data())));
    if(newer || (echoAt && _lastRoomDoc && _lastRoomDoc.exists && _laterThan(doc, _docAt(_lastRoomDoc.data())))) _lastRoomDoc = doc;
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
    for(const id of (knownBefore || []).concat(_lastSnapshotPlayerIds)){ if(!_knownEver.includes(id)) _knownEver.push(id); }
    const shownBefore = S.players || [];
    // A player a refused save was adding, since taken off this screen: if that save landed after all, the room has
    // them (or will): the removal is answered like any player removed here before the room showed them.
    for(const id of Object.keys(_refusedAdds)){
      if(_rosterInFlight[id]) continue; // another save of this phone is adding them now
      if(!shownBefore.some(p => p && p.id === id)){ _rosterGone[id] = 3; delete _refusedAdds[id]; }
      else if((remote.players || []).some(p => p && p.id === id)) delete _refusedAdds[id]; // in the room and on this screen: known from here on
    }
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
    // (Taken off this screen by this update, not by a tap here: no removal to answer.)
    for(const id of Object.keys(_refusedAdds)){ if(shownBefore.some(p => p && p.id === id) && !(S.players || []).some(p => p && p.id === id)) delete _refusedAdds[id]; }
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

