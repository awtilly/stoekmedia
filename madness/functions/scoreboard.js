/*
 * pollScoreboard: scheduled Cloud Function that polls the ESPN scoreboard once
 * a minute during the tournament and writes the parsed result to
 * scoreboard/{YYYYMMDD}. Clients listen to that document instead of each
 * hitting ESPN every 30 seconds (see js/20-live.js). This is the single place
 * to swap in a licensed provider if ESPN ever changes or blocks the endpoint.
 *
 * Manual override: create scoreboard/_config with { enabled: true|false }.
 *
 * Requires: Blaze plan (Cloud Scheduler), firestore.rules read access on
 * /scoreboard/{doc}. Both are "needs Joe" items in the PR.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { parseScoreboardEvents } = require('./espn-parse');
const { TZ, FETCH_HEADERS, shouldPoll, datesToPoll, scoreboardUrl, buildDoc } = require('./scoreboard-logic');

exports.pollScoreboard = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: TZ,
  retryCount: 0,
  memory: '256MiB',
  timeoutSeconds: 30
}, async () => {
  const db = getFirestore();
  const cfgSnap = await db.doc('scoreboard/_config').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : null;
  const now = new Date();
  if (!shouldPoll(now, cfg)) return;

  for (const ymd of datesToPoll(now)) {
    let data;
    try {
      const r = await fetch(scoreboardUrl(ymd), { headers: FETCH_HEADERS });
      if (!r.ok) { console.warn(`ESPN ${ymd} responded ${r.status}`); continue; }
      data = await r.json();
    } catch (err) {
      console.warn(`ESPN ${ymd} fetch failed:`, err.message || err);
      continue;
    }
    const events = parseScoreboardEvents(data);
    await db.doc(`scoreboard/${ymd}`).set(buildDoc(ymd, events, FieldValue.serverTimestamp()));
  }
});
