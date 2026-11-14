/* ── Utility Functions ── */
function seedClass(s){ return s <= 4 ? "seed-top" : s <= 8 ? "seed-mid" : "seed-low"; }
function seedBadge(s){ return `<span class="seed-badge ${seedClass(s)}">${escapeHtml(s == null ? '' : s)}</span>`; }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Room codes are Firestore doc ids rendered into HTML and URLs: letters/digits only, 2-20 chars.
// Returns '' for anything that does not qualify. Same rule createRoom() has always enforced.
function sanitizeRoomCode(raw){ const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,20); return c.length >= 2 ? c : ''; }
function owner(tid){ const pl = S.players.find(p => p.teamIds.includes(tid)); return pl ? pl.name : ""; }
// One color per player (by join order) for the dots and owner codes on every screen. Gold is left out:
// it marks "you". Rooms with more than eight players reuse colors.
const PLAYER_COLORS = ['#1F5FAD','#7A4EAB','#2E8B57','#D1495B','#E07B24','#1B9AAA','#6B7A8F','#8C6D46'];
function playerColor(pid){ const i = S.players.findIndex(p => p.id === pid); return PLAYER_COLORS[Math.max(i, 0) % PLAYER_COLORS.length]; }
function playerDot(pid){ return `<span class="pdot" style="background:${playerColor(pid)}"></span>`; }
// Three-letter owner tag for bracket slots, where a full name does not fit.
function ownerCode(name){ return String(name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); }
function ownerOf(tid){ return S.players.find(p => (p.teamIds || []).includes(tid)) || null; }

function teamDisplayName(t) {
  if (t.playIn && !t.playInResolved) return t.playInTeams.map(pt => pt.name).join(' / ');
  return t.name;
}
/* Picks and bracket winners store team ids, so replacing or clearing the team list while any exist
 * leaves every one of them dangling (blank draft rows, bracket slots that never resolve). Returns the
 * reason to show the admin, or '' when the team list may be edited freely. */
function teamEditBlockedReason(){
  const picks = (S.players || []).reduce((n, p) => n + ((p.teamIds || []).length), 0);
  const winners = Object.values(S.bracket || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.filter(Boolean).length : 0), 0);
  const started = !!(S.ds && S.ds.started);
  if(!picks && !winners && !started) return '';
  const what = [picks ? picks + ' pick' + (picks === 1 ? '' : 's') : '', winners ? winners + ' bracket result' + (winners === 1 ? '' : 's') : ''].filter(Boolean).join(' and ');
  return 'Teams are locked: ' + (what || 'the draft has started') + (what ? ' point at them' : '') + '. Reset the draft or start a new tournament first.';
}
/* Team logos are the schools' marks, not ours to ship; the app renders none (seed badge + name instead).
 * Rooms imported before the NCAA.com switch still carry ESPN logo URLs in state; they are ignored. */
function teamLogoHTML(t, size) { // eslint-disable-line no-unused-vars
  return '';
}
function teamRecordDisplay(t) {
  if (t.playIn && !t.playInResolved) return t.playInTeams.map(pt => pt.record).filter(Boolean).join(' / ');
  return t.record || '';
}

async function resolvePlayIn(teamId, winnerIdx) {
  const team = S.teams.find(t => t.id === teamId);
  if (!team || !team.playIn) return;
  const winner = team.playInTeams && team.playInTeams[winnerIdx];
  if (!winner) return; // bad index or a slot with no play-in pair: leave it for the admin
  team.name = winner.name;
  team.logo = '';
  team.abbr = winner.abbr || '';
  team.ncaaId = winner.ncaaId;
  team.color = '';
  team.record = winner.record || '';
  team.playInResolved = true;
  saveState();
  render();
}

let _lastAutoResolve = 0;
let _autoResolveFetching = false; // a bracket fetch is in flight: a second call must not start another
async function autoResolvePlayIns() {
  const now = Date.now();
  if (now - _lastAutoResolve < 3600000 || _autoResolveFetching) return; // once per hour max, one fetch at a time
  const unresolved = S.teams.filter(t => t.playIn && !t.playInResolved);
  if (unresolved.length === 0) return;
  // One bracket fetch: the First Four games there carry isWinner once they are final.
  let data;
  _autoResolveFetching = true;
  try { data = await ncaa.fetchBracket(S.year); } finally { _autoResolveFetching = false; }
  // Only arm the hourly throttle once the bracket actually answered; a dead network on First Four
  // night must not lock auto-resolve out for an hour.
  if (!data) return false; // the request failed: the manual check says so instead of "not final yet"
  _lastAutoResolve = now;
  const decided = ncaa.firstFourWinners(data);
  for (const ff of decided) {
    for (const ut of unresolved) {
      if (ut.playInResolved) continue;
      const ids = ut.playInTeams.map(pt => pt.ncaaId);
      if (!ff.ncaaIds.every(id => ids.includes(id))) continue;
      const winnerIdx = ids.indexOf(ff.winner);
      if (winnerIdx >= 0) await resolvePlayIn(ut.id, winnerIdx);
    }
  }
}

function snakeOrder(pids, tot){
  const o = [];
  let r = 0;
  while(o.length < tot){
    const ids = r % 2 === 1 ? [...pids].reverse() : [...pids];
    for(const id of ids){ if(o.length < tot) o.push(id); }
    r++;
  }
  return o;
}

/* ── Bracket Logic ── */
/* True when the room's pick deadline is no longer the one this client watched expire. On expiry the
 * active drafter's client AND every admin-unlocked client call autoPickHighestSeed(); whichever
 * transaction commits first resets the deadline, and the others must stand down instead of taking
 * the NEXT player's turn. expectedSeconds is the local deadline's Timestamp.seconds; remoteDeadline
 * is the deadline as parsed from the room document ({seconds, nanoseconds} or null). */
function pickDeadlineMoved(expectedSeconds, remoteDeadline){
  if(expectedSeconds == null) return false; // no reference deadline: keep the old behaviour
  const rs = remoteDeadline && typeof remoteDeadline === 'object' ? remoteDeadline.seconds : null;
  return rs !== expectedSeconds;
}

function getTeamForSlot(region, gameIdx, slotIdx){
  const rTeams = S.teams.filter(t => t.region === region);
  if(gameIdx < 8){
    const seedNeeded = R1_SEEDS[gameIdx][slotIdx];
    return rTeams.find(t => t.seed === seedNeeded) || null;
  }
  const feeder = FEEDERS[gameIdx][slotIdx];
  const winnerId = S.bracket[region][feeder];
  return winnerId ? S.teams.find(t => t.id === winnerId) : null;
}

/* The tapped team is the one the page showed BEFORE the admin check; that check can be a PIN prompt, and another
 * admin may have changed an earlier result meanwhile so the game now holds other teams. Only a team the game still
 * shows may win it. A game with no team known yet (both feeders open) is left alone: nothing was shown to tap. */
function teamNoLongerInGame(region, gameIdx, teamId){
  const t0 = getTeamForSlot(region, gameIdx, 0), t1 = getTeamForSlot(region, gameIdx, 1);
  if(!t0 && !t1) return false;
  return (!t0 || t0.id !== teamId) && (!t1 || t1.id !== teamId);
}

async function advanceTeam(region, gameIdx, teamId){
  if(!await requireAdmin()) return;
  if(teamNoLongerInGame(region, gameIdx, teamId)){ showToast('That game changed while the PIN prompt was open. Tap the winner again.'); return; }
  const b = S.bracket[region];
  const oldWinner = b[gameIdx];
  if(oldWinner === teamId) return; // no-op, skip Firestore write
  b[gameIdx] = teamId;
  if(oldWinner) clearDownstream(region, gameIdx);
  cascadeFF();
  syncGames();
  saveState();
  render();
}

function clearDownstream(region, changedGame){
  for(let gi = changedGame+1; gi < 15; gi++){
    if(!FEEDERS[gi]) continue;
    const t0 = getTeamForSlot(region, gi, 0);
    const t1 = getTeamForSlot(region, gi, 1);
    const w = S.bracket[region][gi];
    if(w && (!t0 || t0.id !== w) && (!t1 || t1.id !== w)){
      S.bracket[region][gi] = null;
    }
  }
}

/* The same check for the Final Four. A semifinal is between the champions of its two regions (the room's pairing,
 * which an admin can also change), the title game between the two semifinal winners. Read after the admin check,
 * so a regional final, a semifinal or the pairing changed by another admin meanwhile is seen. */
function teamNoLongerInFFGame(ffIdx, teamId){
  let a, b;
  if(ffIdx < 2){
    const pair = ffPairs()[ffIdx];
    a = S.bracket[pair[0]][14]; b = S.bracket[pair[1]][14];
  } else {
    a = S.bracket.ff[0]; b = S.bracket.ff[1];
  }
  if(!a && !b) return false;
  return a !== teamId && b !== teamId;
}

async function advanceFF(ffIdx, teamId){
  if(!await requireAdmin()) return;
  if(teamNoLongerInFFGame(ffIdx, teamId)){ showToast('That game changed while the PIN prompt was open. Tap the winner again.'); return; }
  if(S.bracket.ff[ffIdx] === teamId) return;
  S.bracket.ff[ffIdx] = teamId;
  if(ffIdx < 2){
    const cw = S.bracket.ff[2];
    if(cw && cw !== S.bracket.ff[0] && cw !== S.bracket.ff[1]) S.bracket.ff[2] = null;
  }
  syncGames();
  saveState();
  render();
}

/* ── Bracket Clear (right-click / long-press) ── */
let _longPressTimer = null;
let _longPressTriggered = false;

function startLongPress(fn){
  clearTimeout(_longPressTimer); // never two timers: a second touchstart must not leave the first one running with nothing able to cancel it
  _longPressTriggered = false;
  _longPressTimer = setTimeout(() => { _longPressTriggered = true; fn(); }, 500);
}
function endLongPress(event){
  clearTimeout(_longPressTimer);
  if(_longPressTriggered){ event.preventDefault(); _longPressTriggered = false; }
}
function cancelLongPress(){
  clearTimeout(_longPressTimer);
  _longPressTriggered = false;
}

/* Bracket slots carry data-lp="r:<region>:<game>" or data-lp="ff:<idx>" instead of
   inline touch handlers. One passive touchstart/touchmove listener per page keeps
   horizontal bracket scrolling smooth on iOS; touchend stays non-passive so the
   ghost click after a long press can still be cancelled. */
function longPressAction(lp){
  const p = String(lp || '').split(':');
  if(p[0] === 'r' && p.length === 3 && p[1] !== '' && p[2] !== '' && !isNaN(p[2])) return () => clearBracketGame(p[1], Number(p[2]));
  if(p[0] === 'ff' && p.length === 2 && p[1] !== '' && !isNaN(p[1])) return () => clearFFGame(Number(p[1]));
  return null;
}
function longPressTarget(e){
  const t = e && e.target;
  return t && typeof t.closest === 'function' ? t.closest('[data-lp]') : null;
}
function onBracketTouchStart(e){
  // A second finger down is a gesture (two-finger scroll, a stray palm), not a long press: drop what the first finger started.
  if(e && e.touches && e.touches.length > 1){ cancelLongPress(); return; }
  const el = longPressTarget(e);
  if(!el) return;
  const act = longPressAction(el.getAttribute('data-lp'));
  if(act) startLongPress(act);
}
function onBracketTouchEnd(e){
  if(longPressTarget(e)) endLongPress(e); else cancelLongPress();
}
if(typeof document !== 'undefined' && document && typeof document.addEventListener === 'function'){
  document.addEventListener('touchstart', onBracketTouchStart, { passive: true });
  document.addEventListener('touchmove', cancelLongPress, { passive: true });
  document.addEventListener('touchcancel', cancelLongPress, { passive: true });
  document.addEventListener('touchend', onBracketTouchEnd, { passive: false });
}

async function clearBracketGame(region, gameIdx, event){
  if(event) event.preventDefault();
  if(!await requireAdmin()) return;
  const b = S.bracket[region];
  if(!b[gameIdx]) return;
  b[gameIdx] = null;
  clearDownstream(region, gameIdx);
  cascadeFF();
  syncGames();
  saveState();
  render();
}

async function clearFFGame(ffIdx, event){
  if(event) event.preventDefault();
  if(!await requireAdmin()) return;
  if(S.bracket.ff[ffIdx] == null && (ffIdx >= 2 || S.bracket.ff[2] == null)) return;
  S.bracket.ff[ffIdx] = null;
  if(ffIdx < 2){ S.bracket.ff[2] = null; }
  syncGames();
  saveState();
  render();
}

/* ── Final Four pairing ──
 * Which two regional champions meet in each national semifinal changes every year (2025: South-West and
 * East-Midwest; 2026: East-South and West-Midwest). S.ffPairs holds the room's pairing as [[r, r], [r, r]];
 * importFromNCAA reads it from the bracket feed, Settings lets an admin pick it for a hand-built room, and rooms
 * from before this field existed keep the pairing the app always assumed. bracket.ff[0] is the winner of pair 0. */
const FF_PAIRINGS = [
  [['South', 'East'], ['Midwest', 'West']],
  [['South', 'West'], ['East', 'Midwest']],
  [['South', 'Midwest'], ['East', 'West']]
];
function ffPairsValid(p){
  return Array.isArray(p) && p.length === 2 && p.every(x => Array.isArray(x) && x.length === 2 && x.every(r => REGIONS.includes(r)))
    && new Set(p.flat()).size === 4;
}
function ffPairs(){
  return ffPairsValid(S.ffPairs) ? S.ffPairs : FF_PAIRINGS[0];
}
/** Index into FF_PAIRINGS of the room's pairing (pairs compared as sets), for the Settings control. */
function ffPairingIndex(){
  const key = p => p.map(x => x.slice().sort().join('+')).sort().join('|');
  const cur = key(ffPairs());
  const i = FF_PAIRINGS.findIndex(p => key(p) === cur);
  return i < 0 ? 0 : i;
}
async function setFinalFourPairing(v){
  if(!await requireAdmin()){ render(); return; } // redraw so the select shows the room's pairing again, not the refused choice
  const next = FF_PAIRINGS[Number(v)];
  if(!next || ffPairingIndex() === Number(v)) return;
  S.ffPairs = next;
  cascadeFF(); // a semifinal winner that no longer belongs to its pair is cleared, and the title game with it
  syncGames();
  saveState();
  render();
}

function cascadeFF(){
  const pairs = ffPairs();
  for(let fi = 0; fi < 2; fi++){
    const rw0 = S.bracket[pairs[fi][0]][14];
    const rw1 = S.bracket[pairs[fi][1]][14];
    const ffWinner = S.bracket.ff[fi];
    if(ffWinner && ffWinner !== rw0 && ffWinner !== rw1){
      S.bracket.ff[fi] = null;
      S.bracket.ff[2] = null; // semifinal undecided again, so the title game is too
    }
  }
  if(S.bracket.ff[2]){
    if(S.bracket.ff[2] !== S.bracket.ff[0] && S.bracket.ff[2] !== S.bracket.ff[1]){
      S.bracket.ff[2] = null;
    }
  }
}

/* ── Game Sync & Scoring ── */
function syncGames(){
  const games = [];
  for(const region of REGIONS){
    for(let gi = 0; gi < 15; gi++){
      const wid = S.bracket[region][gi];
      if(!wid) continue;
      const t0 = getTeamForSlot(region, gi, 0);
      const t1 = getTeamForSlot(region, gi, 1);
      if(!t0 || !t1) continue;
      const round = gi < 8 ? 1 : gi < 12 ? 2 : gi < 14 ? 3 : 4;
      games.push({id:`${region}_${gi}`, round, t1:t0.id, t2:t1.id, wid});
    }
  }
  const pairs = ffPairs();
  for(let fi = 0; fi < 2; fi++){
    const wid = S.bracket.ff[fi];
    if(!wid) continue;
    const t0id = S.bracket[pairs[fi][0]][14];
    const t1id = S.bracket[pairs[fi][1]][14];
    if(t0id && t1id) games.push({id:`ff_${fi}`, round:5, t1:t0id, t2:t1id, wid});
  }
  if(S.bracket.ff[2]){
    const t0 = S.bracket.ff[0], t1 = S.bracket.ff[1];
    if(t0 && t1) games.push({id:'champ', round:6, t1:t0, t2:t1, wid:S.bracket.ff[2]});
  }
  S.games = games;
}

/* ── Invite codes ──
 * A room created since 2026-11 has S.joinKey: new players need it to join, so guessing a room name is not
 * enough. Invite links carry it (?room=CODE&key=KEY) and each device remembers the key per room. Players
 * already in the room can rejoin with their PIN alone. Rooms without a key stay open to anyone with the code. */
const JOIN_KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L, so a code read aloud is typed right
function newJoinKey(){
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, n => JOIN_KEY_CHARS[n % JOIN_KEY_CHARS.length]).join('');
}
function sanitizeJoinKey(raw){ const k = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g,''); return /^[A-Z0-9]{4,12}$/.test(k) ? k : ''; }
function rememberJoinKey(code, key){ key = sanitizeJoinKey(key); if(code && key) try { localStorage.setItem('mm4_key_' + code, key); } catch(e){} }
function knownJoinKey(code){ try { return localStorage.getItem('mm4_key_' + code) || ''; } catch(e){ return ''; } }
function inviteUrl(code, key){ return SITE_URL + '?room=' + encodeURIComponent(code) + (key ? '&key=' + encodeURIComponent(key) : ''); }

/* ── Shared-state hardening ──
 * Record ids are interpolated into inline onclick handlers (pickTeam('<id>') etc.). Every client can
 * write the whole room state, so a hostile participant could plant an id that breaks out of that
 * string and runs script in everyone else's browser. Legitimate ids are always generateId() UUIDs,
 * so anything outside [A-Za-z0-9_-] is dropped at the data boundary (snapshot apply + local load). */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function isSafeId(id){ return typeof id === 'string' && SAFE_ID_RE.test(id); }
const BRACKET_KEYS = ['South', 'East', 'Midwest', 'West', 'ff'];
function sanitizeSharedState(s){
  if(!s || typeof s !== 'object') return s;
  // Shape first: the page reads these containers without checking them, so a damaged room document must
  // not stop every phone in the pool from drawing the room. Only a key that is present is repaired.
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  for(const k of ['players', 'teams', 'games']) if(k in s && !Array.isArray(s[k])) s[k] = [];
  if(Array.isArray(s.games)) s.games = s.games.filter(isObj);
  if('ds' in s){
    if(!isObj(s.ds)) s.ds = {order:[], cp:0, started:false, complete:false};
    if(!Array.isArray(s.ds.order)) s.ds.order = [];
  }
  if('bracket' in s){
    if(!isObj(s.bracket)) s.bracket = {};
    for(const k of BRACKET_KEYS) if(!Array.isArray(s.bracket[k])) s.bracket[k] = Array(k === 'ff' ? 3 : 15).fill(null);
  }
  if(Array.isArray(s.players)) s.players = s.players.filter(p => p && isSafeId(p.id));
  if(Array.isArray(s.teams)) s.teams = s.teams.filter(t => t && isSafeId(t.id));
  for(const t of (s.teams || [])) if(t.seed != null && typeof t.seed !== 'number'){ const n = Number(t.seed); t.seed = Number.isFinite(n) ? n : 0; }
  for(const p of (s.players || [])) p.teamIds = (Array.isArray(p.teamIds) ? p.teamIds : []).filter(isSafeId);
  if(s.ds && Array.isArray(s.ds.order)) s.ds.order = s.ds.order.filter(isSafeId);
  // Names are compared and matched as text (name already taken?, Live tab team lookup): make sure they are text.
  for(const r of (s.players || []).concat(s.teams || [])) if(typeof r.name !== 'string') r.name = r.name == null ? '' : String(r.name);
  if(s.joinKey != null){ const k = sanitizeJoinKey(s.joinKey); if(k) s.joinKey = k; else delete s.joinKey; }
  if(s.bracket && typeof s.bracket === 'object'){
    for(const k of Object.keys(s.bracket)){
      if(Array.isArray(s.bracket[k])) s.bracket[k] = s.bracket[k].map(id => (id == null || isSafeId(id)) ? id : null);
    }
  }
  // Settings the page prints as numbers (footer scoring line, Settings tab) must arrive as numbers too.
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  if('year' in s) s.year = Math.trunc(num(s.year, new Date().getFullYear()));
  if('rp' in s){
    const rp = (s.rp && typeof s.rp === 'object') ? s.rp : {};
    s.rp = {};
    for(const r of [1,2,3,4,5,6]) s.rp[r] = num(rp[r], 0);
  }
  if('ub' in s) s.ub = !!s.ub;
  if('draftClockDuration' in s) s.draftClockDuration = Math.max(0, num(s.draftClockDuration, 0));
  return s;
}

// Points a game earns whoever owns its winner: the round value, plus the seed gap when an underdog wins.
function gamePoints(g){
  let pts = S.rp[g.round] || 0;
  if(S.ub){
    const w = S.teams.find(t => t.id === g.wid);
    const lid = g.t1 === g.wid ? g.t2 : g.t1;
    const l = S.teams.find(t => t.id === lid);
    if(w && l && w.seed > l.seed) pts += (w.seed - l.seed);
  }
  return pts;
}

function teamWins(tid){ return (S.games || []).filter(g => g.wid === tid).length; }
function teamPoints(tid){ return (S.games || []).filter(g => g.wid === tid).reduce((n, g) => n + gamePoints(g), 0); }
function teamEliminated(tid){ return (S.games || []).some(g => (g.t1 === tid || g.t2 === tid) && g.wid && g.wid !== tid); }

function scores(){
  return S.players.map(p => {
    let tot = 0;
    const rp = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
    for(const g of (S.games || [])){
      if(!g.wid || !p.teamIds.includes(g.wid)) continue;
      const pts = gamePoints(g);
      rp[g.round] += pts;
      tot += pts;
    }
    return {pid:p.id, name:p.name, tot, rp};
  }).sort((a,b) => b.tot - a.tot);
}


/* ── Shared-state merge (guards the debounced whole-state write) ──
 * Picks are committed by transactions; everything else is written as the whole state blob after a
 * debounce. If a pick landed between our last snapshot and that write, our copy of ds/rosters is
 * stale and would roll the pick back. Draft progress only ever moves forward, so when the server
 * is further along we keep the server's ds and rosters and layer our other edits on top. */
// knownIds: ids of the players in the last snapshot we applied, i.e. the server state `local` was
// derived from. A player the server has but we do not is either one we removed on purpose (was in
// knownIds, stays removed) or one another device added since our snapshot (not in knownIds, kept).
// Without knownIds nobody is dropped: resurrecting a removed player is a redo, losing one is data loss.
function mergeSharedState(local, remote, knownIds){
  const out = Object.assign({}, local);
  if(!remote || !remote.ds || !local || !local.ds) return out;
  // ds.epoch is bumped by every action that moves the draft backwards (start, reset, undo). A higher
  // epoch always wins; only within the same epoch does "further along" (higher cp) mean "newer".
  const remoteEpoch = remote.ds.epoch || 0, localEpoch = local.ds.epoch || 0;
  const remoteCp = remote.ds.cp || 0, localCp = local.ds.cp || 0;
  const remoteWins = remoteEpoch > localEpoch || (remoteEpoch === localEpoch && remoteCp > localCp);
  let players = local.players || [];
  if(remoteWins){
    out.ds = remote.ds;
    const remoteRosters = {};
    for(const p of (remote.players || [])) remoteRosters[p.id] = p.teamIds || [];
    players = players.map(p => Object.assign({}, p, { teamIds: remoteRosters[p.id] || p.teamIds || [] }));
  }
  const have = new Set(players.map(p => p.id));
  const known = knownIds ? new Set(knownIds) : null;
  const added = (remote.players || []).filter(p => p && p.id && !have.has(p.id) && !(known && known.has(p.id)));
  if(added.length){
    // A newcomer has no picks in a draft they were not part of: when our draft state wins, start them empty.
    out.players = players.concat(added.map(p => Object.assign({}, p, remoteWins ? {} : { teamIds: [] })));
  } else if(remoteWins){
    out.players = players;
  }
  return out;
}
// Standard competition ranking over scores(): players level on points share a rank (and a medal),
// and the next rank skips (1, 2, 2, 4).
function withRanks(sc){ return sc.map(s => ({...s, rank: 1 + sc.filter(o => o.tot > s.tot).length})); }

