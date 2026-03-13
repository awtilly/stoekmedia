const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { initializeApp } = require('firebase-admin/app');

initializeApp();
const db = getFirestore();

/* ── Helpers ── */

function computeRankings(state) {
  const players = state.players || [];
  const games = state.games || [];
  const rp = state.rp || { 1:1, 2:2, 3:4, 4:8, 5:16, 6:32 };
  const ub = state.ub || false;
  const teams = state.teams || [];

  const scored = players.map(p => {
    let tot = 0;
    for (const g of games) {
      if (!g.wid || !p.teamIds.includes(g.wid)) continue;
      let pts = rp[g.round] || 0;
      if (ub) {
        const w = teams.find(t => t.id === g.wid);
        const lid = g.t1 === g.wid ? g.t2 : g.t1;
        const l = teams.find(t => t.id === lid);
        if (w && l && w.seed > l.seed) pts += (w.seed - l.seed);
      }
      tot += pts;
    }
    return { pid: p.id, tot };
  });

  scored.sort((a, b) => b.tot - a.tot);
  return scored.map(s => s.pid);
}

async function cleanupStaleTokens(response, tokens, tokenMap, roomId) {
  const staleByPlayer = {};
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
      const playerId = tokenMap[tokens[idx]];
      if (!staleByPlayer[playerId]) staleByPlayer[playerId] = [];
      staleByPlayer[playerId].push(tokens[idx]);
    }
  });

  const cleanupPromises = Object.entries(staleByPlayer).map(([playerId, staleTokens]) =>
    db.doc(`rooms/${roomId}/fcmTokens/${playerId}`)
      .update({ tokens: FieldValue.arrayRemove(...staleTokens) })
      .catch(() => {}) // ignore if doc deleted
  );

  await Promise.all(cleanupPromises);
}

/* ── Cloud Functions ── */

exports.notifyDraftTurn = onDocumentUpdated('rooms/{roomId}', async (event) => {
  const beforeState = JSON.parse(event.data.before.data().state || '{}');
  const afterState = JSON.parse(event.data.after.data().state || '{}');

  const beforeDs = beforeState.ds || {};
  const afterDs = afterState.ds || {};

  // Only fire when draft pick index changes (new turn)
  if (afterDs.cp === beforeDs.cp) return;
  if (afterDs.complete) return;
  if (!afterDs.started) return;

  const currentDrafterId = afterDs.order?.[afterDs.cp];
  if (!currentDrafterId) return;

  const drafterName = afterState.players?.find(p => p.id === currentDrafterId)?.name || 'Player';
  const pickNumber = afterDs.cp + 1;
  const totalPlayers = afterState.players?.length || 1;
  const roundNumber = Math.floor(afterDs.cp / totalPlayers) + 1;

  // Get FCM tokens for the current drafter
  const tokenDoc = await db
    .doc(`rooms/${event.params.roomId}/fcmTokens/${currentDrafterId}`)
    .get();

  if (!tokenDoc.exists) return;
  const tokens = tokenDoc.data().tokens || [];
  if (tokens.length === 0) return;

  const message = {
    tokens,
    data: {
      title: "You're on the clock!",
      body: `Pick #${pickNumber} (Round ${roundNumber}) -- make your selection`,
      url: `/madness/?room=${event.params.roomId}`,
      tag: 'draft-turn',
      badgeCount: '1'
    }
  };

  const response = await getMessaging().sendEachForMulticast(message);

  // Clean up stale tokens using shared helper
  const tokenMap = {};
  tokens.forEach(t => { tokenMap[t] = currentDrafterId; });
  await cleanupStaleTokens(response, tokens, tokenMap, event.params.roomId);
});

exports.notifyGameFinal = onDocumentCreated('rooms/{roomId}/gameResults/{gameId}', async (event) => {
  const result = event.data.data();
  const roomId = event.params.roomId;

  // Build notification message
  const scoreText = `${result.awayName} ${result.awayScore} - ${result.homeName} ${result.homeScore}`;
  const upsetText = result.isUpset ? ' (UPSET!)' : '';

  // Get the room state to find all players and compute rankings
  const roomDoc = await db.doc(`rooms/${roomId}`).get();
  if (!roomDoc.exists) return;

  const state = JSON.parse(roomDoc.data().state || '{}');
  const players = state.players || [];
  if (players.length === 0) return;

  // Compute current rankings (scores after this game)
  const currentRankings = computeRankings(state);
  const previousRankings = result.rankingsBefore || [];

  // Detect ranking changes
  const rankingsChanged = previousRankings.length > 0 &&
    currentRankings.some((pid, idx) => previousRankings[idx] !== pid);

  // Collect all FCM tokens for all players in this room
  const tokenSnapshot = await db.collection(`rooms/${roomId}/fcmTokens`).get();
  if (tokenSnapshot.empty) return;

  // Send game final notification to all players
  const allTokens = [];
  const tokenMap = {}; // token -> playerId for cleanup
  tokenSnapshot.forEach(doc => {
    const tokens = doc.data().tokens || [];
    tokens.forEach(t => {
      allTokens.push(t);
      tokenMap[t] = doc.id;
    });
  });

  if (allTokens.length === 0) return;

  // Game final notification
  const gameMessage = {
    tokens: allTokens,
    data: {
      title: `Game Final${upsetText}`,
      body: scoreText,
      url: `/madness/?room=${roomId}&tab=live`,
      tag: `game-final-${event.params.gameId}`
    }
  };

  const gameResponse = await getMessaging().sendEachForMulticast(gameMessage);
  await cleanupStaleTokens(gameResponse, allTokens, tokenMap, roomId);

  // Leaderboard shake-up notification (only if rankings actually changed)
  if (rankingsChanged) {
    // Find new leader
    const newLeader = players.find(p => p.id === currentRankings[0]);
    const leaderName = newLeader?.name || 'Unknown';

    // Only send to tokens that succeeded on the game notification
    const validTokens = allTokens.filter((t, idx) => {
      return gameResponse.responses[idx]?.success;
    });

    if (validTokens.length > 0) {
      const leaderMessage = {
        tokens: validTokens,
        data: {
          title: 'Leaderboard Shake-up!',
          body: `${leaderName} takes the lead after ${result.winnerName} wins`,
          url: `/madness/?room=${roomId}&tab=leaderboard`,
          tag: 'leaderboard-change'
        }
      };

      const leaderResponse = await getMessaging().sendEachForMulticast(leaderMessage);

      // Clean up stale tokens from leaderboard notification
      const leaderTokenMap = {};
      validTokens.forEach(t => { leaderTokenMap[t] = tokenMap[t]; });
      await cleanupStaleTokens(leaderResponse, validTokens, leaderTokenMap, roomId);
    }
  }
});
