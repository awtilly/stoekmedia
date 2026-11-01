/*
 * pollScoreboard: scheduled Cloud Function that polls the NCAA.com scoreboard (via ncaa-api,
 * see scoreboard-logic.js) once a minute during the tournament and writes the parsed result
 * to scoreboard/{YYYYMMDD}. Clients listen to that document instead of each polling every
 * 30 seconds (see js/20-live.js). This is the single place to swap the data provider.
 *
 * Manual override: create scoreboard/_config with { enabled: true|false }.
 *
 * Requires: Blaze plan (Cloud Scheduler), firestore.rules read access on /scoreboard/{doc}.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { parseScoreboard } = require('./ncaa-parse');
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
      if (r.status === 404 || r.status === 403) {
        // ncaa.com answers 403/404 for a date with no scoreboard page (an off day between rounds):
        // write an empty day so phones stay on the cache instead of falling back to direct polling.
        data = { games: [] };
      } else if (!r.ok) {
        console.warn(`NCAA ${ymd} responded ${r.status}`);
        continue;
      } else {
        data = await r.json();
      }
    } catch (err) {
      console.warn(`NCAA ${ymd} fetch failed:`, err.message || err);
      continue;
    }
    const events = parseScoreboard(data);
    await db.doc(`scoreboard/${ymd}`).set(buildDoc(ymd, events, FieldValue.serverTimestamp()));
  }
});
