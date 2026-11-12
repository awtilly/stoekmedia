/* ── Bottom Nav ── */
function bottomNavHTML(_, canT) {
  const tabs = [
    { id: 'draft', label: S.ds && S.ds.complete ? 'My Teams' : 'Draft', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>' },
    { id: 'bracket', label: 'Bracket', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h6v5H3M3 14h6v5H3M9 7.5h3v9H9M12 12h4M16 12h5"/></svg>' },
    { id: 'leaderboard', label: 'Standings', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/></svg>' },
    { id: 'live', label: 'Scores', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 5v14M3 12h18"/></svg>' }
  ];
  const turnDot = isMyDraftTurn() && S.phase !== 'draft';
  return `<nav class="bottom-nav">${tabs.map(t =>
    `<button class="bottom-nav-btn ${S.phase===t.id?'active':''}" ${t.disabled?'disabled':''} onclick="navigate('${t.id}')">${t.id==='draft'&&turnDot?'<span class="turn-dot"></span>':''}${t.icon}<span>${t.label}</span></button>`
  ).join('')}</nav>`;
}

/* ── Draft turn ── */
// True only on the device of the player whose pick it is (an unlocked commissioner can pick for anyone,
// but the gold "your pick" treatment is for the drafter alone).
function isMyDraftTurn(){
  const ds = S.ds, me = getMyPlayerId();
  return !!(ds && ds.started && !ds.complete && me && ds.order[ds.cp] === me);
}
function fmtClock(seconds){ return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); }
// Medals only once points are on the board; before the first result everyone is tied for first.
function medalHTML(rank, tot){ return rank <= 3 && tot > 0 ? `<span class="medal m${rank}">${rank}</span>` : `<span class="rank-num">${rank}</span>`; }
const ROUND_SHORT = {1:'R64', 2:'R32', 3:'S16', 4:'E8', 5:'F4', 6:'CH'};

/* ── Go Home (back to lobby) ── */
function goHome() {
  stopLiveRefresh();
  flushFirestoreWrite(); // last edit in this room goes to this room, before roomId is cleared
  if(unsubRoom) { unsubRoom(); unsubRoom = null; }
  roomId = null;
  loadState(); // drop the room's state from memory so nothing from it can reach the offline cache
  const url = new URL(window.location);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
  renderLobby();
}

/* ── Main Render ── */
function render(){
  try {
  // Remote snapshots re-render mid-typing; remember the focused input and scroll so they survive.
  const _active = document.activeElement;
  const _keep = _active && _active.id && (_active.tagName === 'INPUT' || _active.tagName === 'TEXTAREA')
    ? { id: _active.id, value: _active.value, start: _active.selectionStart, end: _active.selectionEnd } : null;
  const _scrollEl = document.querySelector('.content-scroll');
  const _scrollTop = _scrollEl ? _scrollEl.scrollTop : 0;
  if(roomId && !adminUnlocked){
    const myId = getMyPlayerId();
    if(!myId || !S.players.some(p => p.id === myId)){ renderJoinScreen(); return; }
  }
  // Redirect legacy phases to 'draft'
  let phaseChanged = false;
  if(S.phase === 'setup' || S.phase === 'teams'){ S.phase = 'draft'; phaseChanged = true; }
  if(phaseChanged) saveState();
  const canD = S.players.length >= 2 && S.teams.length >= S.players.length;
  const canT = S.ds.started || S.ds.complete;
  const app = document.getElementById("app");
  const turn = isMyDraftTurn();
  const _hMyId = getMyPlayerId();
  const _hMyP = _hMyId ? S.players.find(p => p.id === _hMyId) : null;
  const hasLive = liveScores.some(g => g.state === 'in');
  app.innerHTML = `
    <div class="header${turn ? ' turn' : ''}">
      <button class="settings-gear" onclick="goHome()" title="Back to Lobby"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></button>
      <div class="header-sub">${roomId ? `<span class="room-badge" onclick="shareRoomLink()" title="Share room link">${roomId}</span>` : `<b>${escapeHtml(APP_NAME)}</b>`} \u00b7 ${_hMyP ? escapeHtml(_hMyP.name) : S.players.length + ' player' + (S.players.length!==1?'s':'')}${hasLive ? '<span class="live-tag">LIVE</span>' : ''}${!isOnline ? ' <span class="offline-badge">Offline</span>' : ''}</div>
      <button class="settings-gear" onclick="openSettings()" title="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></button>
    </div>
    ${turn && S.phase !== 'draft' ? `<button class="turnbar" onclick="navigate('draft')"><b>Your pick<span class="js-turn-timer"></span></b><span>Go to draft \u2192</span></button>` : ''}
    <nav class="top-nav">
      <button class="${S.phase==='draft'?'active':''}" onclick="navigate('draft')">${S.ds && S.ds.complete ? 'My Teams' : 'Draft'}</button>
      <button class="${S.phase==='bracket'?'active':''}" onclick="navigate('bracket')">Bracket</button>
      <button class="${S.phase==='leaderboard'?'active':''}" onclick="navigate('leaderboard')">Standings</button>
      <button class="${S.phase==='live'?'active':''}" onclick="navigate('live')">Scores</button>
      <button class="${S.phase==='settings'?'active':''}" onclick="openSettings()">Settings</button>
    </nav>
    <div class="content-scroll">
      <div id="c"></div>
    </div>
    ${bottomNavHTML(canD, canT)}`;
  const c = document.getElementById("c");
  ({draft:renderDraft, bracket:renderBracket, leaderboard:renderLeaderboard, live:renderLive, settings:renderSettings})[S.phase]?.(c);
  // Start/stop the draft clock. It runs on EVERY tab, not just Draft: the commissioner's device is the
  // autopick fallback for an absent drafter and is usually on Live or Leaderboard while others pick.
  // updateDraftClock() only writes #draft-timer when that element exists.
  if(draftClockShouldRun(S.ds)){
    startDraftClock();
  } else if(_draftClockInterval){
    stopDraftClock();
  }
  // Show paused time in timer element
  if(S.phase === 'draft' && S.ds.timerPaused && S.ds.pausedRemaining != null){
    const el = document.getElementById('draft-timer');
    if(el){
      el.textContent = fmtClock(Math.ceil(S.ds.pausedRemaining / 1000));
      el.className = 'draft-timer paused';
    }
  }
  repositionInstallBanner();
  if(_keep){
    const el = document.getElementById(_keep.id);
    if(el){
      if(el.value === '' && _keep.value) el.value = _keep.value;
      el.focus();
      try { if(_keep.start != null) el.setSelectionRange(_keep.start, _keep.end); } catch(e){}
    }
  }
  const _scrollAfter = document.querySelector('.content-scroll');
  if(_scrollAfter && _scrollTop) _scrollAfter.scrollTop = _scrollTop;
  if(roomId && getMyPlayerId()) showNotificationPrompt();
  } catch(e) {
    console.error('Render error:', e);
    const app = document.getElementById("app");
    if(app) app.innerHTML = `<div style="padding:40px;text-align:center"><h2 style="color:var(--red,#c00)">Something went wrong</h2><p style="margin:12px 0;color:#666">${escapeHtml(e.message || 'An unexpected error occurred.')}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div>`;
  }
}

async function openSettings(){
  if(!adminUnlocked){
    const ok = await requireAdmin();
    if(!ok) return;
  }
  navigate('settings');
}

function navigate(p){
  if (S.phase === 'live' && p !== 'live') { stopLiveRefresh(); releaseWakeLock(); }
  S.phase = p;
  saveState();
  if (p === 'live') startLiveRefresh(); // startLiveRefresh() requests the wake lock itself
  render();
  // Page transition + scroll to top
  requestAnimationFrame(() => {
    const c = document.getElementById('c');
    if (c) { c.classList.remove('page-enter'); void c.offsetWidth; c.classList.add('page-enter'); }
    const scroll = document.querySelector('.content-scroll');
    if (scroll) scroll.scrollTop = 0;
  });
}

async function shareRoomLink() {
  const shareUrl = inviteUrl(roomId, S.joinKey);
  const text = 'Join my ' + APP_NAME + ' pool' + (S.year ? ' for the ' + S.year + ' tournament' : '') + '. Room ' + roomId
    + (S.joinKey ? ', invite code ' + S.joinKey : '') + '.\nOn iPhone, get the app: ' + APP_STORE_URL;
  // The app shell has the native share sheet plugin; WKWebView's navigator.share is not dependable.
  const nativeShare = isNativeShell && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  if (nativeShare) {
    try { await nativeShare.share({ title: APP_NAME, text, url: shareUrl, dialogTitle: 'Invite players' }); return; }
    catch (err) { if (/cancel/i.test(String(err && err.message))) return; }
  }
  const shareData = { title: APP_NAME, text, url: shareUrl };
  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Invite link copied!');
  } catch {
    showToast('Link: ' + shareUrl);
  }
}

// Commissioner: issue a fresh invite code (or the first one, for a room created before codes existed).
// Links already sent stop working for new players; everyone already in the room is unaffected.
async function newInviteCode() {
  if (!await requireAdmin()) return;
  if (S.joinKey && !await appConfirm('Links you already sent will stop working for new players. Players already in the pool are not affected.', { title: 'New invite code?', confirmLabel: 'Make new code' })) return;
  S.joinKey = newJoinKey();
  rememberJoinKey(roomId, S.joinKey);
  saveState();
  render();
  showToast('New invite code: ' + S.joinKey);
}

function inviteCardHTML() {
  if (!roomId) return '';
  const key = S.joinKey;
  return `<div class="card" style="margin-bottom:14px"><span class="label">Invite Players</span>
    <p style="font-size:13px;color:var(--g500);margin-bottom:10px">${key
      ? `Anyone with the link can join. People who type the room code also need the invite code <span class="invite-code">${escapeHtml(key)}</span>`
      : 'Anyone who knows the room code can join this pool.'}</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="shareRoomLink()">Share invite link</button>
      ${adminUnlocked ? `<button class="btn btn-secondary" onclick="newInviteCode()">${key ? 'New invite code' : 'Require invite code'}</button>` : ''}
    </div></div>`;
}

async function shareLeaderboard() {
  const sc = scores();
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  let text = APP_NAME + ' ' + S.year + ' - Leaderboard\n\n';
  sc.forEach((s, i) => {
    const prefix = medals[i] || (i + 1) + '.';
    text += prefix + ' ' + s.name + ' - ' + s.tot + ' pts\n';
  });
  const shareData = { title: 'Madness Draft Leaderboard', text: text };
  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Leaderboard copied!');
  } catch {
    showToast(text);
  }
}

const RESET_WRITE_TIMEOUT_MS = 5000;

async function resetAll(){
  if(!await requireAdmin()) return;
  if(!await appConfirm("Start a new tournament? This will delete all data.", { title: 'New Tournament', danger: true, confirmLabel: 'Start Fresh' })) return;
  if(roomId){
    if(unsubRoom) unsubRoom();
    const freshState = JSON.parse(JSON.stringify(S));
    // Reset to defaults but keep year
    Object.assign(freshState, {
      phase: 'draft', players: [], teams: [],
      ds: {order:[], cp:0, started:false, complete:false},
      rp: {1:1, 2:2, 3:4, 4:8, 5:16, 6:32}, ub: true,
      bracket: {South:Array(15).fill(null), East:Array(15).fill(null), Midwest:Array(15).fill(null), West:Array(15).fill(null), ff:Array(3).fill(null)},
      bracketRegion:'South', fr:'All', fs:'All', liveScoresDate:'', liveScoresFilter:'all'
    });
    const shared = {};
    for(const k in freshState){ if(!VIEW_LOCAL.includes(k)) shared[k] = freshState[k]; }
    // Wait for the reset to reach Firestore before reloading: an unawaited write followed by an
    // immediate reload can be lost, leaving every other device in the old tournament. Bounded so a
    // dead network still reloads (the SDK queues the write and flushes it on reconnect).
    const write = db.collection("rooms").doc(roomId).update({
      state: JSON.stringify(shared),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
    let timer;
    await Promise.race([write, new Promise(r => { timer = setTimeout(r, RESET_WRITE_TIMEOUT_MS); })]);
    clearTimeout(timer);
  }
  localStorage.removeItem(stateKey());
  if(roomId) localStorage.removeItem('mm4_me_' + roomId);
  location.reload();
}


async function addPlayer(){
  if(!await requireAdmin()) return;
  const el = document.getElementById("pn");
  const n = el.value.trim();
  if(!n) return;
  if(S.players.some(p => p.name.toLowerCase() === n.toLowerCase())){
    showToast('That name is already taken');
    return;
  }
  const pin = await appPrompt('Set a 4-digit PIN for ' + n + ':', { title: 'Player PIN', placeholder: '4-digit PIN' });
  if(!pin || !/^\d{4}$/.test(pin.trim())){ showToast('PIN must be 4 digits'); return; }
  const pinHash = await hashPin(pin.trim());
  S.players.push({id: generateId(), name: n, teamIds: [], pinHash});
  saveState();
  render();
  setTimeout(() => document.getElementById("pn")?.focus(), 0);
}

async function removePlayer(id){
  if(!await requireAdmin()) return;
  // ds.order was fixed when the draft started; dropping a player leaves their id in it (a turn nobody can take).
  if(S.ds && S.ds.started){ showToast('The draft has started. Reset the draft before removing a player.'); return; }
  S.players = S.players.filter(p => p.id !== id);
  saveState();
  render();
}

async function movePlayer(i, d){
  if(!await requireAdmin()) return;
  const s = i + d;
  if(s < 0 || s >= S.players.length) return;
  [S.players[i], S.players[s]] = [S.players[s], S.players[i]];
  saveState();
  render();
}

async function addTeam(){
  if(!await requireAdmin()) return;
  const n = document.getElementById("tn").value.trim();
  if(!n) return;
  S.teams.push({id: generateId(), name: n, seed: Number(document.getElementById("ts").value), region: document.getElementById("tr").value});
  saveState();
  render();
  setTimeout(() => document.getElementById("tn")?.focus(), 0);
}

async function parseBulkImport(){
  if(!await requireAdmin()) return;
  const lines = document.getElementById("bt").value.split("\n").filter(l => l.trim());
  let skipped = 0;
  for(const l of lines){
    const m = l.match(/^(.+?)\s*,\s*(\d{1,2})\s*,\s*(\w[\w\s]*?)\s*$/);
    if(m){
      const seed = Number(m[2]);
      if(seed < 1 || seed > 16){ skipped++; continue; }
      const reg = REGIONS.find(r => r.toLowerCase() === m[3].trim().toLowerCase());
      if(!reg){ skipped++; continue; }
      const name = m[1].trim();
      // Skip duplicates (same name+seed+region)
      if(S.teams.some(t => t.name === name && t.seed === seed && t.region === reg)){ skipped++; continue; }
      S.teams.push({id: generateId(), name, seed, region: reg});
    }
  }
  if(skipped > 0) showToast(`${skipped} line(s) skipped (invalid seed, region, or duplicate)`);
  saveState();
  render();
}

/* ── NCAA.com bracket import ── */
async function importFromNCAA(){
  if(!await requireAdmin()) return;
  const locked = teamEditBlockedReason();
  if(locked){ showToast(locked); return; }
  // Year sanity: if S.year is stale (last tournament's year), offer to bump
  const thisYear = tournamentYear();
  if(S.year < thisYear){
    const bump = await appConfirm(`Your tournament year is ${S.year}. Update to ${thisYear} before importing?`, { title: 'Update Tournament Year', confirmLabel: 'Update' });
    if(bump){ S.year = thisYear; saveState(); }
  }
  if(S.teams.length > 0 && !await appConfirm('This will replace all current teams. Continue?', { title: 'Replace Teams', confirmLabel: 'Replace' })) return;

  const btn = document.getElementById('ncaa-import-btn');
  const origText = btn?.textContent;
  if(btn){ btn.textContent = 'Importing...'; btn.disabled = true; }
  showToast('Fetching the bracket from NCAA.com...');

  try {
    const teams = await ncaa.fetchTournamentTeams();
    if(teams.length === 0){
      showToast('Tournament bracket not available yet. Try after Selection Sunday.');
      if(btn){ btn.textContent = origText; btn.disabled = false; }
      return;
    }

    // Sanity check: 4 regions × 16 slots = 64 bracket slots. With play-ins, total team
    // entries should be 64-68. Anything outside that means the bracket feed is partial/stale.
    const slotCount = new Set(teams.map(t => `${escapeHtml(t.seed)}_${escapeHtml(t.region)}`)).size;
    const regionCounts = teams.reduce((acc, t) => { acc[t.region] = (acc[t.region]||0)+1; return acc; }, {});
    const incomplete = slotCount < 64 || Object.values(regionCounts).some(n => n < 16) || REGIONS.some(r => !regionCounts[r]);
    if(incomplete){
      const detail = REGIONS.map(r => `${r}: ${regionCounts[r] || 0}/16`).join(', ');
      const proceed = await appConfirm(`NCAA.com returned an incomplete bracket (${slotCount}/64 slots).\n\n${detail}\n\nImport partial data anyway? (Manual fixup will be needed in Settings.)`, { title: 'Incomplete Bracket', danger: true, confirmLabel: 'Import Anyway' });
      if(!proceed){
        if(btn){ btn.textContent = origText; btn.disabled = false; }
        return;
      }
    }

    S.teams = teams.map(t => ({
      id: generateId(),
      name: t.name,
      seed: t.seed,
      region: t.region,
      logo: '',
      abbr: t.abbr || '',
      ncaaId: t.ncaaId || '',
      color: '',
      record: t.record || '',
      ...(t.playIn ? { playIn: true, playInResolved: false, playInTeams: t.playInTeams } : {})
    }));

    showToast(`Imported ${S.teams.length} teams from NCAA.com!`);
    saveState();
    render();
  } catch(e) {
    console.error('NCAA.com import failed:', e);
    showToast('Import failed. Check your connection and try again.');
    if(btn){ btn.textContent = origText; btn.disabled = false; }
  }
}

/* Settles any "A / B" play-in slot whose First Four game is final (also runs on its own once an hour from the Live tab). */
async function checkPlayIns(){
  if(!await requireAdmin()) return;
  const unresolved = S.teams.filter(t => t.playIn && !t.playInResolved).length;
  if(!unresolved){ showToast('No play-in games left to settle.'); return; }
  showToast('Checking First Four results...');
  try {
    _lastAutoResolve = 0; // the hourly throttle must not swallow an explicit check
    await autoResolvePlayIns();
    const left = S.teams.filter(t => t.playIn && !t.playInResolved).length;
    showToast(left ? `${left} play-in game${left === 1 ? '' : 's'} not final yet.` : 'Play-in slots settled!');
  } catch(e) {
    showToast('Check failed.');
  }
}

/* ── Live Scores Page ── */
function renderLive(c){
  const hasLive = liveScores.some(g => g.state === 'in');
  const now = new Date();
  const todayStr = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const currentDate = S.liveScoresDate || todayStr;
  const displayDate = new Date(+currentDate.slice(0,4), +currentDate.slice(4,6) - 1, +currentDate.slice(6,8)).toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});

  let filtered = liveScores.slice(); // copy: the sort below must not reorder the shared liveScores array
  if(S.liveScoresFilter === 'live') filtered = liveScores.filter(g => g.state === 'in');
  else if(S.liveScoresFilter === 'final') filtered = liveScores.filter(g => g.state === 'post');
  else if(S.liveScoresFilter === 'upcoming') filtered = liveScores.filter(g => g.state === 'pre');

  // Sort: live first, then upcoming, then final
  filtered.sort((a,b) => {
    const order = {in:0, pre:1, post:2};
    return (order[a.state] ?? 1) - (order[b.state] ?? 1);
  });

  // Match live games to our drafted teams
  const teamsByNcaa = {};
  const teamsByAbbr = {};
  const teamsByName = {};
  for(const t of S.teams){
    if(t.ncaaId) teamsByNcaa[t.ncaaId] = t;
    if(t.abbr) teamsByAbbr[t.abbr] = t;
    teamsByName[t.name.toLowerCase()] = t;
  }
  function findOurTeam(scoreTeam){
    const direct = teamsByNcaa[scoreTeam.ncaaId] || teamsByAbbr[scoreTeam.abbr] || teamsByName[scoreTeam.name.toLowerCase()];
    if (direct) return direct;
    // Check unresolved play-in teams
    return S.teams.find(t => t.playIn && !t.playInResolved &&
      t.playInTeams.some(pt => (pt.ncaaId && pt.ncaaId === scoreTeam.ncaaId) || (pt.abbr && pt.abbr === scoreTeam.abbr))
    ) || null;
  }

  const counts = {
    all: liveScores.length,
    live: liveScores.filter(g=>g.state==='in').length,
    upcoming: liveScores.filter(g=>g.state==='pre').length,
    final: liveScores.filter(g=>g.state==='post').length
  };
  const updatedStr = liveLastRefresh ? 'Updated ' + new Date(liveLastRefresh).toLocaleTimeString() : '';

  // Shell is painted once per visit; later refreshes patch the dynamic bits in place
  // so the 30 s poll does not rebuild every card (and reload every logo).
  if(!c.querySelector('#live-grid')){
    _liveCardCache = new Map();
    c.innerHTML = `
    <div class="page-title">Scores<span class="date-nav"><button onclick="changeLiveDate(-1)" title="Previous day">\u2039</button><span id="live-date"></span><button onclick="changeLiveDate(1)" title="Next day">\u203a</button></span></div>
    <p class="live-meta">
      <span id="live-pulse" class="live-pulse" style="display:none"><span class="dot"></span>LIVE</span>
      <button class="text-btn" onclick="S.liveScoresDate='';startLiveRefresh()">Today</button>
      <span id="live-updated"></span>
      <span id="live-error" class="live-error" style="display:none">Scores unavailable, retrying</span>
    </p>
    <div class="live-filter-bar">
      ${['all','live','upcoming','final'].map(k => `<button class="live-filter-btn" data-filter="${k}" onclick="S.liveScoresFilter='${k}';renderLiveInPlace()">${k[0].toUpperCase()+k.slice(1)} (<span id="live-cnt-${k}"></span>)</button>`).join('')}
    </div>
    <div id="live-outage" class="card live-error" style="display:none;text-align:center;padding:40px;color:var(--g400)"><p style="font-size:16px;font-weight:700;margin-bottom:4px">Scores unavailable</p><p style="font-size:13px">Could not reach the scoreboard. Check your connection; this page retries automatically.</p></div>
    <div id="live-empty" class="card" style="display:none;text-align:center;padding:40px;color:var(--g400)"><p style="font-size:16px;font-weight:700;margin-bottom:4px">No games found</p><p style="font-size:13px">Try a different date or check back later.</p></div>
    <div id="live-grid" class="scores-grid"></div>
    <p class="foot">Data from NCAA.com.</p>`;
  }

  c.querySelector('#live-date').textContent = displayDate;
  c.querySelector('#live-pulse').style.display = hasLive ? '' : 'none';
  c.querySelector('#live-updated').textContent = updatedStr;
  for(const k of Object.keys(counts)){
    c.querySelector('#live-cnt-' + k).textContent = counts[k];
    c.querySelector(`.live-filter-btn[data-filter="${k}"]`).classList.toggle('active', S.liveScoresFilter === k);
  }
  // Outage (live-fetch-error): badge in the header whenever the last poll failed; the outage card replaces
  // 'No games found' only when there is nothing on screen at all (an empty filter is about the filter).
  c.querySelector('#live-error').style.display = liveLastError ? '' : 'none';
  const outage = filtered.length === 0 && liveLastError && liveScores.length === 0;
  c.querySelector('#live-outage').style.display = outage ? '' : 'none';
  c.querySelector('#live-empty').style.display = filtered.length === 0 && !outage ? '' : 'none';

  const cardHtml = game => {
        const awayOur = findOurTeam(game.away);
        const homeOur = findOurTeam(game.home);
        const awayOwner = awayOur ? ownerOf(awayOur.id) : null;
        const homeOwner = homeOur ? ownerOf(homeOur.id) : null;
        const myId = getMyPlayerId();
        const ownerTag = pl => pl ? `<span class="own${pl.id === myId ? ' me' : ''}">${playerDot(pl.id)}${escapeHtml(pl.name)}</span>` : '';
        const isLive = game.state === 'in';
        const isFinal = game.state === 'post';
        const isPre = game.state === 'pre';

        const awayWon = isFinal && game.away.winner;
        const homeWon = isFinal && game.home.winner;

        const gameTime = game.date ? new Date(game.date) : null;
        const timeStr = gameTime && !isNaN(gameTime) ? gameTime.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : (game.startTime || 'TBD');

        return `<div class="score-card ${isLive?'live':''} ${isFinal?'final':''}" data-gid="${escapeHtml(game.id)}">
          <div class="score-teams">
            <div class="score-team-row ${awayWon?'winner':''} ${isFinal&&!awayWon?'loser':''}">
              <span class="team-seed">${game.away.seed && game.away.seed <= 16 ? game.away.seed : ''}</span>
              <span class="team-name">${escapeHtml(game.away.name)}</span>${ownerTag(awayOwner)}
              <span class="team-record">${game.away.record || ''}</span>
              <span class="team-score">${game.away.score || (isPre ? '' : '0')}</span>
            </div>
            <div class="score-team-row ${homeWon?'winner':''} ${isFinal&&!homeWon?'loser':''}">
              <span class="team-seed">${game.home.seed && game.home.seed <= 16 ? game.home.seed : ''}</span>
              <span class="team-name">${escapeHtml(game.home.name)}</span>${ownerTag(homeOwner)}
              <span class="team-record">${game.home.record || ''}</span>
              <span class="team-score">${game.home.score || (isPre ? '' : '0')}</span>
            </div>
          </div>
          <div class="score-meta">
            <div class="score-status">${isLive ? 'LIVE \u00b7 ' + escapeHtml(game.shortDetail) : isFinal ? 'Final' : escapeHtml(timeStr)}</div>
            ${game.note ? `<div class="score-note">${escapeHtml(game.note)}</div>` : ''}
            ${game.broadcast ? `<div class="score-broadcast">${escapeHtml(game.broadcast)}</div>` : ''}
            ${game.venue ? `<div class="score-broadcast">${escapeHtml(game.venue)}</div>` : ''}
          </div>
        </div>`;
  };
  patchLiveGrid(c.querySelector('#live-grid'), filtered, cardHtml);
}

let _liveCardCache = new Map(); // game.id -> card HTML as last painted

/* Reuse a card's DOM node when its HTML is unchanged; rebuild only changed cards; keep order. */
function patchLiveGrid(grid, games, cardHtml){
  const existing = new Map();
  for(const el of grid.children) existing.set(el.dataset.gid, el);
  const tpl = document.createElement('template');
  const nodes = games.map(game => {
    const html = cardHtml(game);
    const el = existing.get(game.id);
    if(el && _liveCardCache.get(game.id) === html) return el;
    tpl.innerHTML = html;
    _liveCardCache.set(game.id, html);
    return tpl.content.firstElementChild;
  });
  grid.replaceChildren(...nodes);
}

function renderLiveInPlace(){
  const c = document.getElementById('c');
  if(c) renderLive(c);
}

function changeLiveDate(delta){
  const n = new Date();
  const current = S.liveScoresDate || (n.getFullYear() + String(n.getMonth()+1).padStart(2,'0') + String(n.getDate()).padStart(2,'0'));
  const y = parseInt(current.slice(0,4));
  const m = parseInt(current.slice(4,6)) - 1;
  const d = parseInt(current.slice(6,8));
  const dt = new Date(Date.UTC(y, m, d + delta));
  S.liveScoresDate = dt.getUTCFullYear() +
    String(dt.getUTCMonth() + 1).padStart(2,'0') +
    String(dt.getUTCDate()).padStart(2,'0');
  liveScores = [];
  startLiveRefresh();
}

/* ── Draft Page ── */
function renderDraft(c){
  const ds = S.ds;
  if(!ds.started){
    const canD = S.players.length >= 2 && S.teams.length >= S.players.length;
    const myId = getMyPlayerId();
    const adminIsPlayer = adminUnlocked && myId && S.players.some(p => p.id === myId);
    const adminNotPlayer = adminUnlocked && (!myId || !S.players.some(p => p.id === myId));
    c.innerHTML = `<div class="section-title">Draft Lobby</div><p class="section-desc">${S.players.length} player${S.players.length!==1?'s':''} joined${S.teams.length ? `, ${S.teams.length} teams loaded` : ''}</p>
    ${inviteCardHTML()}
    <div class="card"><span class="label">Players (${S.players.length})</span>
    ${adminUnlocked ? `<div class="row" style="margin-bottom:12px"><input id="pn" placeholder="Player name..." style="flex:1" onkeydown="if(event.key==='Enter')addPlayer()"><button class="btn btn-primary" onclick="addPlayer()">Add</button></div>` : ''}
    ${S.players.length === 0 ? '<p style="color:var(--g400);text-align:center;padding:14px;font-size:13px">No players yet. Share the invite link to get people in.</p>' : ''}
    ${S.players.map((p,i) => `<div class="player-row"><span class="player-num">#${i+1}</span><span style="flex:1;font-weight:${p.id === myId ? '800' : '600'}${p.id === myId ? ';color:var(--gold)' : ''}">${escapeHtml(p.name)}</span>${adminUnlocked ? `<button class="icon-btn" onclick="movePlayer(${i},-1)">\u25B2</button><button class="icon-btn" onclick="movePlayer(${i},1)">\u25BC</button><button class="icon-btn icon-btn-danger" onclick="removePlayer('${p.id}')">\u2715</button>` : ''}</div>`).join('')}
    ${S.players.length >= 2 ? `<p style="color:var(--g400);font-size:12px;margin-top:10px">Snake: ${S.players.map(p => escapeHtml(p.name)).join(' \u2192 ')} \u2192 ${[...S.players].reverse().map(p => escapeHtml(p.name)).join(' \u2192 ')} \u2192 ...</p>` : ''}
    ${adminNotPlayer ? `<div style="border-top:1px solid var(--g200);margin-top:14px;padding-top:14px"><button class="btn btn-secondary" onclick="adminJoinAsPlayer()" style="width:100%;justify-content:center">Join as Player (Commissioner)</button></div>` : ''}
    ${adminIsPlayer ? `<p style="color:var(--g400);font-size:12px;margin-top:10px;text-align:center">You're registered as a player in this draft.</p>` : ''}
    ${adminUnlocked ? `<div style="margin-top:14px"><button class="btn btn-primary" onclick="startDraft()" ${canD ? '' : 'disabled'} style="width:100%;justify-content:center">Start Draft${!canD ? ' (need 2+ players & teams)' : ''}</button></div>` : ''}
    </div>`;
    return;
  }
  const myId = getMyPlayerId();
  if(ds.complete){ renderMyTeams(c, myId); return; }
  const per = S.players.length;
  const all = S.players.flatMap(p => p.teamIds);
  const av = S.teams.filter(t => !all.includes(t.id)).filter(t => S.fr === "All" || t.region === S.fr).filter(t => S.fs === "All" || t.seed === Number(S.fs)).sort((a,b) => a.seed - b.seed || a.name.localeCompare(b.name));
  const cid = ds.order[ds.cp], cp = S.players.find(p => p.id === cid);
  const canPick = adminUnlocked || myId === cid;
  const mine = isMyDraftTurn();
  const myP = myId ? S.players.find(p => p.id === myId) : null;
  const myTeams = myP ? S.teams.filter(t => myP.teamIds.includes(t.id)).sort((a,b) => a.seed - b.seed) : [];
  const pickLabel = k => `${Math.floor(k / per) + 1}.${k % per + 1}`;
  const next = S.players.find(p => p.id === ds.order[ds.cp + 1]);
  const myNext = myId ? ds.order.indexOf(myId, ds.cp) : -1;
  const rosterSize = Math.ceil(ds.order.length / per);
  const hasClock = !!(ds.pickDeadline || ds.timerPaused);
  // Every pick so far, oldest first: pick k belongs to order[k], and is that player's n-th team.
  const log = [], seen = {};
  for(let k = 0; k < ds.cp; k++){
    const pl = S.players.find(p => p.id === ds.order[k]);
    const n = seen[ds.order[k]] = (seen[ds.order[k]] || 0) + 1;
    const t = pl && S.teams.find(x => x.id === pl.teamIds[n - 1]);
    if(t) log.push({k, pl, t});
  }
  const head = mine
    ? `<div class="turnhead"><div class="page-title">Your pick<small>Rd ${pickLabel(ds.cp).replace('.', ' \u00b7 Pick ')}</small></div>
        <div class="clock-row"><div id="draft-timer" class="draft-timer"${hasClock ? '' : ' hidden'}></div><div class="clock-lbl">${next ? `Up next<br><b>${next.id === myId ? 'You again' : playerDot(next.id) + escapeHtml(next.name)}</b>` : 'Last pick'}</div></div></div>`
    : `<div class="page-title"><span>${cp ? playerDot(cp.id) + escapeHtml(cp.name) : ''} is picking</span><small>Rd ${pickLabel(ds.cp).replace('.', ' \u00b7 Pick ')}</small></div>
        <div class="clock-row"><div id="draft-timer" class="draft-timer"${hasClock ? '' : ' hidden'}></div><div class="clock-lbl">${myNext > ds.cp ? `You're up<br><b>${myNext - ds.cp === 1 ? 'next' : 'in ' + (myNext - ds.cp) + ' picks'}</b>` : ''}</div></div>`;
  c.innerHTML = `${head}
  ${myP ? `<div class="slots">${Array.from({length: rosterSize}, (_, i) => `<i class="${i < myTeams.length ? 'f' : ''}"></i>`).join('')}</div>
  <div class="slots-lbl">${myTeams.length}/${rosterSize}${myTeams.length ? ' \u00b7 <b>' + myTeams.map(t => escapeHtml(t.seed + ' ' + teamDisplayName(t))).join(', ') + '</b>' : ''}</div>` : ''}

  <div class="kicker">Available<select class="seed-filter" onchange="S.fs=this.value;render()"><option value="All" ${S.fs==='All'?'selected':''}>${av.length} teams \u00b7 all seeds</option>${SEEDS.map(s => `<option value="${s}" ${String(S.fs)===String(s)?'selected':''}>Seed ${s}</option>`).join('')}</select></div>
  <div class="tabs">${['All', ...REGIONS].map(r => `<button class="${S.fr === r ? 'on' : ''}" onclick="S.fr='${r}';render()">${r}${r !== 'All' && myP ? `<sup>${myTeams.filter(t => t.region === r).length}</sup>` : ''}</button>`).join('')}</div>
  <table class="list">${av.map(t => `<tr${canPick ? ` class="tap" onclick="confirmPick('${t.id}')"` : ''}><td class="sd">${escapeHtml(t.seed)}</td><td><div class="tn">${escapeHtml(teamDisplayName(t))}</div><div class="st">${escapeHtml(t.region)}${teamRecordDisplay(t) ? ' \u00b7 ' + escapeHtml(teamRecordDisplay(t)) : ''}</div></td><td class="num">${canPick ? '<span class="pick-link">Draft</span>' : ''}</td></tr>`).join('')}</table>

  ${log.length ? `<div class="kicker">Recent picks<span>Snake order</span></div>
  <table class="list log">${log.slice(-6).reverse().map(({k, pl, t}, i) => `<tr class="${i === 0 ? 'new' : ''}"><td class="pk">${pickLabel(k)}</td><td><b>${escapeHtml(t.seed)} ${escapeHtml(teamDisplayName(t))}</b></td><td class="num who">${playerDot(pl.id)}${escapeHtml(pl.name)}</td></tr>`).join('')}</table>` : ''}

  <div class="kicker">Rosters<span>${per} players</span></div>
  <table class="list rosters">${S.players.map(p => { const pt = S.teams.filter(t => p.teamIds.includes(t.id)).sort((a,b) => a.seed - b.seed); return `<tr class="${p.id === cid ? 'onclock' : ''}"><td class="who">${playerDot(p.id)}<b>${escapeHtml(p.name)}</b>${p.id === myId ? ' <span class="you">you</span>' : ''}</td><td class="st">${pt.map(t => escapeHtml(t.seed + ' ' + teamDisplayName(t))).join(', ') || '\u2014'}</td></tr>`; }).join('')}</table>

  <div class="admin-row">${ds.timerDuration > 0 && adminUnlocked ? (ds.timerPaused
      ? '<button onclick="resumeDraftClock()">Resume clock</button>'
      : '<button onclick="pauseDraftClock()">Pause clock</button>') : ''}<button onclick="undoDraft()" ${ds.cp === 0 ? 'disabled' : ''}>Undo last pick</button><button class="danger" onclick="resetDraft()">Reset draft</button></div>`;
}

// A pick can't be taken back without the commissioner, so confirm it first.
async function confirmPick(tid){
  const t = S.teams.find(x => x.id === tid);
  if(!t) return;
  const rec = teamRecordDisplay(t);
  // appConfirm escapes its text, so the message is built as plain text.
  const ok = await appConfirm(t.seed + ' seed \u00b7 ' + t.region + (rec ? ' \u00b7 ' + rec : ''), { title: teamDisplayName(t), confirmLabel: 'Draft ' + teamDisplayName(t) });
  if(ok) pickTeam(tid);
}

/* ── My Teams (after the draft) ── */
function renderMyTeams(c, myId){
  const myP = myId ? S.players.find(p => p.id === myId) : null;
  const admin = adminUnlocked ? `<div class="admin-row"><button onclick="undoDraft()" ${S.ds.cp === 0 ? 'disabled' : ''}>Undo last pick</button><button class="danger" onclick="resetDraft()">Reset draft</button></div>` : '';
  if(!myP){
    c.innerHTML = `<div class="page-title">My Teams</div><p class="empty-note">Join as a player to see your teams.</p>${admin}`;
    return;
  }
  const sc = withRanks(scores());
  const me = sc.find(s => s.pid === myId);
  const ahead = sc.filter(s => s.tot > me.tot).pop(); // nearest player above (sc is sorted high to low)
  const behind = sc.find(s => s.tot < me.tot);
  const tied = sc.filter(s => s.tot === me.tot).length > 1;
  const gap = tied ? 'Tied' : ahead ? (ahead.tot - me.tot) + ' back' : behind ? 'Up ' + (me.tot - behind.tot) : '';
  const MEDAL = {1:'Gold', 2:'Silver', 3:'Bronze'};
  const medal = me.rank <= 3 && me.tot > 0;
  const pt = S.teams.filter(t => myP.teamIds.includes(t.id));
  const alive = pt.filter(t => !teamEliminated(t.id));
  const rows = [...alive.sort((a,b) => a.seed - b.seed), ...pt.filter(t => teamEliminated(t.id)).sort((a,b) => a.seed - b.seed)];
  const ord = n => n + (['th','st','nd','rd'][(n % 100 - 20) % 10] || ['th','st','nd','rd'][n % 100] || 'th');
  const mx = Math.max(1, ...Object.values(me.rp));
  const status = t => {
    const lost = (S.games || []).find(g => (g.t1 === t.id || g.t2 === t.id) && g.wid && g.wid !== t.id);
    if(lost) return 'Out \u00b7 ' + ROUND_SHORT[lost.round];
    const nextG = (S.games || []).find(g => (g.t1 === t.id || g.t2 === t.id) && !g.wid);
    return nextG ? RN[nextG.round] : (teamWins(t.id) === 6 ? 'Champion' : 'Alive');
  };
  const dots = w => `<span class="wins">${Array.from({length: 6}, (_, k) => `<i class="${k < w ? 'w' : ''}"></i>`).join('')}</span>`;
  c.innerHTML = `<div class="page-title">My Teams<small>${playerDot(myId)}${escapeHtml(myP.name)}</small></div>
  <div class="figs${medal ? ' m' + me.rank : ''}">
    <div class="fig"><b>${medal ? medalHTML(me.rank, me.tot) : ''}${me.rank}<sup>${ord(me.rank).slice(String(me.rank).length)}</sup></b><span${medal ? ` class="medal-lbl m${me.rank}"` : ''}>${medal ? MEDAL[me.rank] + (gap ? ' \u00b7 ' + gap : '') : (gap || 'Rank')}</span></div>
    <div class="fig"><b>${me.tot}</b><span>Points</span></div>
    <div class="fig"><b class="alive-n">${alive.length}<sup>/${pt.length}</sup></b><span>Alive</span></div>
  </div>
  <div class="chart">${[1,2,3,4,5,6].map(r => `<div>${me.rp[r] || ''}<b class="r${r}${me.rp[r] ? '' : ' z'}" style="height:${me.rp[r] ? Math.max(6, me.rp[r] / mx * 58) : 2}px"></b><span>${ROUND_SHORT[r]}</span></div>`).join('')}</div>
  <div class="kicker">Roster<span>Wins \u00b7 Pts</span></div>
  <table class="list">${rows.map(t => { const out = teamEliminated(t.id); return `<tr class="${out ? 'out' : ''}"><td class="sd">${escapeHtml(t.seed)}</td><td><div class="tn">${escapeHtml(teamDisplayName(t))}</div><div class="st">${escapeHtml(t.region)} \u00b7 ${status(t)}</div></td><td class="num">${dots(teamWins(t.id))}</td><td class="num pts">${teamPoints(t.id) || '\u2014'}</td></tr>`; }).join('')}</table>
  ${admin}`;
}

function _freshDraftState(players, teams, duration){
  return {
    order: snakeOrder(players.map(p => p.id), teams.length),
    cp: 0, started: true, complete: false,
    timerDuration: duration,
    pickDeadline: duration > 0 ? firebase.firestore.Timestamp.fromDate(new Date(serverNow() + duration * 1000)) : null,
    timerPaused: false,
    pausedRemaining: null
  };
}

async function startDraft(){
  if(!await requireAdmin()) return;
  if(S.ds && S.ds.started){ showToast('The draft has already started'); return; }
  const duration = S.draftClockDuration || 0;
  // Room: start transactionally against the server copy, like pickTeam(). A second admin device whose
  // lobby is stale must not overwrite a draft that already has picks with a fresh order and empty rosters.
  if(roomId){
    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("rooms").doc(roomId);
        const snap = await tx.get(ref);
        if(!snap.exists) throw { code: 'no-room', msg: 'Room not found' };
        const remote = JSON.parse(snap.data().state || '{}');
        if(remote.ds && remote.ds.started) throw { code: 'started', msg: 'The draft was already started on another device' };
        const players = remote.players || [], teams = remote.teams || [];
        if(players.length < 2 || teams.length < players.length) throw { code: 'not-ready', msg: 'Need 2+ players and at least one team per player' };
        remote.ds = _freshDraftState(players, teams, duration);
        players.forEach(p => p.teamIds = []);
        tx.update(ref, {
          state: JSON.stringify(remote),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      _beeped = false; // the snapshot listener applies the started draft and render() starts the clock
    } catch(err){
      if(err && err.msg) showToast(err.msg);
      else { console.warn('Start draft failed:', err); showToast('Start failed \u2014 try again'); }
    }
    return;
  }
  _beeped = false;
  S.ds = _freshDraftState(S.players, S.teams, duration);
  S.players.forEach(p => p.teamIds = []);
  if(duration > 0) startDraftClock();
  saveState();
  render();
}

// Transactional pick: atomic read-modify-write on Firestore.
// Eliminates the "two clients pick at once" race that broke the live draft last year.
// Server-state is the source of truth; local S updates via the snapshot listener.
let _pickInFlight = false;
async function pickTeam(tid){
  if(_pickInFlight) return; // ignore re-entrant taps while a pick is settling
  const myId = getMyPlayerId();
  // No-room (solo/offline) mode: simple local mutation
  if(!roomId){
    return _pickTeamLocal(tid, myId);
  }
  _pickInFlight = true;
  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection("rooms").doc(roomId);
      const snap = await tx.get(ref);
      if(!snap.exists) throw { code: 'no-room', msg: 'Room not found' };
      const remote = JSON.parse(snap.data().state || '{}');
      const ds = remote.ds || {};
      if(ds.complete) throw { code: 'complete', msg: 'Draft already complete' };
      if(!ds.started) throw { code: 'not-started', msg: 'Draft has not started' };
      if(!adminUnlocked && myId !== ds.order[ds.cp]){
        throw { code: 'not-turn', msg: "It's not your turn anymore" };
      }
      const taken = (remote.players || []).flatMap(p => p.teamIds || []);
      if(taken.includes(tid)){
        throw { code: 'taken', msg: 'That team was just picked \u2014 choose another' };
      }
      const pl = (remote.players || []).find(p => p.id === ds.order[ds.cp]);
      if(!pl) throw { code: 'no-player', msg: 'Drafting player not found' };
      pl.teamIds = pl.teamIds || [];
      pl.teamIds.push(tid);
      ds.cp++;
      if(ds.cp >= ds.order.length){
        ds.complete = true;
        ds.pickDeadline = null;
      } else if(ds.timerDuration && ds.timerDuration > 0){
        ds.pickDeadline = firebase.firestore.Timestamp.fromDate(new Date(serverNow() + ds.timerDuration * 1000));
        ds.timerPaused = false;
        ds.pausedRemaining = null;
      }
      remote.ds = ds;
      tx.update(ref, {
        state: JSON.stringify(remote),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    _beeped = false;
    updateAppBadge();
  } catch(err){
    if(err && err.msg) showToast(err.msg);
    else { console.warn('Pick transaction failed:', err); showToast('Pick failed \u2014 try again'); }
  } finally {
    _pickInFlight = false;
    replayDroppedSnapshot();
  }
}

function _pickTeamLocal(tid, myId){
  const ds = S.ds;
  if(ds.complete) return;
  _beeped = false;
  if(!adminUnlocked && myId !== ds.order[ds.cp]){ showToast("It's not your turn!"); return; }
  const taken = S.players.flatMap(p => p.teamIds || []);
  if(taken.includes(tid)){ showToast('Team already picked'); return; }
  const pl = S.players.find(p => p.id === ds.order[ds.cp]);
  if(!pl) return;
  pl.teamIds = pl.teamIds || [];
  pl.teamIds.push(tid);
  ds.cp++;
  if(ds.cp >= ds.order.length){
    ds.complete = true;
    ds.pickDeadline = null;
    stopDraftClock();
  } else if(ds.timerDuration && ds.timerDuration > 0){
    ds.pickDeadline = firebase.firestore.Timestamp.fromDate(new Date(serverNow() + ds.timerDuration * 1000));
    ds.timerPaused = false;
    ds.pausedRemaining = null;
  }
  saveState();
  render();
  updateAppBadge();
}

async function undoDraft(){
  if(!await requireAdmin()) return;
  // Multiplayer: do it transactionally so concurrent picks can't sneak past
  if(roomId){
    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("rooms").doc(roomId);
        const snap = await tx.get(ref);
        if(!snap.exists) return;
        const remote = JSON.parse(snap.data().state || '{}');
        const ds = remote.ds || {};
        if(!ds.order || ds.cp === 0) return;
        ds.cp--;
        ds.complete = false;
        const pl = (remote.players || []).find(p => p.id === ds.order[ds.cp]);
        if(pl && pl.teamIds && pl.teamIds.length){ pl.teamIds.pop(); }
        if(ds.timerDuration && ds.timerDuration > 0){
          ds.pickDeadline = firebase.firestore.Timestamp.fromDate(new Date(serverNow() + ds.timerDuration * 1000));
          ds.timerPaused = false;
          ds.pausedRemaining = null;
        }
        remote.ds = ds;
        tx.update(ref, {
          state: JSON.stringify(remote),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      _beeped = false;
    } catch(err){ console.warn('Undo failed:', err); showToast('Undo failed \u2014 try again'); }
    return;
  }
  const ds = S.ds;
  if(ds.cp === 0) return;
  _beeped = false;
  ds.cp--;
  ds.complete = false;
  const pl = S.players.find(p => p.id === ds.order[ds.cp]);
  if(pl) pl.teamIds.pop();
  if(ds.timerDuration && ds.timerDuration > 0){
    ds.pickDeadline = firebase.firestore.Timestamp.fromDate(new Date(serverNow() + ds.timerDuration * 1000));
    ds.timerPaused = false;
    ds.pausedRemaining = null;
  }
  saveState();
  render();
}

async function resetDraft(){
  if(!await requireAdmin()) return;
  if(!await appConfirm("Reset the entire draft? All picks will be lost.", { title: 'Reset Draft', danger: true, confirmLabel: 'Reset' })) return;
  stopDraftClock();
  S.ds = {order:[], cp:0, started:false, complete:false};
  S.players.forEach(p => p.teamIds = []);
  saveState();
  render();
}

/* -- Draft Clock Audio & Haptics -- */
let _audioCtx = null;
let _hapticCheckbox = null;
let _beeped = false; // deadline (ms) the 10 s alert last fired for; false = not yet

function warmupAudio(){
  if(!_audioCtx){
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // iOS Safari parks the context in 'interrupted' (not 'suspended') after a phone call, Siri, or a trip to
  // the home screen; it stays there until resume() is called, so the 10 s beep was silent for the rest of
  // the draft on any iPhone that had switched away. resume() rejects when no gesture has unlocked audio yet.
  if(_audioCtx.state === 'suspended' || _audioCtx.state === 'interrupted'){
    const p = _audioCtx.resume();
    if(p && typeof p.catch === 'function') p.catch(() => {});
  }
}

function playTimerBeep(){
  try {
    warmupAudio();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.frequency.value = 880; // A5 note
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.01, _audioCtx.currentTime + 0.3);
    osc.stop(_audioCtx.currentTime + 0.3);
  } catch(e){
    // Audio silently degrades if AudioContext not available
  }
}

function triggerHaptic(){
  // Android: standard Vibration API
  if(navigator.vibrate){
    navigator.vibrate(50);
    return;
  }
  // iOS Safari 17.4+: hidden checkbox switch trick
  try {
    if(!_hapticCheckbox){
      _hapticCheckbox = document.createElement('input');
      _hapticCheckbox.type = 'checkbox';
      _hapticCheckbox.setAttribute('switch', '');
      _hapticCheckbox.style.cssText = 'position:fixed;top:-100px;opacity:0;pointer-events:none';
      const label = document.createElement('label');
      label.style.cssText = 'position:fixed;top:-100px;opacity:0;pointer-events:none';
      const id = 'haptic-' + Date.now();
      _hapticCheckbox.id = id;
      label.htmlFor = id;
      _hapticCheckbox._label = label;
      document.body.appendChild(_hapticCheckbox);
      document.body.appendChild(label);
    }
    _hapticCheckbox._label.click();
  } catch(e){
    // Haptics silently degrade if not supported
  }
}

/* -- Draft Clock -- */
// A started, unfinished draft with a live (unpaused) deadline needs the clock, whatever tab is showing.
function draftClockShouldRun(ds){
  return !!(ds && ds.started && !ds.complete && ds.pickDeadline && !ds.timerPaused);
}

/* -- Server clock offset --
   Every device counts the pick clock down against its own Date.now(), so a phone whose clock is 40 s fast
   reaches zero 40 s early (and, as the any-tab autopick fallback, picks for the drafter early). Each room
   write carries updatedAt: serverTimestamp(). When a server snapshot arrives whose updatedAt moved while
   this device was listening, that commit happened on the server a snapshot-latency ago, so
   server-now ~= Date.now() + (updatedAt - Date.now()). The first snapshot of a room only sets the baseline
   (its updatedAt may be hours old); own writes calibrate too, through their server-ack snapshot. */
let _serverOffsetMs = 0;
let _serverOffsetRoom = null;
let _serverLastUpdatedAt = null;
const SERVER_OFFSET_MAX_MS = 5 * 60 * 1000;

// Deadlines are written with serverNow() too, so a picker whose own clock is off does not lengthen or shorten their pick.
function serverNow(){ return Date.now() + _serverOffsetMs; }

function noteServerTime(doc){
  if(!doc || !doc.exists || !doc.metadata || doc.metadata.hasPendingWrites || doc.metadata.fromCache) return;
  const data = doc.data();
  const at = data && data.updatedAt && typeof data.updatedAt.toMillis === 'function' ? data.updatedAt.toMillis() : null;
  if(at === null) return;
  if(_serverOffsetRoom !== roomId || _serverLastUpdatedAt === null){
    _serverOffsetRoom = roomId;
    _serverLastUpdatedAt = at;
    return;
  }
  if(at <= _serverLastUpdatedAt) return;
  _serverLastUpdatedAt = at;
  const offset = at - Date.now();
  if(Math.abs(offset) > SERVER_OFFSET_MAX_MS) return;
  _serverOffsetMs = offset;
}

let _draftClockInterval = null;

function startDraftClock(){
  if(_draftClockInterval) return;
  _draftClockInterval = setInterval(updateDraftClock, 250);
}

function stopDraftClock(){
  if(_draftClockInterval){ clearInterval(_draftClockInterval); _draftClockInterval = null; }
}

window.addEventListener('beforeunload', stopDraftClock);

function updateDraftClock(){
  const ds = S.ds;
  if(!ds.pickDeadline || ds.timerPaused || ds.complete){ return; }
  const deadline = ds.pickDeadline.toMillis ? ds.pickDeadline.toMillis() : ds.pickDeadline;
  const remaining = Math.max(0, deadline - serverNow());
  const seconds = Math.ceil(remaining / 1000);

  const el = document.getElementById('draft-timer');
  // The clock ticks 4x a second but the label only changes once a second. Compare against what
  // the element already shows (not a remembered value: render() rebuilds the element empty) so
  // the three in-between ticks touch no DOM and force no style/layout work on phones.
  const text = fmtClock(seconds);
  if(el){
    const cls = 'draft-timer' + (seconds <= 15 ? ' timer-red' : '');
    if(el.textContent !== text) el.textContent = text;
    if(el.className !== cls) el.className = cls;
  }
  const tb = document.querySelector('.js-turn-timer');
  if(tb && tb.textContent !== ' \u00b7 ' + text) tb.textContent = ' \u00b7 ' + text;

  // Audio + haptic alert at 10 seconds, once per pick. Keyed to this pick's deadline rather than a flag:
  // the flag was only cleared by the device that made the pick, so every other device in the room
  // beeped once in the whole draft and then stayed silent.
  if(seconds === 10 && _beeped !== deadline){
    _beeped = deadline;
    playTimerBeep();
    triggerHaptic();
  }

  // Auto-pick on expiry (only active drafter's client, or admin)
  if(remaining === 0){
    stopDraftClock();
    const myId = getMyPlayerId();
    if(myId === ds.order[ds.cp] || adminUnlocked){
      autoPickHighestSeed(ds.pickDeadline && ds.pickDeadline.seconds != null ? ds.pickDeadline.seconds : null);
    }
    // Other clients will receive the pick via Firestore listener
  }
}

/* -- Auto-pick retry --
   updateDraftClock() stops the clock the moment a pick expires and hands off to autoPickHighestSeed(). When that
   transaction throws (phone briefly offline, Firestore contention), nothing on this device ran again until a
   snapshot or a tab change called render(), and no snapshot comes while the pick is unmade: the room stalled.
   Restart the clock after a pause instead. Its next tick sees the deadline still expired and tries the pick
   again; if another device's pick landed meanwhile, render() already moved the deadline and the clock just runs. */
const AUTOPICK_RETRY_MS = 5000;
let _autoPickRetry = null;

function scheduleAutoPickRetry(){
  if(_autoPickRetry) return;
  _autoPickRetry = setTimeout(() => {
    _autoPickRetry = null;
    if(draftClockShouldRun(S.ds)) startDraftClock();
  }, AUTOPICK_RETRY_MS);
}

async function autoPickHighestSeed(expiredDeadlineSeconds){
  _beeped = false;
  const myId = getMyPlayerId();
  // Transactional path for multiplayer: computes highest-available against server state
  if(roomId){
    let pickedName = '';
    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("rooms").doc(roomId);
        const snap = await tx.get(ref);
        if(!snap.exists) return;
        const remote = JSON.parse(snap.data().state || '{}');
        const ds = remote.ds || {};
        if(ds.complete || !ds.started) return;
        // Another client's auto-pick already landed and reset the clock: stand down.
        if(pickDeadlineMoved(expiredDeadlineSeconds, ds.pickDeadline)) return;
        // Only the active drafter (or admin) drives the auto-pick to avoid duplicate fires
        if(!adminUnlocked && myId !== ds.order[ds.cp]) return;
        const taken = new Set((remote.players || []).flatMap(p => p.teamIds || []));
        const available = (remote.teams || []).filter(t => !taken.has(t.id)).sort((a,b) => a.seed - b.seed);
        if(available.length === 0) return;
        const chosen = available[0];
        const pl = (remote.players || []).find(p => p.id === ds.order[ds.cp]);
        if(!pl) return;
        pl.teamIds = pl.teamIds || [];
        pl.teamIds.push(chosen.id);
        ds.cp++;
        if(ds.cp >= ds.order.length){
          ds.complete = true;
          ds.pickDeadline = null;
        } else if(ds.timerDuration && ds.timerDuration > 0){
          ds.pickDeadline = firebase.firestore.Timestamp.fromDate(new Date(serverNow() + ds.timerDuration * 1000));
          ds.timerPaused = false;
        }
        remote.ds = ds;
        tx.update(ref, {
          state: JSON.stringify(remote),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        pickedName = chosen.name || 'Unknown';
      });
      if(pickedName) showToast('Auto-picked: ' + pickedName);
      updateAppBadge();
    } catch(err){
      console.warn('Auto-pick failed:', err);
      scheduleAutoPickRetry();
    }
    return;
  }
  // Local-only fallback
  const ds = S.ds;
  if(ds.complete) return;
  const all = S.players.flatMap(p => p.teamIds || []);
  const available = S.teams.filter(t => !all.includes(t.id)).sort((a,b) => a.seed - b.seed);
  if(available.length === 0) return;
  const tid = available[0].id;
  const pl = S.players.find(p => p.id === ds.order[ds.cp]);
  if(pl){ pl.teamIds = pl.teamIds || []; pl.teamIds.push(tid); }
  ds.cp++;
  if(ds.cp >= ds.order.length){
    ds.complete = true;
    ds.pickDeadline = null;
  } else if(ds.timerDuration && ds.timerDuration > 0){
    ds.pickDeadline = firebase.firestore.Timestamp.fromDate(new Date(serverNow() + ds.timerDuration * 1000));
    ds.timerPaused = false;
  }
  showToast('Auto-picked: ' + (S.teams.find(t => t.id === tid)?.name || 'Unknown'));
  saveState();
  render();
  updateAppBadge();
}

async function pauseDraftClock(){
  if(!await requireAdmin()) return;
  const ds = S.ds;
  if(!ds.pickDeadline) return;
  const deadline = ds.pickDeadline.toMillis ? ds.pickDeadline.toMillis() : ds.pickDeadline;
  const remaining = Math.max(0, deadline - serverNow());
  ds.timerPaused = true;
  ds.pausedRemaining = remaining;
  ds.pickDeadline = null;
  stopDraftClock();
  saveState();
  render();
}

async function resumeDraftClock(){
  if(!await requireAdmin()) return;
  _beeped = false;
  const ds = S.ds;
  if(!ds.timerPaused) return;
  const deadline = new Date(serverNow() + (ds.pausedRemaining || ds.timerDuration * 1000));
  ds.pickDeadline = firebase.firestore.Timestamp.fromDate(deadline);
  ds.timerPaused = false;
  ds.pausedRemaining = null;
  startDraftClock();
  saveState();
  render();
}

async function setDraftClock(seconds){
  if(!await requireAdmin()) return;
  S.draftClockDuration = seconds;
  saveState();
  render();
}

/* ── Bracket Page ── */
function renderBracket(c){
  const reg = S.bracketRegion;
  const _myId = getMyPlayerId();
  const _myP = _myId ? S.players.find(p => p.id === _myId) : null;
  c.innerHTML = `
    <div class="page-title">Bracket</div>
    <div class="tabs">
      ${REGIONS.map(r => `<button class="${reg===r?'on':''}" onclick="S.bracketRegion='${r}';render()">${r}${_myP ? `<sup>${S.teams.filter(t => t.region === r && _myP.teamIds.includes(t.id)).length}</sup>` : ''}</button>`).join('')}
      <button class="${reg==='ff'?'on':''}" onclick="S.bracketRegion='ff';render()">Final Four</button>
    </div>
    <div id="bracket-area"></div>`;
  if(reg === 'ff'){ renderFF(); return; }
  renderRegionBracket(reg);
}

function renderRegionBracket(region){
  const area = document.getElementById("bracket-area");
  const rTeams = S.teams.filter(t => t.region === region);
  if(rTeams.length < 16){
    area.innerHTML = `<div class="card"><p style="color:var(--g400);text-align:center;padding:20px">Need 16 teams in ${region} region to display bracket.</p></div>`;
    return;
  }

  const b = S.bracket[region];
  const rounds = [
    {name:'Round of 64', games:[0,1,2,3,4,5,6,7]},
    {name:'Round of 32', games:[8,9,10,11]},
    {name:'Sweet 16', games:[12,13]},
    {name:'Elite 8', games:[14]}
  ];

  let html = '<div class="bracket-wrap"><div class="bracket">';
  for(let ri = 0; ri < rounds.length; ri++){
    const rd = rounds[ri];
    html += `<div class="round"><div class="round-header">${rd.name}</div>`;
    for(const gi of rd.games){
      const t0 = getTeamForSlot(region, gi, 0);
      const t1 = getTeamForSlot(region, gi, 1);
      const wid = b[gi];
      html += `<div class="gw"><div class="game">`;
      html += slotHTML(region, gi, t0, wid);
      html += slotHTML(region, gi, t1, wid);
      html += `</div></div>`;
    }
    html += `</div>`;
    if(ri < rounds.length - 1){
      const nextGames = rounds[ri+1].games;
      html += `<div class="conn">`;
      html += `<div style="height:27px"></div>`;
      for(let ni = 0; ni < nextGames.length; ni++){
        html += `<div class="conn-pair"><div class="conn-top"></div><div class="conn-bot"></div></div>`;
      }
      html += `</div>`;
    }
  }
  const rwId = b[14];
  const rw = rwId ? S.teams.find(t => t.id === rwId) : null;
  const _rwMyId = getMyPlayerId();
  const _rwMyP = _rwMyId ? S.players.find(p => p.id === _rwMyId) : null;
  const _rwMine = rw && _rwMyP && _rwMyP.teamIds.includes(rw.id);
  html += `<div class="round" style="min-width:120px;justify-content:center"><div class="round-header">Region Winner</div>
    <div class="gw ${_rwMine?'region-winner mine':''}"><div style="text-align:center;padding:12px">
      ${rw ? `${teamLogoHTML(rw, 28) ? `<div style="margin-bottom:4px">${teamLogoHTML(rw, 28)}</div>` : ''}<div style="font-size:11px;color:var(--gold);font-weight:800">${escapeHtml(rw.seed)}</div><div style="font-weight:800;font-size:14px">${escapeHtml(teamDisplayName(rw))}</div><div style="font-size:11px;color:var(--g400)">${escapeHtml(owner(rw.id))}</div>` : '<div style="color:var(--g300);font-size:13px">TBD</div>'}
    </div></div></div>`;
  html += `</div></div>`;
  area.innerHTML = html;
}

function slotHTML(region, gi, team, winnerId){
  if(!team) return `<div class="slot empty"><span class="tn">TBD</span></div>`;
  const isWinner = winnerId === team.id;
  const isLoser = winnerId && winnerId !== team.id;
  const ow = ownerOf(team.id);
  const myId = getMyPlayerId();
  const myPlayer = myId ? S.players.find(p => p.id === myId) : null;
  const isMine = myPlayer && myPlayer.teamIds.includes(team.id);
  return `<div class="slot ${isWinner?'winner':''} ${isLoser?'loser':''} ${isMine?'mine':''}"
    onclick="advanceTeam('${region}',${gi},'${team.id}')"
    oncontextmenu="clearBracketGame('${region}',${gi},event)"
    ontouchstart="startLongPress(()=>clearBracketGame('${region}',${gi}))"
    ontouchend="endLongPress(event)"
    ontouchmove="cancelLongPress()">
    ${teamLogoHTML(team, 16)}<span class="sd">${escapeHtml(team.seed)}</span><span class="tn">${escapeHtml(teamDisplayName(team))}</span>${ow ? `<span class="ow" style="color:${isMine ? 'var(--gold)' : playerColor(ow.id)}">${escapeHtml(ownerCode(ow.name))}</span>` : ''}
  </div>`;
}

function renderFF(){
  const area = document.getElementById("bracket-area");
  const pairs = [[0,1],[2,3]];
  const pairLabels = [`${REGIONS[0]} vs ${REGIONS[1]}`, `${REGIONS[2]} vs ${REGIONS[3]}`];

  const s1t0id = S.bracket[REGIONS[0]][14], s1t1id = S.bracket[REGIONS[1]][14];
  const s2t0id = S.bracket[REGIONS[2]][14], s2t1id = S.bracket[REGIONS[3]][14];
  const s1t0 = s1t0id ? S.teams.find(t => t.id === s1t0id) : null;
  const s1t1 = s1t1id ? S.teams.find(t => t.id === s1t1id) : null;
  const s2t0 = s2t0id ? S.teams.find(t => t.id === s2t0id) : null;
  const s2t1 = s2t1id ? S.teams.find(t => t.id === s2t1id) : null;
  const ff0 = S.bracket.ff[0], ff1 = S.bracket.ff[1], champ = S.bracket.ff[2];

  function ffSlot(team, ffIdx, winnerId){
    if(!team) return `<div class="ff-slot empty">TBD</div>`;
    const isW = winnerId === team.id;
    const isL = winnerId && winnerId !== team.id;
    const _myId = getMyPlayerId();
    const _myP = _myId ? S.players.find(p => p.id === _myId) : null;
    const _isMine = _myP && _myP.teamIds.includes(team.id);
    return `<div class="ff-slot ${isW?'winner':''} ${isL?'loser':''} ${_isMine?'mine':''}"
      onclick="advanceFF(${ffIdx},'${team.id}')"
      oncontextmenu="clearFFGame(${ffIdx},event)"
      ontouchstart="startLongPress(()=>clearFFGame(${ffIdx}))"
      ontouchend="endLongPress(event)"
      ontouchmove="cancelLongPress()">
      ${teamLogoHTML(team, 20)}<span class="sd">${escapeHtml(team.seed)}</span>${escapeHtml(teamDisplayName(team))}<span style="margin-left:auto;font-size:10px;color:var(--g400)">${escapeHtml(owner(team.id))}</span></div>`;
  }

  const ff0t = ff0 ? S.teams.find(t => t.id === ff0) : null;
  const ff1t = ff1 ? S.teams.find(t => t.id === ff1) : null;
  const champt = champ ? S.teams.find(t => t.id === champ) : null;

  area.innerHTML = `
    <div class="ff-bracket">
      <div class="ff-side">
        <div><div style="font-size:11px;font-weight:700;color:var(--g400);margin-bottom:4px;text-transform:uppercase">${pairLabels[0]}</div>
          <div class="ff-game">${ffSlot(s1t0, 0, ff0)}${ffSlot(s1t1, 0, ff0)}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:var(--g400);margin-bottom:4px;text-transform:uppercase">${pairLabels[1]}</div>
          <div class="ff-game">${ffSlot(s2t0, 1, ff1)}${ffSlot(s2t1, 1, ff1)}</div></div>
      </div>
      <div class="ff-conn"></div>
      <div class="ff-center">
        <div style="font-size:11px;font-weight:700;color:var(--g400);text-transform:uppercase;margin-bottom:4px">Championship</div>
        <div class="ff-game" style="min-width:170px">
          ${ff0t ? `<div class="ff-slot ${champ===ff0?'winner':''} ${champ&&champ!==ff0?'loser':''}"
            onclick="advanceFF(2,'${ff0}')"
            oncontextmenu="clearFFGame(2,event)"
            ontouchstart="startLongPress(()=>clearFFGame(2))"
            ontouchend="endLongPress(event)"
            ontouchmove="cancelLongPress()">
            <span class="sd">${ff0t.seed}</span>${escapeHtml(teamDisplayName(ff0t))}</div>` : '<div class="ff-slot empty">TBD</div>'}
          ${ff1t ? `<div class="ff-slot ${champ===ff1?'winner':''} ${champ&&champ!==ff1?'loser':''}"
            onclick="advanceFF(2,'${ff1}')"
            oncontextmenu="clearFFGame(2,event)"
            ontouchstart="startLongPress(()=>clearFFGame(2))"
            ontouchend="endLongPress(event)"
            ontouchmove="cancelLongPress()">
            <span class="sd">${ff1t.seed}</span>${escapeHtml(teamDisplayName(ff1t))}</div>` : '<div class="ff-slot empty">TBD</div>'}
        </div>
        <div class="champ-box">
          <div class="champ-label">Champion</div>
          ${champt ? `${teamLogoHTML(champt, 32) ? `<div style="margin-bottom:4px">${teamLogoHTML(champt, 32)}</div>` : ''}<div class="champ-team">${seedBadge(champt.seed)} ${escapeHtml(teamDisplayName(champt))}</div><div class="champ-owner">${escapeHtml(owner(champt.id))}</div>` : '<div class="champ-team" style="color:var(--g300)">TBD</div>'}
        </div>
      </div>
    </div>
    `;
}

/* ── Standings Page ── */
function renderLeaderboard(c){
  const sc = withRanks(scores());
  const myId = getMyPlayerId();
  const rosterSize = S.players.length ? Math.max(1, ...S.players.map(p => p.teamIds.length)) : 0;
  const aliveCount = pid => { const p = S.players.find(p => p.id === pid); return p ? p.teamIds.filter(tid => !teamEliminated(tid)).length : 0; };
  c.innerHTML = `<div class="page-title">Standings<button class="text-btn" onclick="shareLeaderboard()">Share</button></div>
  <div class="kicker">Points<span>Alive \u00b7 Pts</span></div>
  <table class="list stand">${sc.map(s => `<tr class="${s.pid === myId ? 'me' : ''}"><td class="rk">${medalHTML(s.rank, s.tot)}</td>
    <td class="who">${playerDot(s.pid)}<b>${escapeHtml(s.name)}</b>${s.pid === myId ? ' <span class="you">you</span>' : ''}</td>
    <td class="num"><span class="alive-dots">${Array.from({length: Math.min(rosterSize, 16)}, (_, k) => `<i class="${k < aliveCount(s.pid) ? 'a' : ''}"></i>`).join('')}</span></td>
    <td class="num tot">${s.tot}</td></tr>`).join('')}</table>
  <div class="kicker">By round<span></span></div>
  <table class="list byround"><tr><th></th><th>Player</th>${[1,2,3,4,5,6].map(r => `<th class="num">${ROUND_SHORT[r]}</th>`).join('')}</tr>
    ${sc.map(s => `<tr class="${s.pid === myId ? 'me' : ''}"><td class="rk">${medalHTML(s.rank, s.tot)}</td><td><b>${escapeHtml(s.name)}</b></td>${[1,2,3,4,5,6].map(r => `<td class="num${s.rp[r] ? '' : ' z'}">${s.rp[r] || '\u2014'}</td>`).join('')}</tr>`).join('')}</table>
  <p class="foot">Scoring: ${[1,2,3,4,5,6].map(r => `${ROUND_SHORT[r]} ${S.rp[r]}`).join(' \u00b7 ')}${S.ub ? ' \u00b7 upset bonus = seed difference' : ''}</p>`;
}

/* ── Settings Page ── */
function renderSettings(c){
  const pr = {doubling:{1:1,2:2,3:4,4:8,5:16,6:32}, linear:{1:1,2:2,3:3,4:4,5:5,6:6}, backLoaded:{1:1,2:2,3:4,4:8,5:20,6:40}, flat:{1:1,2:1,3:1,4:1,5:1,6:1}};
  const isP = k => JSON.stringify(S.rp) === JSON.stringify(pr[k]);
  c.innerHTML = `<div class="section-title">Scoring Settings</div><p class="section-desc">Customize point values. Changes apply immediately.</p>
  <div class="card" style="margin-bottom:14px"><span class="label">Presets</span>
    <div class="row" style="flex-wrap:wrap;margin-bottom:16px;gap:6px">
      <button class="preset-btn ${isP('doubling')?'active':''}" onclick="setPreset('doubling')">Doubling (1,2,4,8,16,32)</button>
      <button class="preset-btn ${isP('linear')?'active':''}" onclick="setPreset('linear')">Linear (1,2,3,4,5,6)</button>
      <button class="preset-btn ${isP('backLoaded')?'active':''}" onclick="setPreset('backLoaded')">Back-loaded (1,2,4,8,20,40)</button>
      <button class="preset-btn ${isP('flat')?'active':''}" onclick="setPreset('flat')">Flat (1 per round)</button></div>
    <span class="label">Points Per Round</span>
    <div class="grid-3">${[1,2,3,4,5,6].map(r => `<div><div style="font-size:12px;color:var(--g500);margin-bottom:4px">${RN[r]}</div><input type="number" value="${S.rp[r]}" style="width:100%" onchange="changeScoring(${r},this.value)"></div>`).join('')}</div></div>
  <div class="card" style="margin-bottom:14px"><div class="row" style="justify-content:space-between"><div><div style="font-weight:700;margin-bottom:4px">Upset Bonus</div><div style="font-size:13px;color:var(--g500)">Upsets award bonus = seed difference (e.g. 12 beats 5 = +7).</div></div>
    <button class="toggle ${S.ub?'on':'off'}" onclick="toggleUpsetBonus()"><span class="toggle-knob"></span></button></div></div>
  <div class="card"><span class="label">Preview</span><p style="font-size:13px;color:var(--g500);line-height:1.7">12-seed beats 5-seed in R64: Base <strong style="color:var(--gold)">${S.rp[1]}</strong>${S.ub ? ' + Upset <strong style="color:var(--gold)">7</strong>' : ''} = <strong>${S.rp[1]+(S.ub?7:0)} pts</strong></p></div>
  ${inviteCardHTML()}
  ${roomId ? `<div class="card" style="margin-bottom:14px"><span class="label">Admin Access</span>
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><div style="font-weight:700;margin-bottom:4px">${adminUnlocked?'Unlocked':'Locked'}</div>
        <div style="font-size:13px;color:var(--g500)">${adminUnlocked?'You can edit players, teams, draft, and scoring.':'Enter PIN to make changes.'}</div></div>
      ${adminUnlocked ? `<button class="btn btn-secondary btn-sm" onclick="lockAdmin()">Lock</button>` : `<button class="btn btn-primary btn-sm" onclick="requireAdmin().then(ok=>{if(ok)render()})">Unlock</button>`}
    </div></div>` : ''}
  <div class="card" style="margin-bottom:14px"><span class="label">Draft Clock</span>
    <p style="font-size:13px;color:var(--g500);margin-bottom:10px">Time limit per pick. Auto-picks highest seed when time expires.</p>
    <div class="row" style="flex-wrap:wrap;gap:6px">
      ${[{v:0,l:'No Limit'},{v:60,l:'60s'},{v:90,l:'90s'},{v:120,l:'120s'}].map(o =>
        `<button class="preset-btn ${(S.draftClockDuration||0)===o.v?'active':''}" onclick="setDraftClock(${o.v})">${o.l}</button>`
      ).join('')}
    </div>
  </div>
  <div class="card" style="margin-bottom:14px"><span class="label">Team Management</span>
    <p style="font-size:13px;color:var(--g500);margin-bottom:12px">Import or add tournament teams (${S.teams.length}/64 loaded).</p>
    ${S.teams.length === 0 ? `
      <div class="import-card" onclick="importFromNCAA()" id="ncaa-import">
        <h3>Import from NCAA.com</h3>
        <p>Auto-import all 64 tournament teams with seeds and regions from the official NCAA.com bracket.</p>
        <button class="btn btn-primary" id="ncaa-import-btn">Import ${S.year} Tournament Teams</button>
      </div>` : `
      <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="ncaa-import-btn" onclick="importFromNCAA()">Re-Import from NCAA.com</button>
        <button class="btn btn-secondary btn-sm" onclick="checkPlayIns()">Check Play-in Results</button>
      </div>`}
    <div style="margin-bottom:14px"><span class="label">Bulk Import (Team, Seed, Region per line)</span>
      <textarea id="bt" rows="4" placeholder="Duke, 1, East\nAuburn, 1, South" style="width:100%"></textarea>
      <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="parseBulkImport()">Import</button></div>
    <div style="border-top:1px solid var(--g200);padding-top:14px"><span class="label">Add Single Team</span>
      <div class="row" style="align-items:end;gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px"><span class="label" style="font-size:11px">Team Name</span><input id="tn" placeholder="e.g. Duke" style="width:100%" onkeydown="if(event.key==='Enter')addTeam()"></div>
        <div style="width:75px"><span class="label" style="font-size:11px">Seed</span><select id="ts" style="width:100%">${SEEDS.map(s => `<option value="${s}">#${s}</option>`).join('')}</select></div>
        <div style="width:110px"><span class="label" style="font-size:11px">Region</span><select id="tr" style="width:100%">${REGIONS.map(r => `<option value="${r}">${r}</option>`).join('')}</select></div>
        <button class="btn btn-primary" onclick="addTeam()">Add</button></div></div>
    ${S.teams.length > 0 ? `<div style="border-top:1px solid var(--g200);margin-top:14px;padding-top:14px;text-align:right"><button class="btn btn-danger btn-sm" onclick="clearAllTeams()">Clear All Teams</button></div>` : ''}</div>
  <div class="card" style="margin-bottom:14px"><div class="row" style="justify-content:space-between;align-items:center"><div><div style="font-weight:700;margin-bottom:4px">Year</div><div style="font-size:13px;color:var(--g500)">Auto-detected: ${S.year}</div></div>
    <input type="number" value="${S.year}" style="width:90px" onchange="changeYear(this.value)"></div></div>
  <div class="card" style="border-color:var(--red)"><span class="label" style="color:var(--red)">Danger Zone</span>
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><div style="font-weight:700;margin-bottom:4px">New Tournament</div><div style="font-size:13px;color:var(--g500)">Delete this room and start fresh.</div></div>
      <button class="btn btn-danger btn-sm" onclick="resetAll()">New Tournament</button>
    </div></div>`;
}

async function changeYear(v){
  if(!await requireAdmin()) return;
  S.year = Number(v) || tournamentYear();
  saveState();
  render();
}

async function clearAllTeams(){
  if(!await requireAdmin()) return;
  const locked = teamEditBlockedReason();
  if(locked){ showToast(locked); return; }
  if(!await appConfirm('Clear all teams?', { title: 'Clear Teams', danger: true, confirmLabel: 'Clear All' })) return;
  S.teams = [];
  saveState();
  render();
}

async function changeScoring(r, v){
  if(!await requireAdmin()) return;
  S.rp[r] = Number(v) || 0;
  saveState();
  render();
}

async function toggleUpsetBonus(){
  if(!await requireAdmin()) return;
  S.ub = !S.ub;
  saveState();
  render();
}

async function setPreset(k){
  if(!await requireAdmin()) return;
  const pr = {doubling:{1:1,2:2,3:4,4:8,5:16,6:32}, linear:{1:1,2:2,3:3,4:4,5:5,6:6}, backLoaded:{1:1,2:2,3:4,4:8,5:20,6:40}, flat:{1:1,2:1,3:1,4:1,5:1,6:1}};
  S.rp = {...pr[k]};
  saveState();
  render();
}

