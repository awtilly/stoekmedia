const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { initializeApp } = require('firebase-admin/app');

initializeApp();
const db = getFirestore();

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

  // Clean up stale tokens that failed with token-not-registered
  const failedTokens = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
      failedTokens.push(tokens[idx]);
    }
  });

  if (failedTokens.length > 0) {
    await db.doc(`rooms/${event.params.roomId}/fcmTokens/${currentDrafterId}`)
      .update({ tokens: FieldValue.arrayRemove(...failedTokens) });
  }
});
