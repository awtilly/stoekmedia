/*
 * Loads the pure-logic subset of js/ into this Node process so the functions
 * can be unit tested without a browser or Firebase.
 *
 * Files loaded: 00-constants, 10-espn, 20-live, 60-rooms, 70-logic. They are classic
 * scripts, so they are evaluated once with vm.runInThisContext (top-level
 * function declarations land on globalThis, exactly like a browser). Everything
 * they reach for at call time (S, requireAdmin, saveState, render, showToast,
 * appChoice, document, fetch) is a stub on globalThis that createApp() resets
 * for every test.
 *
 * node:test runs each *.test.js file in its own process, so files never see
 * each other's globals.
 *
 * Run:  node --test "test/*.test.js"
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.resolve(__dirname, '..', 'js');
const LOGIC_FILES = ['00-constants.js', '10-espn.js', '20-live.js', '60-rooms.js', '70-logic.js'];

const REGIONS = ['South', 'East', 'Midwest', 'West'];

function emptyBracket() {
  return {
    South: Array(15).fill(null),
    East: Array(15).fill(null),
    Midwest: Array(15).fill(null),
    West: Array(15).fill(null),
    ff: Array(3).fill(null)
  };
}

/** 64 teams, ids like "South-1", espnIds like "e-South-1". */
function makeTeams() {
  const teams = [];
  for (const region of REGIONS) {
    for (let seed = 1; seed <= 16; seed++) {
      teams.push({
        id: region + '-' + seed,
        name: region + ' ' + seed,
        seed,
        region,
        espnId: 'e-' + region + '-' + seed,
        abbr: region.slice(0, 2).toUpperCase() + seed,
        logo: '',
        record: ''
      });
    }
  }
  return teams;
}

function freshState(overrides) {
  return Object.assign({
    phase: 'draft',
    year: 2027,
    players: [],
    teams: makeTeams(),
    games: [],
    ds: { order: [], cp: 0, started: false, complete: false },
    rp: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 },
    ub: true,
    bracket: emptyBracket(),
    bracketRegion: 'South',
    fr: 'All',
    fs: 'All',
    liveScoresDate: '',
    liveScoresFilter: 'all'
  }, overrides || {});
}

let loaded = false;
let lexicals = null; // top-level const/let bindings are not globalThis properties; capture them once

function loadOnce() {
  if (loaded) return;
  globalThis.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } };
  globalThis.window = globalThis.window || {};
  globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  for (const f of LOGIC_FILES) {
    const code = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  }
  lexicals = vm.runInThisContext('({ espn, RN, REGIONS, SEEDS, R1_SEEDS, FEEDERS, generateId })');
  loaded = true;
}

/**
 * Returns an "app" handle. Functions are reached as app.<name>; app.S is the
 * live state object the functions read; app.__calls records stub activity.
 * Assigning app.fetch / app.requireAdmin etc. overrides the stub for that test.
 */
function createApp(stateOverrides) {
  loadOnce();
  const calls = { saveState: 0, render: 0, toasts: [], requireAdmin: 0, goHome: 0 };
  globalThis.S = freshState(stateOverrides);
  globalThis.roomId = null;
  globalThis.db = null;
  globalThis.firebase = null;
  globalThis.requireAdmin = async () => { calls.requireAdmin++; return true; };
  globalThis.saveState = () => { calls.saveState++; };
  globalThis.render = () => { calls.render++; };
  globalThis.showToast = (m) => { calls.toasts.push(m); };
  globalThis.appChoice = async () => null;
  globalThis.goHome = () => { calls.goHome++; globalThis.roomId = null; };
  globalThis.updateAppBadge = () => {};
  globalThis.initFCM = async () => {};
  globalThis.fetch = async () => { throw new Error('fetch not stubbed for this test'); };

  const app = new Proxy({}, {
    get(_, key) {
      if (key === 'eval') return (expr) => vm.runInThisContext(expr); // read top-level let/const live, e.g. app.eval('liveScores')
      if (key === '__calls') return calls;
      if (key in lexicals) return lexicals[key];
      return globalThis[key];
    },
    set(_, key, value) { globalThis[key] = value; return true; }
  });
  return app;
}

/** Build a parsed-scoreboard-style final the way espn.parseScoreboardEvents would. */
function finalGame(awayTeam, homeTeam, winner) {
  const mk = (t, won) => ({
    name: t.name, abbr: t.abbr, logo: '', score: won ? '80' : '70', seed: t.seed, record: '',
    homeAway: t === awayTeam ? 'away' : 'home', winner: won, espnId: t.espnId, color: ''
  });
  return {
    id: 'g-' + awayTeam.id + '-' + homeTeam.id,
    name: awayTeam.name + ' at ' + homeTeam.name,
    date: '2027-03-18T17:00Z',
    state: 'post', completed: true, statusName: 'STATUS_FINAL', detail: 'Final', shortDetail: 'Final',
    clock: '0:00', period: 2, note: '', broadcast: '', venue: '',
    away: mk(awayTeam, winner === awayTeam),
    home: mk(homeTeam, winner === homeTeam)
  };
}

module.exports = { createApp, freshState, makeTeams, emptyBracket, finalGame, REGIONS, LOGIC_FILES };
