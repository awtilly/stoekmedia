/* ── Live Scores State ── */
let liveScores = [];
// liveScoresDate and liveScoresFilter are on S (persisted via VIEW_LOCAL)
let liveRefreshTimer = null;
let liveLastRefresh = 0;
let liveLastError = false; // the last direct scoreboard poll failed (offline, blocked, HTTP error); the Live tab says so instead of 'No games found'

/* ── Cached scoreboard ──
 * The pollScoreboard Cloud Function (functions/scoreboard.js) writes the parsed NCAA.com
 * scoreboard to Firestore doc scoreboard/{YYYYMMDD} once a minute during the tournament.
 * Clients listen to that doc instead of each polling every 30s. If the doc is
 * missing, stale, or unreadable (function not deployed, off-season, rules not updated),
 * we fall back to polling through the ncaa proxy function (js/10-ncaa.js), so nothing breaks either way. */
const SCOREBOARD_COLLECTION = 'scoreboard';
const SCOREBOARD_MAX_AGE_MS = 3 * 60 * 1000; // doc older than this => poll the scoreboard directly
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
    console.warn('Scoreboard cache unavailable, polling the scoreboard directly:', err && err.code || err);
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
  // the device would sit on direct polling for the rest of the day. Move the listener to the new day's doc.
  if (_scoreboardUnsub && dateStr !== _scoreboardDate) subscribeScoreboard(dateStr);
  const data = await ncaa.fetchScoreboard(dateStr);
  liveLastError = !data; // fetchScoreboard returns null on any failure
  if (data) {
    liveScores = ncaa.parseScoreboard(data);
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

/* Finals whose gameResult is reported but whose bracket slot could not be decided yet (a feeder slot was
 * still empty, e.g. the scoreboard arrived before the room snapshot carrying yesterday's winners, or the
 * Live date picker was on a later day). Retried on every poll; the device that finally advances it saves. */
const _pendingAdvance = new Map(); // game.id -> parsed game
const _advancedFinals = new Set(); // game ids that already filled a slot (autoAdvanceBracket is false for those too)

/* Advances this device made as a NON-first reporter. Only the first reporter saves the bracket to Firestore; if its
 * save never lands (tab closed inside the debounce, or before its own pending retry) the next room snapshot wipes our
 * local advance and, with the gameResult already written, no device is ever "first" again. Each poll re-applies
 * these locally; 30 s after the final this device reads the room document once and, if the winner is missing from
 * the remote bracket, saves the slot itself (the same idempotent saveState() every edit uses). */
const _unsyncedAdvances = new Map(); // game.id -> { game, teamId, since }
const UNSYNCED_ADVANCE_GRACE_MS = 30000;

function bracketCount(bracket, teamId) {
  let n = 0;
  for (const arr of Object.values(bracket || {})) for (const v of arr) if (v === teamId) n++;
  return n;
}

async function retryUnsyncedAdvances(verify) {
  let r = 0; // 0 nothing, 1 re-applied locally, 2 save to Firestore
  const now = Date.now();
  const unverified = []; // re-added after the loop: a key set during Map iteration is visited again
  for (const [id, entry] of _unsyncedAdvances) {
    if (!roomId) { _unsyncedAdvances.delete(id); continue; } // left the room: nothing to sync
    if (autoAdvanceBracket(entry.game)) r = Math.max(r, 1); // a snapshot without the slot wiped our local copy
    if (!verify || now - entry.since < UNSYNCED_ADVANCE_GRACE_MS) continue;
    _unsyncedAdvances.delete(id);
    try {
      const doc = await db.collection('rooms').doc(roomId).get();
      const data = doc.exists ? doc.data() : null;
      const remote = data && data.state ? JSON.parse(data.state) : null;
      if (!remote || bracketCount(remote.bracket, entry.teamId) < bracketCount(S.bracket, entry.teamId)) r = 2;
    } catch (err) {
      unverified.push([id, entry]); // could not read the room: check again next poll
      console.warn('Could not verify bracket advance:', id, err);
    }
  }
  for (const [id, entry] of unverified) _unsyncedAdvances.set(id, entry);
  return r;
}

function retryPendingAdvances() {
  let any = false;
  for (const [id, g] of _pendingAdvance) {
    if (autoAdvanceBracket(g)) { _pendingAdvance.delete(id); _advancedFinals.add(id); any = true; }
  }
  return any;
}

async function checkGameFinals() {
  if (!S.teams || S.teams.length === 0) return;

  // Build a set of NCAA.com team slugs (ncaaId) for teams in this room
  const roomNcaaIds = new Set(S.teams.map(t => t.ncaaId).filter(Boolean));
  let advanced = false;
  let shouldSync = false;

  if (retryPendingAdvances()) { advanced = true; shouldSync = true; }
  { const r = await retryUnsyncedAdvances(true); if (r) advanced = true; if (r === 2) shouldSync = true; }

  for (const game of liveScores) {
    if (game.state !== 'post' || !game.completed) continue;
    // Only NCAA tournament games count: ncaa.com tags those (and only those) with a bracketId, which the parser
    // turns into `tournament`. A conference final between two bracket teams on Selection Sunday, or an NIT game,
    // must not become a gameResult (push alert, upset flag, bracket advance).
    if (!game.tournament) continue;
    if (_reportedFinals.has(game.id)) continue;

    // Check if either team in this game belongs to this room
    const awayInRoom = roomNcaaIds.has(game.away.ncaaId);
    const homeInRoom = roomNcaaIds.has(game.home.ncaaId);
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
    let reported = !roomId; // solo/offline rooms have nowhere to report; they already auto-advanced above
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
        // Left out of _reportedFinals so the next poll retries the report (the bracket advance above re-runs then; it is idempotent).
        console.warn('Failed to report game final:', game.id, err);
      }
    }
    if (reported) _reportedFinals.add(game.id);
    if (didAdvance) {
      _advancedFinals.add(game.id);
      if (isFirstReporter) shouldSync = true;
      else if (roomId && reported) {
        const winnerTeam = S.teams.find(t => t.ncaaId === winner.ncaaId);
        _unsyncedAdvances.set(game.id, { game, teamId: winnerTeam && winnerTeam.id, since: Date.now() });
      }
    } else if (reported && awayInRoom && homeInRoom && !_advancedFinals.has(game.id)) {
      // Both teams are ours but no slot matched: a feeder is still undecided. Keep it for the next poll.
      _pendingAdvance.set(game.id, game);
    }
  }
  if (retryPendingAdvances()) { advanced = true; shouldSync = true; }
  { const r = await retryUnsyncedAdvances(false); if (r) advanced = true; } // re-apply only: the room read happens once per poll

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
  const winnerTeam = S.teams.find(t => t.ncaaId === winner.ncaaId);
  if (!winnerTeam) return false;

  // Check regional bracket slots (indices 0-14 per region)
  for (const region of REGIONS) {
    for (let gi = 0; gi < 15; gi++) {
      if (S.bracket[region][gi]) continue; // already filled
      const t0 = getTeamForSlot(region, gi, 0);
      const t1 = getTeamForSlot(region, gi, 1);
      if (!t0 || !t1) continue;
      if ((t0.ncaaId === game.away.ncaaId && t1.ncaaId === game.home.ncaaId) ||
          (t0.ncaaId === game.home.ncaaId && t1.ncaaId === game.away.ncaaId)) {
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
    if ((t0.ncaaId === game.away.ncaaId && t1.ncaaId === game.home.ncaaId) ||
        (t0.ncaaId === game.home.ncaaId && t1.ncaaId === game.away.ncaaId)) {
      S.bracket.ff[fi] = winnerTeam.id;
      return true;
    }
  }

  // Check Championship (ff[2])
  if (!S.bracket.ff[2] && S.bracket.ff[0] && S.bracket.ff[1]) {
    const t0 = S.teams.find(t => t.id === S.bracket.ff[0]);
    const t1 = S.teams.find(t => t.id === S.bracket.ff[1]);
    if (t0 && t1 &&
        ((t0.ncaaId === game.away.ncaaId && t1.ncaaId === game.home.ncaaId) ||
         (t0.ncaaId === game.home.ncaaId && t1.ncaaId === game.away.ncaaId))) {
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
  // Give the cached doc a moment to arrive; if it hasn't, poll the scoreboard directly.
  _liveFallbackTimer = setTimeout(() => { _liveFallbackTimer = null; if (!_scoreboardFresh) refreshLiveScores(); }, 1500);
  liveRefreshTimer = setInterval(refreshLiveScores, 30000); // every 30s (no-op while cache is fresh)
  requestWakeLock();
}

function stopLiveRefresh() {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
  if (_liveFallbackTimer) { clearTimeout(_liveFallbackTimer); _liveFallbackTimer = null; } // leaving Live within 1.5 s no longer fires a stray poll
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

