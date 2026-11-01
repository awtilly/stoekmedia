/*
 * Server-side copy of ncaa.parseScoreboard from ../js/10-ncaa.js.
 * Pure function, no Firebase imports, so it can be unit tested from ../test.
 * test/scoreboard-cache.test.js asserts both copies produce identical output.
 * If you change one, change the other.
 *
 * Input: the JSON that ncaa-api (https://github.com/henrygd/ncaa-api, MIT) returns for
 * GET /scoreboard/basketball-men/d1/YYYY/MM/DD, which mirrors ncaa.com's own scoreboard feed:
 *   { games: [ { game: { gameID, gameState: 'pre'|'live'|'final', currentPeriod, contestClock,
 *                        startTime, startTimeEpoch, network, bracketId, bracketRound, championshipId,
 *                        championshipGame: { round: { title } },
 *                        away: { score, seed, winner, names: { short, char6, seo } }, home: {...} } } ] }
 * Output: one event per game in the shape the rest of the app has always consumed (state 'pre'|'in'|'post',
 * completed, away/home with name/abbr/score/seed/winner/ncaaId). Only NCAA tournament games carry
 * bracketId/championshipId; `tournament` is the flag checkGameFinals keys off.
 */
function parseScoreboard(data) {
  if (!data || !Array.isArray(data.games)) return [];
  return data.games.map(w => {
    const g = w && w.game;
    if (!g) return null;
    const side = (t, homeAway) => {
      t = t || {};
      const names = t.names || {};
      const seed = parseInt(t.seed, 10);
      return {
        name: names.short || names.full || '',
        abbr: names.char6 || '',
        logo: '',
        score: t.score == null ? '' : String(t.score),
        seed: seed > 0 ? seed : undefined,
        record: '',
        homeAway,
        winner: t.winner === true ? true : (t.winner === false ? false : undefined),
        ncaaId: names.seo || '',
        color: ''
      };
    };
    const away = side(g.away, 'away');
    const home = side(g.home, 'home');
    if (!away.name || !home.name) return null; // fewer than two teams: nothing to show or score

    const gs = String(g.gameState || '').toLowerCase();
    // ncaa.com: pre | live | final. Postponed/cancelled games are listed under Final for display but never
    // become a completed final (no winner), so checkGameFinals never crowns anyone by default.
    const state = gs === 'final' || gs === 'postponed' || gs === 'cancelled' || gs === 'canceled' ? 'post'
      : gs === 'live' || gs === 'in' || gs === 'in-progress' || gs === 'inprogress' ? 'in' : 'pre';

    let completed = gs === 'final';
    if (completed && !!away.winner === !!home.winner) {
      // no single winner flag: take it from the score; a tie or missing score is not a decided final
      const a = parseInt(away.score, 10), h = parseInt(home.score, 10);
      if (a > h) { away.winner = true; home.winner = false; }
      else if (h > a) { home.winner = true; away.winner = false; }
      else completed = false;
    }
    if (!completed) { away.winner = undefined; home.winner = undefined; }

    const tournament = !!(g.bracketId || g.bracketRound || g.championshipId);
    const roundTitle = g.championshipGame && g.championshipGame.round && g.championshipGame.round.title || '';
    const periodNum = parseInt(String(g.currentPeriod || ''), 10);
    const epoch = parseInt(g.startTimeEpoch, 10);
    const liveDetail = [g.currentPeriod, g.contestClock].filter(Boolean).join(' ').trim();

    return {
      id: String(g.gameID || ''),
      name: away.name + ' at ' + home.name,
      date: epoch > 0 ? new Date(epoch * 1000).toISOString() : '',
      startTime: g.startTime || '',
      state,
      statusName: gs.toUpperCase(),
      detail: state === 'in' ? liveDetail : state === 'post' ? (g.finalMessage || 'FINAL') : (g.startTime || ''),
      shortDetail: state === 'in' ? liveDetail : state === 'post' ? (g.finalMessage || 'FINAL') : (g.startTime || ''),
      clock: g.contestClock || '',
      period: periodNum > 0 ? periodNum : 0,
      completed,
      tournament,
      note: tournament ? 'NCAA Tournament' + (roundTitle ? ' - ' + roundTitle : '') : '',
      broadcast: g.network || '',
      venue: '',
      away,
      home
    };
  }).filter(Boolean);
}

module.exports = { parseScoreboard };
