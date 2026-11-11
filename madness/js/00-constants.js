// App display name, used by the lobby/join/header <h1> and the share/notification titles.
// Store name decided 2026-10-31: "Madness Draft" (never "March Madness", an NCAA mark). Change it here, once.
const APP_NAME = 'Madness Draft';
const APP_NAME_ACCENT = 'Madness'; // the leading part of APP_NAME the <h1> highlights
function appTitleHTML(){
  const i = APP_NAME.startsWith(APP_NAME_ACCENT) ? APP_NAME_ACCENT.length : APP_NAME.length;
  return '<h1><span>' + escapeHtml(APP_NAME.slice(0, i)) + '</span>' + escapeHtml(APP_NAME.slice(i)) + '</h1>';
}
// Inside a Capacitor shell (see docs/ios-app-store-plan.md) the web code is bundled in the app. Declared here,
// not in 90-boot.js, because the first render() runs before 90-boot.js reaches its later declarations.
const isNativeShell = !!(typeof window !== 'undefined' && window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
// Invite links always point at the website: it serves everyone, and opens the app instead for people who have it
// (universal links, /.well-known/apple-app-site-association at the site root).
const SITE_URL = 'https://stoekmedia.com/madness/';
const APP_STORE_URL = 'https://apps.apple.com/app/id6829126016';
// The tournament a room plays for. The title game is in early April, so from May on a new room is
// for next March's bracket, not the one that just finished (and would import with every result known).
function tournamentYear(now = new Date()){ return now.getMonth() >= 4 ? now.getFullYear() + 1 : now.getFullYear(); }
const RN = {1:"Round of 64", 2:"Round of 32", 3:"Sweet 16", 4:"Elite 8", 5:"Final Four", 6:"Championship"};
// iPadOS 13+ sends a Macintosh user agent; the touch-point check catches it.
const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const REGIONS = ["South","East","Midwest","West"];
const SEEDS = Array.from({length:16}, (_,i) => i+1);
const R1_SEEDS = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];
const FEEDERS = {8:[0,1], 9:[2,3], 10:[4,5], 11:[6,7], 12:[8,9], 13:[10,11], 14:[12,13]};

const generateId = () => crypto.randomUUID();

// localStorage key for the cached copy of S. One key per room so entering room B never shows or
// uploads room A's players and picks; "mm4" is kept for offline play (no room).
const stateKey = () => roomId ? 'mm4_state_' + roomId : 'mm4';

