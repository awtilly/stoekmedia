/*
 * ncaa: HTTPS proxy in front of ncaa-api for the web/iOS clients.
 *
 * Why: the public ncaa-api instance sends no CORS headers, so a browser (or the Capacitor shell,
 * origin capacitor://localhost) cannot call it directly. The clients only need two things from it,
 * the Live tab's fallback poll when the scoreboard/{date} cache is missing or stale, and the
 * once-a-year tournament bracket import, so this forwards exactly those two routes
 * (scoreboard-logic.allowedPath) and nothing else. Responses are cached at the edge for 30 s.
 *
 * URL: https://us-central1-march-madness-snake-draft.cloudfunctions.net/ncaa/<route>
 */
const { onRequest } = require('firebase-functions/v2/https');
const { NCAA_API_BASE, FETCH_HEADERS, allowedPath } = require('./scoreboard-logic');

const ALLOWED_ORIGINS = [
  /^https:\/\/([a-z0-9-]+\.)?stoekmedia\.com$/,
  /^capacitor:\/\/localhost$/,
  /^ionic:\/\/localhost$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/
];

exports.ncaa = onRequest({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 20,
  maxInstances: 5,
  cors: ALLOWED_ORIGINS
}, async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  const p = String(req.path || '').replace(/\/+$/, '');
  if (!allowedPath(p)) { res.status(404).json({ error: 'route not available' }); return; }
  try {
    const r = await fetch(NCAA_API_BASE + p, { headers: FETCH_HEADERS });
    if (r.status === 404 || r.status === 403) {
      // ncaa.com: no page for that date/year yet (off day, or the bracket is not published). Empty, not an error.
      res.set('Cache-Control', 'public, max-age=60');
      res.status(200).json(p.startsWith('/brackets') ? { championships: [], upstreamStatus: r.status } : { games: [], upstreamStatus: r.status });
      return;
    }
    if (!r.ok) { res.status(502).json({ error: 'upstream ' + r.status }); return; }
    const body = await r.text();
    res.set('Cache-Control', 'public, max-age=30');
    res.type('application/json').status(200).send(body);
  } catch (err) {
    res.status(502).json({ error: String(err && err.message || err) });
  }
});
