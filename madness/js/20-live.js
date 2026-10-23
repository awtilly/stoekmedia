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

/* Finals whose gameResult is reported but whose bracket slot could not be decided yet (a feeder slot was
 * still empty, e.g. the scoreboard arrived before the room snapshot carrying yesterday's winners, or the
 * Live date picker was on a later day). Retried on every poll; the device that finally advances it saves. */
const _pendingAdvance = new Map(); // game.id -> parsed game
const _advancedFinals = new Set(); // game ids that already filled a slot (autoAdvanceBracket is false for those too)

function retryPendingAdvances() {
  let any = false;
  for (const [id, g] of _pendingAdvance) {
    if (autoAdvanceBracket(g)) { _pendingAdvance.delete(id); _advancedFinals.add(id); any = true; }
  }
  return any;
}

async function checkGameFinals() {
  if (!S.teams || S.teams.length === 0) return;

  // Build a set of ESPN IDs for teams in this room
  const roomEspnIds = new Set(S.teams.map(t => t.espnId).filter(Boolean));
  let advanced = false;
  let shouldSync = false;

  if (retryPendingAdvances()) { advanced = true; shouldSync = true; }

  for (const game of liveScores) {
    if (game.state !== 'post' || !game.completed) continue;
    if (_reportedFinals.has(game.id)) continue;

    // Check if either team in this game belongs to this room
    const awayInRoom = roomEspnIds.has(game.away.espnId);
    const homeInRoom = roomEspnIds.has(game.home.espnId);
    if (!awayInRoom && !homeInRoom) continue;

    // Determine winner/loser
    const winner = game.away.winner ? game.away : game.home;
    const loser = game.away.winner ? game.home : game.away;
    const isUpset = winner.seed && loser.seed && winner.seed > loser.seed;

    // Compute current leaderboard rankings BEFORE this result
    const rankingsBefore = scores().map(s => s.pid);

    // Advance the bracket locally FIRST so the report below can carry the post-game rankings. The
    // notifyGameFinal Cloud Function used to recompute them from the room document, but that document
    // only changes when the debounced saveState() write lands (800 ms after this report), so it always
    // saw the pre-game state and the "Leaderboard Shake-up" push never fired.
    const didAdvance = autoAdvanceBracket(game);
    if (didAdvance) { advanced = true; syncGames(); }
    const rankingsAfter = scores().map(s => s.pid);

    // Write to gameResults subcollection -- Cloud Function will trigger
    // Check-before-write: only the first client to report triggers Firestore sync
    let isFirstReporter = false;
    let reported = !roomId; // solo/offline rooms have nowhere to report; they still auto-advance below
    if (roomId) {
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
            rankingsAfter,
            reportedAt: firebase.firestore.FieldValue.serverTimestamp(),
            reportedBy: getMyPlayerId() || 'unknown'
          });
          isFirstReporter = true;
        }
        reported = true;
      } catch (err) {
        // Left out of _reportedFinals so the next poll retries the report (the bracket advance below is idempotent).
        console.warn('Failed to report game final:', game.id, err);
      }
    }
    if (reported) _reportedFinals.add(game.id);
    if (didAdvance) {
      _advancedFinals.add(game.id);
      if (isFirstReporter) shouldSync = true;
    } else if (reported && awayInRoom && homeInRoom && !_advancedFinals.has(game.id)) {
      // Both teams are ours but no slot matched: a feeder is still undecided. Keep it for the next poll.
      _pendingAdvance.set(game.id, game);
    }
  }
  if (retryPendingAdvances()) { advanced = true; shouldSync = true; }

  if (advanced) {
    syncGames();
    // Only the first reporter writes bracket state to Firestore;
    // other clients get it via the onSnapshot listener
    if (shouldSync) {
      saveState();
    } else {
      try { localStorage.setItem(stateKey(), JSON.stringify(S)); } catch(e){}
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

