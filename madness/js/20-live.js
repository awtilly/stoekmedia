/* ── Live Scores State ── */
let liveScores = [];
// liveScoresDate and liveScoresFilter are on S (persisted via VIEW_LOCAL)
let liveRefreshTimer = null;
let liveLastRefresh = 0;
let liveLastError = false; // the last direct ESPN poll failed (offline, blocked, HTTP error); the Live tab says so instead of 'No games found'

/* ── Cached scoreboard ──
 * The pollScoreboard Cloud Function (functions/scoreboard.js) writes the parsed ESPN
 * scoreboard to Firestore doc scoreboard/{YYYYMMDD} once a minute during the tournament.
 * Clients listen to that doc instead of each polling ESPN every 30s. If the doc is
 * missing, stale, or unreadable (function not deployed, off-season, rules not updated),
 * we fall back to the original direct ESPN polling, so nothing breaks either way. */
const SCOREBOARD_COLLECTION = 'scoreboard';
const SCOREBOARD_MAX_AGE_MS = 3 * 60 * 1000; // doc older than this => poll ESPN directly
let _scoreboardUnsub = null;
let _scoreboardFresh = false; // true while the cached doc is current; direct polling pauses
let _scoreboardSeenAt = 0;    // local clock when the last usable snapshot arrived (freshness is measured from here, so a wrong phone clock cannot defeat the cache)
let _scoreboardDate = null;   // the scoreboard/{date} doc the listener is on (null = not listening)
let _liveFallbackTimer = null; // startLiveRefresh's one-shot "cached doc did not arrive" poll

function localDateStr(d) {
  const n = d || new Date();
  return n.getFullYear() + String(n.getMonth()+1).padStart(2,'0') + String(n.getDate()).padStart(2,'0');
}

function scoreboardDocValid(data) {
  return !!(data && Array.isArray(data.events) && data.fetchedAt && data.fetchedAt.toMillis && data.fetchedAt.toMillis() > 0);
}

function scoreboardIsFresh(data, now) {
  if (!scoreboardDocValid(data)) return false;
  return ((now || Date.now()) - data.fetchedAt.toMillis()) < SCOREBOARD_MAX_AGE_MS;
}

/* fromCache: the snapshot was replayed from Firestore's on-device persistence rather than delivered
 * by the server. A server-delivered doc is current by definition; a replayed one is judged by fetchedAt. */
function applyCachedScoreboard(data, fromCache) {
  const usable = fromCache ? scoreboardIsFresh(data) : scoreboardDocValid(data);
  if (!usable) { _scoreboardFresh = false; return false; }
  _scoreboardFresh = true;
  _scoreboardSeenAt = Date.now();
  liveLastError = false;
  liveScores = data.events;
  liveLastRefresh = data.fetchedAt.toMillis();
  checkGameFinals();
  if (S.phase === 'live') {
    const c = document.getElementById('c');
    if (c) renderLive(c);
  }
  return true;
}

function subscribeScoreboard(dateStr) {
  unsubscribeScoreboard();
  if (typeof db === 'undefined' || !db) return;
  _scoreboardDate = dateStr;
  _scoreboardUnsub = db.collection(SCOREBOARD_COLLECTION).doc(dateStr).onSnapshot(doc => {
    if (!doc.exists || !applyCachedScoreboard(doc.data(), !!(doc.metadata && doc.metadata.fromCache))) {
      _scoreboardFresh = false;
      refreshLiveScores();
    }
  }, err => {
    console.warn('Scoreboard cache unavailable, polling ESPN directly:', err && err.code || err);
    _scoreboardFresh = false;
    refreshLiveScores();
  });
}

function unsubscribeScoreboard() {
  if (_scoreboardUnsub) { _scoreboardUnsub(); _scoreboardUnsub = null; }
  _scoreboardDate = null;
  _scoreboardFresh = false;
}

async function refreshLiveScores() {
  // Cached doc is current: the Cloud Function is doing the polling for everyone.
  if (_scoreboardFresh && (Date.now() - _scoreboardSeenAt) < SCOREBOARD_MAX_AGE_MS) return;
  _scoreboardFresh = false;
  const dateStr = S.liveScoresDate || localDateStr();
  // "Today" rolled over while the tab stayed open: the function stops writing yesterday's doc, so without this
  // the device would sit on direct ESPN polling for the rest of the day. Move the listener to the new day's doc.
  if (_scoreboardUnsub && dateStr !== _scoreboardDate) subscribeScoreboard(dateStr);
  const data = await espn.fetchScoreboard(dateStr);
  liveLastError = !data; // fetchScoreboard returns null on any failure
  if (data) {
    liveScores = espn.parseScoreboardEvents(data);
    liveLastRefresh = Date.now();
    checkGameFinals();
  }
  // Only re-render if we're on the live tab (on failure too, so the "unavailable" notice shows)
  if (S.phase === 'live') {
    const c = document.getElementById('c');
    if (c) renderLive(c);
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
  subscribeScoreboard(S.liveScoresDate || localDateStr());
  // Give the cached doc a moment to arrive; if it hasn't, poll ESPN directly.
  _liveFallbackTimer = setTimeout(() => { _liveFallbackTimer = null; if (!_scoreboardFresh) refreshLiveScores(); }, 1500);
  liveRefreshTimer = setInterval(refreshLiveScores, 30000); // every 30s (no-op while cache is fresh)
  requestWakeLock();
}

function stopLiveRefresh() {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
  if (_liveFallbackTimer) { clearTimeout(_liveFallbackTimer); _liveFallbackTimer = null; } // leaving Live within 1.5 s no longer fires a stray ESPN poll
  unsubscribeScoreboard();
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

