/* ── Utility Functions ── */
function seedClass(s){ return s <= 4 ? "seed-top" : s <= 8 ? "seed-mid" : "seed-low"; }
function seedBadge(s){ return `<span class="seed-badge ${seedClass(s)}">${escapeHtml(s == null ? '' : s)}</span>`; }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Room codes are Firestore doc ids rendered into HTML and URLs: letters/digits only, 2-20 chars.
// Returns '' for anything that does not qualify. Same rule createRoom() has always enforced.
function sanitizeRoomCode(raw){ const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,20); return c.length >= 2 ? c : ''; }
function owner(tid){ const pl = S.players.find(p => p.teamIds.includes(tid)); return pl ? pl.name : ""; }

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
  const winner = team.playInTeams[winnerIdx];
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
async function autoResolvePlayIns() {
  const now = Date.now();
  if (now - _lastAutoResolve < 3600000) return; // once per hour max
  const unresolved = S.teams.filter(t => t.playIn && !t.playInResolved);
  if (unresolved.length === 0) return;
  _lastAutoResolve = now;
  // One bracket fetch: the First Four games there carry isWinner once they are final.
  const bracketData = await ncaa.fetchBracket(S.year);
  if (!bracketData) { _lastAutoResolve = 0; return false; } // the request failed: say so, and do not make the next check wait an hour
  const decided = ncaa.firstFourWinners(bracketData);
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

async function advanceTeam(region, gameIdx, teamId){
  if(!await requireAdmin()) return;
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

async function advanceFF(ffIdx, teamId){
  if(!await requireAdmin()) return;
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

/* ── Shared-state hardening ──
 * Record ids are interpolated into inline onclick handlers (pickTeam('<id>') etc.). Every client can
 * write the whole room state, so a hostile participant could plant an id that breaks out of that
 * string and runs script in everyone else's browser. Legitimate ids are always generateId() UUIDs,
 * so anything outside [A-Za-z0-9_-] is dropped at the data boundary (snapshot apply + local load). */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function isSafeId(id){ return typeof id === 'string' && SAFE_ID_RE.test(id); }
function sanitizeSharedState(s){
  if(!s || typeof s !== 'object') return s;
  if(Array.isArray(s.players)) s.players = s.players.filter(p => p && isSafeId(p.id));
  if(Array.isArray(s.teams)) s.teams = s.teams.filter(t => t && isSafeId(t.id));
  for(const t of (s.teams || [])) if(t.seed != null && typeof t.seed !== 'number'){ const n = Number(t.seed); t.seed = Number.isFinite(n) ? n : 0; }
  for(const p of (s.players || [])) p.teamIds = (Array.isArray(p.teamIds) ? p.teamIds : []).filter(isSafeId);
  if(s.ds && Array.isArray(s.ds.order)) s.ds.order = s.ds.order.filter(isSafeId);
  if(s.bracket && typeof s.bracket === 'object'){
    for(const k of Object.keys(s.bracket)){
      if(Array.isArray(s.bracket[k])) s.bracket[k] = s.bracket[k].map(id => (id == null || isSafeId(id)) ? id : null);
    }
  }
  return s;
}

function scores(){
  return S.players.map(p => {
    let tot = 0;
    const rp = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
    for(const g of (S.games || [])){
      if(!g.wid || !p.teamIds.includes(g.wid)) continue;
      let pts = S.rp[g.round] || 0;
      if(S.ub){
        const w = S.teams.find(t => t.id === g.wid);
        const lid = g.t1 === g.wid ? g.t2 : g.t1;
        const l = S.teams.find(t => t.id === lid);
        if(w && l && w.seed > l.seed) pts += (w.seed - l.seed);
      }
      rp[g.round] += pts;
      tot += pts;
    }
    return {pid:p.id, name:p.name, tot, rp};
  }).sort((a,b) => b.tot - a.tot);
}

