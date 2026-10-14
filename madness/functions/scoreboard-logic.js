/*
 * Pure helpers for the pollScoreboard scheduled function. No Firebase imports
 * so they can be unit tested from ../test without installing functions deps.
 */
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const TZ = 'America/New_York';

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
 * Decide whether this tick should hit ESPN.
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

function scoreboardUrl(ymd) {
  return `${ESPN_BASE}/scoreboard?dates=${ymd}&limit=200`;
}

/** Shape of the Firestore document written to scoreboard/{ymd}. */
function buildDoc(ymd, events, serverTimestamp) {
  return {
    date: ymd,
    source: 'espn',
    fetchedAt: serverTimestamp,
    eventCount: events.length,
    events
  };
}

module.exports = { ESPN_BASE, TZ, dateParts, shouldPoll, datesToPoll, scoreboardUrl, buildDoc };
