/* ── Live Scores State ── */
let liveScores = [];
// liveScoresDate and liveScoresFilter are on S (persisted via VIEW_LOCAL)
let liveRefreshTimer = null;
let liveLastRefresh = 0;

async function refreshLiveScores() {
  const now = new Date();
  const localToday = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const dateStr = S.liveScoresDate || localToday;
  const data = await espn.fetchScoreboard(dateStr);
  if (data) {
    liveScores = espn.parseScoreboardEvents(data);
    liveLastRefresh = Date.now();
    checkGameFinals();
    // Only re-render if we're on the live tab
    if (S.phase === 'live') {
      const c = document.getElementById('c');
      if (c) renderLive(c);
    }
  }
}

/* ── Game Final Detection ── */
const _reportedFinals = new Set();

async function checkGameFinals() {
  if (!roomId || !S.teams || S.teams.length === 0) return;

  // Build a set of ESPN IDs for teams in this room
  const roomEspnIds = new Set(S.teams.map(t => t.espnId).filter(Boolean));
  let advanced = false;
  let shouldSync = false;

  for (const game of liveScores) {
    if (game.state !== 'post' || !game.completed) continue;
    // Only NCAA tournament games count. ESPN labels every tournament game "NCAA Men's Basketball Championship - ..."
    // and every conference-tournament game with its own name; a conference final between two bracket teams on
    // Selection Sunday must not become a gameResult (push alert, upset flag). A game with no note at all still passes.
    if (game.note && !/NCAA/.test(game.note)) continue;
    if (_reportedFinals.has(game.id)) continue;

    // Check if either team in this game belongs to this room
    const awayInRoom = roomEspnIds.has(game.away.espnId);
    const homeInRoom = roomEspnIds.has(game.home.espnId);
    if (!awayInRoom && !homeInRoom) continue;

    _reportedFinals.add(game.id);

    // Determine winner/loser
    const winner = game.away.winner ? game.away : game.home;
    const loser = game.away.winner ? game.home : game.away;
    const isUpset = winner.seed && loser.seed && winner.seed > loser.seed;

    // Compute current leaderboard rankings BEFORE this result
    const rankingsBefore = scores().map(s => s.pid);

    // Write to gameResults subcollection -- Cloud Function will trigger
    // Check-before-write: only the first client to report triggers Firestore sync
    let isFirstReporter = false;
    try {
      const resultRef = db.collection('rooms').doc(roomId)
        .collection('gameResults').doc(game.id);
      const existing = await resultRef.get();
      if (!existing.exists) {
        await resultRef.set({
          awayName: game.away.name,
          awayScore: game.away.score,
          awaySeed: game.away.seed || null,
          homeName: game.home.name,
          homeScore: game.home.score,
          homeSeed: game.home.seed || null,
          winnerName: winner.name,
          winnerSeed: winner.seed || null,
          loserName: loser.name,
          loserSeed: loser.seed || null,
          isUpset,
          rankingsBefore,
          reportedAt: firebase.firestore.FieldValue.serverTimestamp(),
          reportedBy: getMyPlayerId() || 'unknown'
        });
        isFirstReporter = true;
      }
    } catch (err) {
      console.warn('Failed to report game final:', game.id, err);
    }

    // Auto-advance bracket locally for all clients (instant feedback)
    if (autoAdvanceBracket(game)) {
      advanced = true;
      if (isFirstReporter) shouldSync = true;
    }
  }

  if (advanced) {
    syncGames();
    // Only the first reporter writes bracket state to Firestore;
    // other clients get it via the onSnapshot listener
    if (shouldSync) {
      saveState();
    } else {
      try { localStorage.setItem("mm4", JSON.stringify(S)); } catch(e){}
    }
    render();
  }
}

function autoAdvanceBracket(game) {
  const winner = game.away.winner ? game.away : game.home;
  const winnerTeam = S.teams.find(t => t.espnId === winner.espnId);
  if (!winnerTeam) return false;

  // Check regional bracket slots (indices 0-14 per region)
  for (const region of REGIONS) {
    for (let gi = 0; gi < 15; gi++) {
      if (S.bracket[region][gi]) continue; // already filled
      const t0 = getTeamForSlot(region, gi, 0);
      const t1 = getTeamForSlot(region, gi, 1);
      if (!t0 || !t1) continue;
      if ((t0.espnId === game.away.espnId && t1.espnId === game.home.espnId) ||
          (t0.espnId === game.home.espnId && t1.espnId === game.away.espnId)) {
        S.bracket[region][gi] = winnerTeam.id;
        return true;
      }
    }
  }

  // Check Final Four semis (ff[0], ff[1])
  const ffPairs = [[0,1],[2,3]];
  for (let fi = 0; fi < 2; fi++) {
    if (S.bracket.ff[fi]) continue;
    const t0id = S.bracket[REGIONS[ffPairs[fi][0]]][14];
    const t1id = S.bracket[REGIONS[ffPairs[fi][1]]][14];
    if (!t0id || !t1id) continue;
    const t0 = S.teams.find(t => t.id === t0id);
    const t1 = S.teams.find(t => t.id === t1id);
    if (!t0 || !t1) continue;
    if ((t0.espnId === game.away.espnId && t1.espnId === game.home.espnId) ||
        (t0.espnId === game.home.espnId && t1.espnId === game.away.espnId)) {
      S.bracket.ff[fi] = winnerTeam.id;
      return true;
    }
  }

  // Check Championship (ff[2])
  if (!S.bracket.ff[2] && S.bracket.ff[0] && S.bracket.ff[1]) {
    const t0 = S.teams.find(t => t.id === S.bracket.ff[0]);
    const t1 = S.teams.find(t => t.id === S.bracket.ff[1]);
    if (t0 && t1 &&
        ((t0.espnId === game.away.espnId && t1.espnId === game.home.espnId) ||
         (t0.espnId === game.home.espnId && t1.espnId === game.away.espnId))) {
      S.bracket.ff[2] = winnerTeam.id;
      return true;
    }
  }

  return false;
}

function startLiveRefresh() {
  stopLiveRefresh();
  autoResolvePlayIns();
  refreshLiveScores();
  liveRefreshTimer = setInterval(refreshLiveScores, 30000); // every 30s
  requestWakeLock();
}

function stopLiveRefresh() {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
  releaseWakeLock();
}

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    console.warn('Wake Lock failed:', err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.phase === 'live') startLiveRefresh();
  } else {
    stopLiveRefresh();
  }
});

