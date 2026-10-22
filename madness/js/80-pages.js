/* ── Bottom Nav ── */
function bottomNavHTML(_, canT) {
  const tabs = [
    { id: 'draft', label: 'Draft', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' },
    { id: 'bracket', label: 'Bracket', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h4v4H3z"/><path d="M3 16h4v4H3z"/><path d="M17 10h4v4H17z"/><path d="M7 6h4v0"/><path d="M7 18h4v0"/><path d="M11 6v12"/><path d="M11 12h6"/></svg>' },
    { id: 'leaderboard', label: 'Leaderboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>' },
    { id: 'live', label: 'Scores', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M6 8h2"/><path d="M16 8h2"/><path d="M6 16h2"/><path d="M16 16h2"/></svg>' }
  ];
  return `<nav class="bottom-nav">${tabs.map(t =>
    `<button class="bottom-nav-btn ${S.phase===t.id?'active':''}" ${t.disabled?'disabled':''} onclick="navigate('${t.id}')">${t.icon}<span>${t.label}</span></button>`
  ).join('')}</nav>`;
}

/* ── Go Home (back to lobby) ── */
function goHome() {
  stopLiveRefresh();
  if(unsubRoom) { unsubRoom(); unsubRoom = null; }
  roomId = null;
  const url = new URL(window.location);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
  renderLobby();
}

/* ── Main Render ── */
function render(){
  try {
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
  app.innerHTML = `
    <div class="header">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="settings-gear" onclick="goHome()" title="Back to Lobby"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></button>
        <div><h1><span>March Madness</span> Draft</h1><div class="header-sub">${(() => { const _hMyId = getMyPlayerId(); const _hMyP = _hMyId ? S.players.find(p => p.id === _hMyId) : null; if(_hMyP){ const myTids = _hMyP.teamIds || []; const alive = myTids.filter(tid => !(S.games||[]).some(g => (g.t1===tid||g.t2===tid) && g.wid && g.wid!==tid)).length; return 'Team ' + escapeHtml(_hMyP.name) + ' \u2014 ' + alive + '/' + myTids.length + ' alive'; } return S.players.length + ' player' + (S.players.length!==1?'s':''); })()}${roomId ? ` \u00b7 <span class="room-badge" onclick="shareRoomLink()" title="Share room link"><span class="sync-dot"></span>${roomId}</span>` : ''}${!isOnline ? ' <span class="offline-badge">Offline</span>' : ''}</div></div>
      </div>
      <button class="settings-gear" onclick="openSettings()" title="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></button>
    </div>
    <nav class="top-nav">
      <button class="${S.phase==='draft'?'active':''}" onclick="navigate('draft')">Draft</button>
      <button class="${S.phase==='bracket'?'active':''}" onclick="navigate('bracket')">Bracket</button>
      <button class="${S.phase==='leaderboard'?'active':''}" onclick="navigate('leaderboard')">Leaderboard</button>
      <button class="${S.phase==='live'?'active':''}" onclick="navigate('live')">Live Scores</button>
      <button class="${S.phase==='settings'?'active':''}" onclick="openSettings()">Settings</button>
    </nav>
    <div class="content-scroll">
      <div id="c"></div>
      <div class="footer"><strong>Scoring:</strong> ${Object.entries(S.rp).map(([r,p]) => `${RN[r]}=${p}pt${p!==1?'s':''}`).join(' \u00b7 ')}${S.ub ? ' \u00b7 Upset bonus=seed diff' : ''}</div>
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
      const secs = Math.ceil(S.ds.pausedRemaining / 1000);
      el.textContent = secs + 's (paused)';
      el.className = 'draft-timer ' + (secs > 30 ? 'timer-green' : secs > 10 ? 'timer-yellow' : 'timer-red');
    }
  }
  repositionInstallBanner();
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
  if (p === 'live') { startLiveRefresh(); requestWakeLock(); }
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
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  const shareUrl = url.toString();
  const shareData = {
    title: 'March Madness Draft',
    text: 'Join my March Madness bracket pool! Room: ' + roomId,
    url: shareUrl
  };
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
    showToast('Room link copied!');
  } catch {
    showToast('Link: ' + shareUrl);
  }
}

async function shareLeaderboard() {
  const sc = scores();
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  let text = 'March Madness Draft ' + S.year + ' - Leaderboard\n\n';
  sc.forEach((s, i) => {
    const prefix = medals[i] || (i + 1) + '.';
    text += prefix + ' ' + s.name + ' - ' + s.tot + ' pts\n';
  });
  const shareData = { title: 'March Madness Leaderboard', text: text };
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
    db.collection("rooms").doc(roomId).update({
      state: JSON.stringify(shared),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
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

async function deleteTeam(id){
  if(!await requireAdmin()) return;
  S.teams = S.teams.filter(t => t.id !== id);
  saveState();
  render();
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

/* ── ESPN Import ── */
async function importFromESPN(){
  if(!await requireAdmin()) return;
  // Year sanity: if S.year is stale (last tournament's year), offer to bump
  const thisYear = new Date().getFullYear();
  if(S.year < thisYear){
    const bump = await appConfirm(`Your tournament year is ${S.year}. Update to ${thisYear} before importing?`, { title: 'Update Tournament Year', confirmLabel: 'Update' });
    if(bump){ S.year = thisYear; saveState(); }
  }
  if(S.teams.length > 0 && !await appConfirm('This will replace all current teams. Continue?', { title: 'Replace Teams', confirmLabel: 'Replace' })) return;

  const btn = document.getElementById('espn-import-btn');
  const origText = btn?.textContent;
  if(btn){ btn.textContent = 'Importing...'; btn.disabled = true; }
  showToast('Fetching tournament teams from ESPN...');

  try {
    const teams = await espn.fetchTournamentTeams();
    if(teams.length === 0){
      showToast('Tournament bracket not available yet. Try after Selection Sunday.');
      if(btn){ btn.textContent = origText; btn.disabled = false; }
      return;
    }

    // Sanity check: 4 regions × 16 slots = 64 bracket slots. With play-ins, total team
    // entries should be 64-68. Anything outside that means ESPN data is partial/stale.
    const slotCount = new Set(teams.map(t => `${t.seed}_${t.region}`)).size;
    const regionCounts = teams.reduce((acc, t) => { acc[t.region] = (acc[t.region]||0)+1; return acc; }, {});
    const incomplete = slotCount < 64 || Object.values(regionCounts).some(n => n < 16) || REGIONS.some(r => !regionCounts[r]);
    if(incomplete){
      const detail = REGIONS.map(r => `${r}: ${regionCounts[r] || 0}/16`).join(', ');
      const proceed = await appConfirm(`ESPN returned an incomplete bracket (${slotCount}/64 slots).\n\n${detail}\n\nImport partial data anyway? (Manual fixup will be needed in Settings.)`, { title: 'Incomplete Bracket', danger: true, confirmLabel: 'Import Anyway' });
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
      logo: t.logo,
      abbr: t.abbr,
      espnId: t.espnId,
      color: t.color,
      record: t.record,
      ...(t.playIn ? { playIn: true, playInResolved: false, playInTeams: t.playInTeams } : {})
    }));

    showToast(`Imported ${S.teams.length} teams from ESPN!`);
    saveState();
    render();
  } catch(e) {
    console.error('ESPN import failed:', e);
    showToast('Import failed. Check your connection and try again.');
    if(btn){ btn.textContent = origText; btn.disabled = false; }
  }
}

async function refreshTeamData(){
  if(!await requireAdmin()) return;
  showToast('Refreshing team data...');
  try {
    // Refresh from ESPN scoreboard for latest records
    const data = await espn.fetchScoreboard();
    const espnTeams = {};
    if(data){
      for(const ev of (data.events || [])){
        const comp = ev.competitions?.[0];
        if(!comp) continue;
        for(const c of (comp.competitors || [])){
          const t = c.team || {};
          espnTeams[t.abbreviation] = {
            logo: t.logo || '',
            record: c.records?.[0]?.summary || ''
          };
        }
      }
    }

    for(const team of S.teams){
      const espnData = espnTeams[team.abbr];
      if(espnData){
        if(espnData.logo) team.logo = espnData.logo;
        if(espnData.record) team.record = espnData.record;
      }
    }
    await autoResolvePlayIns();
    showToast('Team data refreshed!');
    saveState();
    render();
  } catch(e) {
    showToast('Refresh failed.');
  }
}

/* ── Live Scores Page ── */
function renderLive(c){
  const hasLive = liveScores.some(g => g.state === 'in');
  const now = new Date();
  const todayStr = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const currentDate = S.liveScoresDate || todayStr;
  const displayDate = currentDate.replace(/(\d{4})(\d{2})(\d{2})/, '$2/$3/$1');

  let filtered = liveScores;
  if(S.liveScoresFilter === 'live') filtered = liveScores.filter(g => g.state === 'in');
  else if(S.liveScoresFilter === 'final') filtered = liveScores.filter(g => g.state === 'post');
  else if(S.liveScoresFilter === 'upcoming') filtered = liveScores.filter(g => g.state === 'pre');

  // Sort: live first, then upcoming, then final
  filtered.sort((a,b) => {
    const order = {in:0, pre:1, post:2};
    return (order[a.state] ?? 1) - (order[b.state] ?? 1);
  });

  // Match live games to our drafted teams
  const teamsByEspn = {};
  const teamsByAbbr = {};
  const teamsByName = {};
  for(const t of S.teams){
    if(t.espnId) teamsByEspn[t.espnId] = t;
    if(t.abbr) teamsByAbbr[t.abbr] = t;
    teamsByName[t.name.toLowerCase()] = t;
  }
  function findOurTeam(scoreTeam){
    const direct = teamsByEspn[scoreTeam.espnId] || teamsByAbbr[scoreTeam.abbr] || teamsByName[scoreTeam.name.toLowerCase()];
    if (direct) return direct;
    // Check unresolved play-in teams
    return S.teams.find(t => t.playIn && !t.playInResolved &&
      t.playInTeams.some(pt => pt.espnId === scoreTeam.espnId || pt.abbr === scoreTeam.abbr)
    ) || null;
  }

  c.innerHTML = `
    <div class="live-header">
      <div>
        <div class="section-title">Live Scores</div>
        <p class="section-desc" style="margin-bottom:0">
          ${displayDate}
          ${hasLive ? ' <span class="live-pulse"><span class="dot"></span>LIVE</span>' : ''}
          ${liveLastRefresh ? ` <span style="font-size:11px;color:var(--g400)">Updated ${new Date(liveLastRefresh).toLocaleTimeString()}</span>` : ''}
        </p>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn btn-secondary btn-sm" onclick="changeLiveDate(-1)">Prev Day</button>
        <button class="btn btn-secondary btn-sm" onclick="S.liveScoresDate='';startLiveRefresh()">Today</button>
        <button class="btn btn-secondary btn-sm" onclick="changeLiveDate(1)">Next Day</button>
        <button class="btn btn-secondary btn-sm" onclick="refreshLiveScores()" title="Refresh now">Refresh</button>
      </div>
    </div>
    <div class="live-filter-bar">
      <button class="live-filter-btn ${S.liveScoresFilter==='all'?'active':''}" onclick="S.liveScoresFilter='all';renderLiveInPlace()">All (${liveScores.length})</button>
      <button class="live-filter-btn ${S.liveScoresFilter==='live'?'active':''}" onclick="S.liveScoresFilter='live';renderLiveInPlace()">Live (${liveScores.filter(g=>g.state==='in').length})</button>
      <button class="live-filter-btn ${S.liveScoresFilter==='upcoming'?'active':''}" onclick="S.liveScoresFilter='upcoming';renderLiveInPlace()">Upcoming (${liveScores.filter(g=>g.state==='pre').length})</button>
      <button class="live-filter-btn ${S.liveScoresFilter==='final'?'active':''}" onclick="S.liveScoresFilter='final';renderLiveInPlace()">Final (${liveScores.filter(g=>g.state==='post').length})</button>
    </div>
    ${filtered.length === 0 ? '<div class="card" style="text-align:center;padding:40px;color:var(--g400)"><p style="font-size:16px;font-weight:700;margin-bottom:4px">No games found</p><p style="font-size:13px">Try a different date or check back later.</p></div>' : ''}
    <div class="scores-grid">
      ${filtered.map(game => {
        const awayOur = findOurTeam(game.away);
        const homeOur = findOurTeam(game.home);
        const awayOwner = awayOur ? owner(awayOur.id) : '';
        const homeOwner = homeOur ? owner(homeOur.id) : '';
        const isLive = game.state === 'in';
        const isFinal = game.state === 'post';
        const isPre = game.state === 'pre';

        const awayWon = isFinal && game.away.winner;
        const homeWon = isFinal && game.home.winner;

        const gameTime = new Date(game.date);
        const timeStr = gameTime.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});

        return `<div class="score-card ${isLive?'live':''} ${isFinal?'final':''}">
          <div class="score-teams">
            <div class="score-team-row ${awayWon?'winner':''} ${isFinal&&!awayWon?'loser':''}">
              ${game.away.logo ? `<img src="${game.away.logo}" alt="">` : '<span style="width:24px"></span>'}
              <span class="team-seed">${game.away.seed && game.away.seed <= 16 ? game.away.seed : ''}</span>
              <span class="team-name">${escapeHtml(game.away.name)}${awayOwner ? ` <span style="font-size:10px;color:var(--gold);font-weight:700">(${escapeHtml(awayOwner)})</span>` : ''}</span>
              <span class="team-record">${game.away.record || ''}</span>
              <span class="team-score">${game.away.score || (isPre ? '' : '0')}</span>
            </div>
            <div class="score-team-row ${homeWon?'winner':''} ${isFinal&&!homeWon?'loser':''}">
              ${game.home.logo ? `<img src="${game.home.logo}" alt="">` : '<span style="width:24px"></span>'}
              <span class="team-seed">${game.home.seed && game.home.seed <= 16 ? game.home.seed : ''}</span>
              <span class="team-name">${escapeHtml(game.home.name)}${homeOwner ? ` <span style="font-size:10px;color:var(--gold);font-weight:700">(${escapeHtml(homeOwner)})</span>` : ''}</span>
              <span class="team-record">${game.home.record || ''}</span>
              <span class="team-score">${game.home.score || (isPre ? '' : '0')}</span>
            </div>
          </div>
          <div class="score-meta">
            <div class="score-status" style="${isFinal?'color:var(--red)':isLive?'color:var(--green)':'color:var(--g500)'}">${isLive ? game.shortDetail : isFinal ? 'FINAL' : timeStr}</div>
            ${game.note ? `<div class="score-note">${escapeHtml(game.note.replace("Men's Basketball Championship - ",''))}</div>` : ''}
            ${game.broadcast ? `<div class="score-broadcast">${escapeHtml(game.broadcast)}</div>` : ''}
            ${game.venue ? `<div class="score-broadcast">${escapeHtml(game.venue)}</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:16px;text-align:center;font-size:11px;color:var(--g400)">
      Scores refresh automatically every 30 seconds. Data from ESPN.
    </div>`;
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
    <div class="card"><span class="label">Players (${S.players.length})</span>
    ${adminUnlocked ? `<div class="row" style="margin-bottom:12px"><input id="pn" placeholder="Player name..." style="flex:1" onkeydown="if(event.key==='Enter')addPlayer()"><button class="btn btn-primary" onclick="addPlayer()">Add</button></div>` : ''}
    ${S.players.length === 0 ? '<p style="color:var(--g400);text-align:center;padding:14px;font-size:13px">No players yet. Waiting for the commissioner to add players.</p>' : ''}
    ${S.players.map((p,i) => `<div class="player-row"><span class="player-num">#${i+1}</span><span style="flex:1;font-weight:${p.id === myId ? '800' : '600'}${p.id === myId ? ';color:var(--gold)' : ''}">${escapeHtml(p.name)}</span>${adminUnlocked ? `<button class="icon-btn" onclick="movePlayer(${i},-1)">\u25B2</button><button class="icon-btn" onclick="movePlayer(${i},1)">\u25BC</button><button class="icon-btn icon-btn-danger" onclick="removePlayer('${p.id}')">\u2715</button>` : ''}</div>`).join('')}
    ${S.players.length >= 2 ? `<p style="color:var(--g400);font-size:12px;margin-top:10px">Snake: ${S.players.map(p => p.name).join(' \u2192 ')} \u2192 ${[...S.players].reverse().map(p => p.name).join(' \u2192 ')} \u2192 ...</p>` : ''}
    ${adminNotPlayer ? `<div style="border-top:1px solid var(--g200);margin-top:14px;padding-top:14px"><button class="btn btn-secondary" onclick="adminJoinAsPlayer()" style="width:100%;justify-content:center">Join as Player (Commissioner)</button></div>` : ''}
    ${adminIsPlayer ? `<p style="color:var(--g400);font-size:12px;margin-top:10px;text-align:center">You're registered as a player in this draft.</p>` : ''}
    ${adminUnlocked ? `<div style="margin-top:14px"><button class="btn btn-primary" onclick="startDraft()" ${canD ? '' : 'disabled'} style="width:100%;justify-content:center">Start Draft${!canD ? ' (need 2+ players & teams)' : ''}</button></div>` : ''}
    </div>`;
    return;
  }
  const myId = getMyPlayerId();
  // After draft is complete, show only the player's own roster
  if(ds.complete){
    const myP = myId ? S.players.find(p => p.id === myId) : null;
    const pt = myP ? S.teams.filter(t => myP.teamIds.includes(t.id)).sort((a,b) => a.seed - b.seed) : [];
    c.innerHTML = `<div class="section-title">Your Team</div>
    ${myP ? `<div class="card"><span class="label">Team ${escapeHtml(myP.name)} (${pt.length} teams)</span>
      ${pt.map(t => { const w = (S.games||[]).filter(g => g.wid===t.id).length; const el = (S.games||[]).some(g => (g.t1===t.id||g.t2===t.id) && g.wid && g.wid!==t.id); return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--g100)">${teamLogoHTML(t, 24)}${seedBadge(t.seed)}<div style="flex:1"><div style="font-weight:600">${escapeHtml(teamDisplayName(t))}</div><div style="font-size:11px;color:var(--g400)">${t.region}</div></div><div style="text-align:right">${el ? '<span style="color:var(--red);font-weight:700">Eliminated</span>' : `<span style="color:var(--green);font-weight:700">${w > 0 ? w + 'W' : 'Alive'}</span>`}</div></div>`}).join('')}
    </div>` : '<div class="card" style="text-align:center;padding:20px;color:var(--g400)">Join as a player to see your team.</div>'}
    ${adminUnlocked ? `<div style="margin-top:14px"><div class="row" style="gap:6px;justify-content:center"><button class="btn btn-secondary btn-sm" onclick="undoDraft()" ${ds.cp === 0 ? 'disabled' : ''}>Undo Last Pick</button><button class="btn btn-danger btn-sm" onclick="resetDraft()">Reset Draft</button></div></div>` : ''}`;
    return;
  }
  const all = S.players.flatMap(p => p.teamIds);
  const av = S.teams.filter(t => !all.includes(t.id)).filter(t => S.fr === "All" || t.region === S.fr).filter(t => S.fs === "All" || t.seed === Number(S.fs)).sort((a,b) => a.seed - b.seed || a.name.localeCompare(b.name));
  const cid = ds.order[ds.cp], cp = S.players.find(p => p.id === cid);
  const isMyTurn = adminUnlocked || myId === ds.order[ds.cp];
  c.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
    <div class="section-title">Snake Draft</div>
    <div class="row" style="gap:6px">${adminUnlocked && ds.timerDuration > 0 ? `
      ${ds.timerPaused
        ? '<button class="btn btn-primary btn-sm" onclick="resumeDraftClock()">Resume Clock</button>'
        : '<button class="btn btn-secondary btn-sm" onclick="pauseDraftClock()">Pause Clock</button>'}
    ` : ''}<button class="btn btn-secondary btn-sm" onclick="undoDraft()" ${ds.cp === 0 ? 'disabled' : ''}>Undo</button><button class="btn btn-danger btn-sm" onclick="resetDraft()">Reset</button></div></div>
  ${(() => {
    let lastPickHTML = '';
    if(ds.cp > 0){
      const prevPid = ds.order[ds.cp - 1];
      const prevPlayer = S.players.find(p => p.id === prevPid);
      if(prevPlayer && prevPlayer.teamIds.length > 0){
        const lastTid = prevPlayer.teamIds[prevPlayer.teamIds.length - 1];
        const lastTeam = S.teams.find(t => t.id === lastTid);
        if(lastTeam) lastPickHTML = `<div class="last-pick">Last: <strong>${escapeHtml(prevPlayer.name)}</strong> picked ${teamLogoHTML(lastTeam, 16)} #${lastTeam.seed} ${escapeHtml(teamDisplayName(lastTeam))}</div>`;
      }
    }
    const upNextNames = [];
    for(let i = 1; i <= 2 && ds.cp + i < ds.order.length; i++){
      const nid = ds.order[ds.cp + i];
      const np = S.players.find(p => p.id === nid);
      if(np && !upNextNames.includes(np.name)) upNextNames.push(np.name);
    }
    const upNextHTML = upNextNames.length ? `<div class="up-next">Up next: ${upNextNames.map(n => escapeHtml(n)).join(', ')}</div>` : '';
    const _turnMyId = getMyPlayerId();
    const _isMyTurn = _turnMyId === ds.order[ds.cp];
    const _turnMsg = _isMyTurn ? `<div class="turn-indicator your-turn">Your turn to pick!</div>` : `<div class="turn-indicator waiting">Waiting for ${escapeHtml(cp?.name || '')}...</div>`;
    return `<div class="card active-pick" style="margin-bottom:14px">${lastPickHTML}<div style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.8px">Pick ${ds.cp+1} of ${ds.order.length} — Round ${Math.floor(ds.cp/S.players.length)+1}</div><div class="pick-row"><div style="font-size:20px;font-weight:800;color:var(--gold)">${escapeHtml(cp?.name || '')}'s Pick</div><div id="draft-timer" class="draft-timer" style="display:${ds.pickDeadline || ds.timerPaused ? 'inline' : 'none'}"></div></div>${upNextHTML}<div class="progress-bar"><div class="progress-fill" style="width:${(ds.cp/ds.order.length)*100}%"></div></div></div>${_turnMyId ? _turnMsg : ''}`;
  })()}
  <div class="draft-grid"><div>
    <div class="row" style="margin-bottom:10px;gap:8px;flex-wrap:wrap">
      <select onchange="S.fr=this.value;render()" style="width:130px"><option value="All" ${S.fr==='All'?'selected':''}>All Regions</option>${REGIONS.map(r => `<option value="${r}" ${S.fr===r?'selected':''}>${r}</option>`).join('')}</select>
      <select onchange="S.fs=this.value;render()" style="width:110px"><option value="All" ${S.fs==='All'?'selected':''}>All Seeds</option>${SEEDS.map(s => `<option value="${s}" ${String(S.fs)===String(s)?'selected':''}>Seed ${s}</option>`).join('')}</select>
      <span style="color:var(--g400);font-size:12px">${av.length} available</span></div>
    <div class="draft-teams">${av.map(t => `<button class="pick-btn" onclick="pickTeam('${t.id}')" ${!isMyTurn ? 'disabled' : ''}>${teamLogoHTML(t, 20)}${seedBadge(t.seed)}<div><div style="font-weight:600">${escapeHtml(teamDisplayName(t))}</div><div style="font-size:11px;color:var(--g400)">${t.region}${teamRecordDisplay(t) ? ` · ${teamRecordDisplay(t)}` : ''}</div></div></button>`).join('')}</div></div>
  <div><span class="label">Rosters</span>
    ${S.players.map(p => {const pt = S.teams.filter(t => p.teamIds.includes(t.id)).sort((a,b) => a.seed - b.seed); const act = p.id === cid; const _isMe = p.id === myId; return `<div class="roster-card ${act?'active':''}"><div class="row" style="justify-content:space-between;margin-bottom:4px"><span style="font-weight:700;font-size:13px;color:${act||_isMe?'var(--gold)':'var(--black)'}${_isMe?';font-weight:800':''}">${escapeHtml(p.name)}</span><span style="color:var(--g400);font-size:11px">${pt.length}</span></div>${pt.map(t => `<div style="display:flex;align-items:center;gap:5px;font-size:12px;padding:1px 0">${teamLogoHTML(t, 20)}${seedBadge(t.seed)} ${escapeHtml(teamDisplayName(t))}</div>`).join('')}</div>`}).join('')}
  </div></div>`;
}

async function startDraft(){
  if(!await requireAdmin()) return;
  _beeped = false;
  const duration = S.draftClockDuration || 0;
  S.ds = {
    order: snakeOrder(S.players.map(p => p.id), S.teams.length),
    cp: 0, started: true, complete: false,
    timerDuration: duration,
    pickDeadline: duration > 0 ? firebase.firestore.Timestamp.fromDate(new Date(serverNow() + duration * 1000)) : null,
    timerPaused: false,
    pausedRemaining: null
  };
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
        throw { code: 'taken', msg: 'That team was just picked — choose another' };
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
    else { console.warn('Pick transaction failed:', err); showToast('Pick failed — try again'); }
  } finally {
    _pickInFlight = false;
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
    } catch(err){ console.warn('Undo failed:', err); showToast('Undo failed — try again'); }
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
  if(_audioCtx.state === 'suspended') _audioCtx.resume();
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
  if(el){
    // The clock ticks 4x a second but the label only changes once a second. Compare against what
    // the element already shows (not a remembered value: render() rebuilds the element empty) so
    // the three in-between ticks touch no DOM and force no style/layout work on phones.
    const text = seconds + 's';
    const cls = 'draft-timer ' + (seconds > 30 ? 'timer-green' : seconds > 10 ? 'timer-yellow' : 'timer-red');
    if(el.textContent !== text) el.textContent = text;
    if(el.className !== cls) el.className = cls;
  }

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

function pauseDraftClock(){
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

function resumeDraftClock(){
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
  c.innerHTML = `
    <div class="section-title">Bracket</div>
    <div style="display:flex;gap:4px;margin-bottom:16px;overflow-x:auto;-webkit-overflow-scrolling:touch">
      ${REGIONS.map(r => `<button class="round-tab" style="${reg===r?'background:var(--gold-bg);color:var(--gold)':''};flex-shrink:0" onclick="S.bracketRegion='${r}';render()">${r}</button>`).join('')}
      <button class="round-tab" style="${reg==='ff'?'background:var(--gold-bg);color:var(--gold)':''};flex-shrink:0" onclick="S.bracketRegion='ff';render()">Final Four</button>
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
      ${rw ? `${teamLogoHTML(rw, 28) ? `<div style="margin-bottom:4px">${teamLogoHTML(rw, 28)}</div>` : ''}<div style="font-size:11px;color:var(--gold);font-weight:800">${rw.seed}</div><div style="font-weight:800;font-size:14px">${escapeHtml(teamDisplayName(rw))}</div><div style="font-size:11px;color:var(--g400)">${owner(rw.id) || ''}</div>` : '<div style="color:var(--g300);font-size:13px">TBD</div>'}
    </div></div></div>`;
  html += `</div></div>`;
  area.innerHTML = html;
}

function slotHTML(region, gi, team, winnerId){
  if(!team) return `<div class="slot empty"><span class="tn">TBD</span></div>`;
  const isWinner = winnerId === team.id;
  const isLoser = winnerId && winnerId !== team.id;
  const ow = owner(team.id);
  const myId = getMyPlayerId();
  const myPlayer = myId ? S.players.find(p => p.id === myId) : null;
  const isMine = myPlayer && myPlayer.teamIds.includes(team.id);
  return `<div class="slot ${isWinner?'winner':''} ${isLoser?'loser':''} ${isMine?'mine':''}"
    onclick="advanceTeam('${region}',${gi},'${team.id}')"
    oncontextmenu="clearBracketGame('${region}',${gi},event)"
    ontouchstart="startLongPress(()=>clearBracketGame('${region}',${gi}))"
    ontouchend="endLongPress(event)"
    ontouchmove="cancelLongPress()">
    ${teamLogoHTML(team, 16)}<span class="sd">${team.seed}</span><span class="tn">${escapeHtml(teamDisplayName(team))}</span>${ow ? `<span class="ow">${escapeHtml(ow)}</span>` : ''}
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
      ${teamLogoHTML(team, 20)}<span class="sd">${team.seed}</span>${escapeHtml(teamDisplayName(team))}<span style="margin-left:auto;font-size:10px;color:var(--g400)">${owner(team.id) || ''}</span></div>`;
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
          ${champt ? `${teamLogoHTML(champt, 32) ? `<div style="margin-bottom:4px">${teamLogoHTML(champt, 32)}</div>` : ''}<div class="champ-team">${seedBadge(champt.seed)} ${escapeHtml(teamDisplayName(champt))}</div><div class="champ-owner">${owner(champt.id) || ''}</div>` : '<div class="champ-team" style="color:var(--g300)">TBD</div>'}
        </div>
      </div>
    </div>
    `;
}

/* ── Leaderboard Page ── */
function renderLeaderboard(c){
  const sc = scores(), mx = Math.max(...sc.map(s => s.tot), 1), md = ["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];
  const myId = getMyPlayerId();
  const myIdx = myId ? sc.findIndex(s => s.pid === myId) : -1;
  const mySc = myIdx >= 0 ? sc[myIdx] : null;
  function aliveCount(pid){ const p = S.players.find(p=>p.id===pid); if(!p) return 0; return p.teamIds.filter(tid => !(S.games||[]).some(g => (g.t1===tid||g.t2===tid) && g.wid && g.wid!==tid)).length; }
  const myAlive = mySc ? aliveCount(mySc.pid) : 0;
  c.innerHTML = `<div class="section-title">Leaderboard</div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <p class="section-desc" style="margin:0"></p>
    <button class="btn btn-secondary btn-sm" onclick="shareLeaderboard()" title="Share leaderboard">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share
    </button>
  </div>
  ${mySc ? `<div class="your-standing"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <div><div class="rank">#${myIdx+1}</div><div style="font-weight:700">${escapeHtml(mySc.name)}</div></div>
    <div style="text-align:right"><div class="stat"><strong>${mySc.tot}</strong> points</div><div class="stat"><strong>${myAlive}</strong> teams alive</div>
    ${myIdx > 0 ? `<div class="stat">${sc[myIdx-1].tot - mySc.tot} pts behind #${myIdx}</div>` : ''}${myIdx < sc.length-1 && myIdx >= 0 ? `<div class="stat">${mySc.tot - sc[myIdx+1].tot} pts ahead of #${myIdx+2}</div>` : ''}</div>
  </div></div>` : ''}
  <div class="row" style="gap:12px;margin-bottom:24px;flex-wrap:wrap">
    ${sc.slice(0,3).map((s,i) => `<div class="podium-card ${i===0?'first':''} ${s.pid===myId?'mine':''}"><div style="font-size:28px;margin-bottom:2px">${md[i]||''}</div><div style="font-size:16px;font-weight:800${s.pid===myId?';color:var(--gold)':''}">${escapeHtml(s.name)}</div><div class="podium-pts">${s.tot}</div><div style="font-size:11px;color:var(--g400)">points</div><div style="font-size:11px;color:var(--g400)">${aliveCount(s.pid)} alive</div></div>`).join('')}</div>
  <div class="card" style="margin-bottom:14px"><span class="label">Points by Round</span><div style="overflow-x:auto"><table><thead><tr><th>Player</th>${[1,2,3,4,5,6].map(r => `<th style="text-align:center;font-size:10px">${RN[r].replace('Round of ','R')}</th>`).join('')}<th style="text-align:center;color:var(--gold)">Total</th><th style="text-align:center;font-size:10px">Alive</th></tr></thead><tbody>
    ${sc.map((s,i) => `<tr class="${s.pid===myId?'lb-row-mine':''}" style="background:${i%2===0?'var(--g50)':'var(--white)'}"><td style="font-weight:700"><span style="color:var(--g300);margin-right:6px">#${i+1}</span><span${s.pid===myId?' style="color:var(--gold)"':''}>${escapeHtml(s.name)}</span></td>${[1,2,3,4,5,6].map(r => `<td class="${s.rp[r]>0?'val':'dim'}">${s.rp[r]}</td>`).join('')}<td class="pts">${s.tot}</td><td style="text-align:center;font-size:12px;color:var(--g500)">${aliveCount(s.pid)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card" style="margin-bottom:14px"><span class="label">Score Bars</span>
    ${sc.map(s => `<div class="row" style="margin-bottom:6px"><span style="width:70px;font-weight:${s.pid===myId?'800':'700'};font-size:13px;text-align:right${s.pid===myId?';color:var(--gold)':''}">${escapeHtml(s.name)}</span><div class="bar-container"><div class="bar-fill ${s.pid===myId?'mine':''}" style="width:${(s.tot/mx)*100}%"></div></div><span style="width:36px;font-weight:800;font-size:14px;color:var(--gold)">${s.tot}</span><span style="width:40px;font-size:11px;color:var(--g400);text-align:center">${aliveCount(s.pid)}&#x1f7e2;</span></div>`).join('')}</div>
  <div class="card"><span class="label">Team Rosters & Status</span>
    ${S.players.map(p => {const isMe = p.id === myId; const pt = S.teams.filter(t => p.teamIds.includes(t.id)).sort((a,b) => a.seed - b.seed); return `<div class="${isMe?'roster-mine':''}" style="${isMe?'':'margin-bottom:14px'}"><h4 style="font-weight:${isMe?'800':'700'};margin-bottom:6px;font-size:14px${isMe?';color:var(--gold)':''}">${escapeHtml(p.name)}</h4><div class="row" style="flex-wrap:wrap;gap:5px">${pt.map(t => {const w = (S.games||[]).filter(g => g.wid===t.id).length; const el = (S.games||[]).some(g => (g.t1===t.id||g.t2===t.id) && g.wid && g.wid!==t.id); return `<span class="tag ${el?'tag-elim':'tag-alive'}">${teamLogoHTML(t, 16)}${seedBadge(t.seed)} ${escapeHtml(teamDisplayName(t))}${w>0?`<span style="color:var(--green);font-weight:700">W${w}</span>`:''}${el?'<span style="color:var(--red)">\u2715</span>':''}</span>`}).join('')}</div></div>`}).join('')}</div>`;
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
      <div class="import-espn-card" onclick="importFromESPN()" id="espn-import">
        <h3>Import from ESPN</h3>
        <p>Auto-import all 64 tournament teams with seeds, regions, logos, and rankings from ESPN.</p>
        <button class="btn btn-primary" id="espn-import-btn">Import ${S.year} Tournament Teams</button>
      </div>` : `
      <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="espn-import-btn" onclick="importFromESPN()">Re-Import from ESPN</button>
        <button class="btn btn-secondary btn-sm" onclick="refreshTeamData()">Refresh Logos & Rankings</button>
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
  S.year = Number(v) || new Date().getFullYear();
  saveState();
  render();
}

async function clearAllTeams(){
  if(!await requireAdmin()) return;
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

