/* ── ESPN API ── */
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';

const espn = {
  async fetchScoreboard(date) {
    const n = new Date();
    const dateStr = date || (n.getFullYear() + String(n.getMonth()+1).padStart(2,'0') + String(n.getDate()).padStart(2,'0'));
    const url = `${ESPN_BASE}/scoreboard?dates=${dateStr}&limit=200`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch(e) {
      console.warn('ESPN scoreboard fetch failed:', e);
      return null;
    }
  },

  async fetchTournamentTeams() {
    // Fetch first round days to get all 64 teams with seeds and regions
    const year = S.year;
    // We search around typical first round dates (mid-March Thu/Fri)
    // Try multiple date ranges to find the tournament
    const candidates = [];
    for (let d = 14; d <= 25; d++) {
      candidates.push(`${year}03${String(d).padStart(2,'0')}`);
    }
    // Also try the current scoreboard with seasontype=3
    const allTeams = {};

    function _extractTeams(data) {
      for (const ev of (data.events || [])) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const notes = comp.notes || [];
        const note = notes[0]?.headline || '';
        // STRICT: must be an NCAA Championship game, not a conference tournament.
        // Old loose `note.includes('East')` matched "Big East Tournament", "Big West",
        // "Southland", "Mountain West", etc. and injected phantom bracket teams.
        if (!note.includes('NCAA') || !note.includes('Championship')) continue;
        const regionMatch = note.match(/(South|East|Midwest|West) Region/);
        if (!regionMatch) continue; // skips Final Four / National Championship (no region in headline)
        const region = regionMatch[1];
        for (const c of (comp.competitors || [])) {
          const team = c.team || {};
          const seed = c.curatedRank?.current;
          if (!seed || seed > 16) continue;
          const name = team.shortDisplayName || team.displayName || team.name || '';
          if (!name) continue;
          const key = `${name}_${seed}_${region}`;
          if (!allTeams[key]) {
            allTeams[key] = { name, seed, region, logo: team.logo || '', abbr: team.abbreviation || '', espnId: team.id || '', color: team.color || '', record: c.records?.[0]?.summary || '' };
          }
        }
      }
    }

    // Fetch all dates in parallel
    const results = await Promise.allSettled(
      candidates.map(dateStr =>
        fetch(`${ESPN_BASE}/scoreboard?dates=${dateStr}&limit=200`).then(r => r.ok ? r.json() : null)
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) _extractTeams(r.value);
    }
    // Detect play-in pairs: same seed + region, different team name
    const teamsList = Object.values(allTeams);
    const bySlot = {};
    for (const t of teamsList) {
      const key = `${t.seed}_${t.region}`;
      if (!bySlot[key]) bySlot[key] = [];
      bySlot[key].push(t);
    }
    const result = [];
    for (const key in bySlot) {
      const group = bySlot[key];
      if (group.length === 2) {
        result.push({
          name: `${group[0].name} / ${group[1].name}`,
          seed: group[0].seed,
          region: group[0].region,
          logo: '',
          abbr: '',
          espnId: '',
          color: '',
          record: '',
          playIn: true,
          playInResolved: false,
          playInTeams: group.map(g => ({
            name: g.name, logo: g.logo, abbr: g.abbr,
            espnId: g.espnId, color: g.color, record: g.record
          }))
        });
      } else {
        result.push(...group);
      }
    }
    return result.sort((a,b) => {
      const ri = REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region);
      return ri !== 0 ? ri : a.seed - b.seed;
    });
  },

  parseScoreboardEvents(data) {
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
};

