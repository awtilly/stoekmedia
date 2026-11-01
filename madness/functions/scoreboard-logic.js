/*
 * Pure helpers for the pollScoreboard scheduled function and the `ncaa` proxy. No Firebase
 * imports so they can be unit tested from ../test without installing functions deps.
 *
 * Upstream is ncaa-api (https://github.com/henrygd/ncaa-api, MIT), a JSON mirror of ncaa.com.
 * The public instance is rate-limited (3 req/s per IP) and meant for light use; set NCAA_API_BASE
 * (and NCAA_API_KEY, sent as x-ncaa-key) in functions/.env to point at a self-hosted container.
 */
const NCAA_API_BASE = (process.env.NCAA_API_BASE || 'https://ncaa-api.henrygd.me').replace(/\/+$/, '');
const TZ = 'America/New_York';

// Identify ourselves with a bare product token (no URL or comment: some edges 403 those).
const FETCH_HEADERS = Object.assign(
  { 'User-Agent': 'madness-scoreboard-cache/2' },
  process.env.NCAA_API_KEY ? { 'x-ncaa-key': process.env.NCAA_API_KEY } : {}
);

// Poll window when no scoreboard/_config override exists: March 10 through April 10.
// First Four is ~March 17 and the title game is the first Monday of April.
const WINDOW_START = { month: 3, day: 10 };
const WINDOW_END = { month: 4, day: 10 };

/** YYYYMMDD, month, day and hour of `date` in the given IANA time zone. */
function dateParts(date, tz = TZ) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { ymd: `${p.year}${p.month}${p.day}`, month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24 };
}

/**
 * Decide whether this tick should hit the scoreboard.
 *   cfg.enabled === true  -> always poll (manual override from the Firestore console)
 *   cfg.enabled === false -> never poll
 *   otherwise             -> only inside the March/April tournament window
 */
function shouldPoll(now, cfg, tz = TZ) {
  if (cfg && cfg.enabled === false) return false;
  if (cfg && cfg.enabled === true) return true;
  const { month, day } = dateParts(now, tz);
  const afterStart = month > WINDOW_START.month || (month === WINDOW_START.month && day >= WINDOW_START.day);
  const beforeEnd = month < WINDOW_END.month || (month === WINDOW_END.month && day <= WINDOW_END.day);
  return afterStart && beforeEnd;
}

/** Today in the tournament time zone, plus yesterday before 4am so late West-coast finals land. */
function datesToPoll(now, tz = TZ) {
  const { ymd, hour } = dateParts(now, tz);
  const dates = [ymd];
  if (hour < 4) {
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    dates.push(dateParts(y, tz).ymd);
  }
  return dates;
}

/** The ncaa-api route for one day's men's D1 scoreboard: YYYYMMDD -> /scoreboard/basketball-men/d1/YYYY/MM/DD */
function scoreboardPath(ymd) {
  const d = String(ymd);
  return `/scoreboard/basketball-men/d1/${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
}

function scoreboardUrl(ymd) {
  return NCAA_API_BASE + scoreboardPath(ymd);
}

/**
 * The only upstream routes the `ncaa` proxy forwards: one day's men's D1 scoreboard and one year's
 * men's D1 bracket. Anything else (other sports, stats, logos, play-by-play) is refused so the
 * function cannot be used as an open proxy.
 */
const ALLOWED_PATHS = [
  /^\/scoreboard\/basketball-men\/d1\/\d{4}\/\d{2}\/\d{2}$/,
  /^\/brackets\/basketball-men\/d1\/\d{4}$/
];
function allowedPath(p) {
  return ALLOWED_PATHS.some(re => re.test(String(p || '')));
}

/**
 * Shape of the Firestore document written to scoreboard/{ymd}.
 * Events are passed through JSON so every `undefined` disappears: before tip-off the parser
 * leaves `winner` undefined, and the Admin SDK rejects a document containing undefined
 * ("Cannot use undefined as a Firestore value").
 */
function buildDoc(ymd, events, serverTimestamp) {
  const clean = JSON.parse(JSON.stringify(events));
  return {
    date: ymd,
    source: 'ncaa',
    fetchedAt: serverTimestamp,
    eventCount: clean.length,
    events: clean
  };
}

module.exports = { NCAA_API_BASE, TZ, FETCH_HEADERS, dateParts, shouldPoll, datesToPoll, scoreboardPath, scoreboardUrl, allowedPath, buildDoc };
