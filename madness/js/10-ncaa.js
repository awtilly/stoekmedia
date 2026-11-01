/* ── NCAA.com data (scores, bracket) ──
 * Source: ncaa-api (https://github.com/henrygd/ncaa-api, MIT), a JSON mirror of ncaa.com's own feeds.
 * Phones never call it directly: the public instance sends no CORS headers and is rate-limited, so every
 * request goes through our `ncaa` Cloud Function (functions/ncaa.js), which only forwards the two routes
 * below and caches for 30 s. Live scores normally arrive via the scoreboard/{date} Firestore doc that
 * pollScoreboard writes once a minute (js/20-live.js); this module is the fallback poll and the bracket import.
 * No team logos: scores, names and seeds are facts; logos are the schools' marks. */
const NCAA_API_BASE = 'https://us-central1-march-madness-snake-draft.cloudfunctions.net/ncaa';

const ncaa = {
  /** YYYYMMDD -> YYYY/MM/DD (the ncaa.com URL form). */
  datePath(dateStr) {
    const d = String(dateStr || '');
    return d.slice(0, 4) + '/' + d.slice(4, 6) + '/' + d.slice(6, 8);
  },

  async _get(path) {
    try {
      const r = await fetch(NCAA_API_BASE + path);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      console.warn('NCAA fetch failed:', path, e);
      return null;
    }
  },

  /** Scoreboard for one day. Returns the raw payload ({ games: [...] }) or null on any failure. */
  async fetchScoreboard(date) {
    const n = new Date();
    const dateStr = date || (n.getFullYear() + String(n.getMonth()+1).padStart(2,'0') + String(n.getDate()).padStart(2,'0'));
    return this._get('/scoreboard/basketball-men/d1/' + this.datePath(dateStr));
  },

  /** Tournament bracket for a year. Returns the raw payload ({ championships: [...] }) or null. */
  async fetchBracket(year) {
    return this._get('/brackets/basketball-men/d1/' + encodeURIComponent(year));
  },

  /* The ncaa.com bracket feed: championships[0].games, one per game, bracketId 1xx First Four, 2xx first round,
   * 3xx second round ... 7xx final; sectionId 2-5 are the four regions (regions[] carries their titles, in a
   * different order every year), 1 is the First Four, 6 the Final Four. A First Four game's
   * victorBracketPositionId is the bracketPositionId of the first-round game its winner plays in. */
  bracketGames(data) {
    const champ = data && Array.isArray(data.championships) ? data.championships[0] : null;
    return champ && Array.isArray(champ.games) ? champ : null;
  },

  regionBySection(champ) {
    const map = {};
    for (const r of (champ.regions || [])) {
      const title = String(r.title || '').trim().toLowerCase();
      const region = REGIONS.find(x => x.toLowerCase() === title);
      if (region) map[r.sectionId] = region;
    }
    return map;
  },

  isFinal(g) {
    return String(g.gameState || '').toUpperCase() === 'F' || String(g.statusCodeDisplay || '').toLowerCase() === 'final';
  },

  teamEntry(t) {
    return { name: t.nameShort || t.nameFull || '', abbr: '', ncaaId: t.seoname || '', logo: '', color: '', record: '' };
  },

  /** All 64 first-round slots with seed and region; a slot still waiting on a First Four game becomes one
   * unresolved play-in entry carrying both teams. [] when the bracket is not published yet. */
  async fetchTournamentTeams() {
    const champ = this.bracketGames(await this.fetchBracket(S.year));
    if (!champ) return [];
    const regionOf = this.regionBySection(champ);
    const firstFour = champ.games.filter(g => Math.floor(g.bracketId / 100) === 1);
    const result = [];
    const seen = new Set();
    for (const g of champ.games) {
      if (Math.floor(g.bracketId / 100) !== 2) continue; // first round only
      const region = regionOf[g.sectionId];
      if (!region) continue;
      for (const t of (g.teams || [])) {
        const seed = parseInt(t.seed, 10);
        if (!(seed >= 1 && seed <= 16)) continue;
        const key = seed + '_' + region;
        if (seen.has(key)) continue;
        const ff = firstFour.find(f => f.victorBracketPositionId === g.bracketPositionId
          && (f.teams || []).some(x => parseInt(x.seed, 10) === seed));
        let entry = null;
        if (ff) {
          const winner = this.isFinal(ff) ? (ff.teams || []).find(x => x.isWinner) : null;
          if (winner) entry = Object.assign({ seed, region }, this.teamEntry(winner));
          else if ((ff.teams || []).length === 2) {
            const pair = ff.teams.map(x => this.teamEntry(x));
            entry = { name: pair.map(p => p.name).join(' / '), seed, region, logo: '', abbr: '', ncaaId: '', color: '', record: '',
              playIn: true, playInResolved: false, playInTeams: pair };
          }
        }
        if (!entry) {
          if (!t.nameShort && !t.nameFull) continue; // TBD slot with no First Four game behind it: leave for the sanity check
          entry = Object.assign({ seed, region }, this.teamEntry(t));
        }
        seen.add(key);
        result.push(entry);
      }
    }
    return result.sort((a, b) => {
      const ri = REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region);
      return ri !== 0 ? ri : a.seed - b.seed;
    });
  },

  /** Decided First Four games: [{ ncaaIds: [a, b], winner: ncaaId }]. */
  firstFourWinners(data) {
    const champ = this.bracketGames(data);
    if (!champ) return [];
    const out = [];
    for (const g of champ.games) {
      if (Math.floor(g.bracketId / 100) !== 1 || !this.isFinal(g)) continue;
      const teams = (g.teams || []).filter(t => t.seoname);
      const w = teams.find(t => t.isWinner);
      if (teams.length === 2 && w) out.push({ ncaaIds: teams.map(t => t.seoname), winner: w.seoname });
    }
    return out;
  },

  /* Identical to functions/ncaa-parse.js (a test keeps them in sync). Input is the ncaa-api scoreboard payload;
   * output is one event per game in the shape the rest of the app has always consumed: state 'pre'|'in'|'post',
   * completed, away/home with name/abbr/score/seed/winner/ncaaId. Only NCAA tournament games carry
   * bracketId/championshipId; `tournament` is the flag checkGameFinals keys off. */
  parseScoreboard(data) {
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
};
