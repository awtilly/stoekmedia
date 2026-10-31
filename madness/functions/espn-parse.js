/*
 * Server-side copy of espn.parseScoreboardEvents from ../js/10-espn.js.
 * Pure function, no Firebase imports, so it can be unit tested from ../test.
 * test/scoreboard-cache.test.js asserts both copies produce identical output.
 * If you change one, change the other.
 */
function parseScoreboardEvents(data) {
  if (!data || !data.events) return [];
  return data.events.map(ev => {
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    const status = comp.status || ev.status || {};
    const statusType = status.type || {};
    const notes = comp.notes || [];
    const note = notes[0]?.headline || '';
    const broadcasts = comp.broadcasts || [];
    const broadcast = broadcasts[0]?.names?.[0] || '';

    const teams = (comp.competitors || []).map(c => {
      const t = c.team || {};
      return {
        name: t.shortDisplayName || t.displayName || '',
        abbr: t.abbreviation || '',
        logo: t.logo || '',
        score: c.score || '',
        seed: c.curatedRank?.current,
        record: c.records?.[0]?.summary || '',
        homeAway: c.homeAway,
        winner: c.winner,
        espnId: t.id || '',
        color: t.color || ''
      };
    });

    // Put away team first (top), home team second (bottom) for display
    const away = teams.find(t => t.homeAway === 'away') || teams[0];
    const home = teams.find(t => t.homeAway === 'home') || teams[1];

    return {
      id: ev.id,
      name: ev.shortName || ev.name,
      date: ev.date,
      state: statusType.state || 'pre', // pre, in, post
      statusName: statusType.name || '',
      detail: statusType.detail || statusType.shortDetail || '',
      shortDetail: statusType.shortDetail || '',
      clock: status.displayClock || '',
      period: status.period || 0,
      completed: statusType.completed || false,
      note,
      broadcast,
      venue: comp.venue?.fullName || '',
      away,
      home
    };
  }).filter(Boolean);
}

module.exports = { parseScoreboardEvents };
