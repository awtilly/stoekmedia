// App display name, used by the lobby/join/header <h1> and the share/notification titles. The store-facing
// name is still an open decision (no "March Madness" in App Store listings): change it here, once.
const APP_NAME = 'March Madness Draft';
const APP_NAME_ACCENT = 'March Madness'; // the leading part of APP_NAME the <h1> highlights
function appTitleHTML(){
  const i = APP_NAME.startsWith(APP_NAME_ACCENT) ? APP_NAME_ACCENT.length : APP_NAME.length;
  return '<h1><span>' + escapeHtml(APP_NAME.slice(0, i)) + '</span>' + escapeHtml(APP_NAME.slice(i)) + '</h1>';
}
const RN = {1:"Round of 64", 2:"Round of 32", 3:"Sweet 16", 4:"Elite 8", 5:"Final Four", 6:"Championship"};
const REGIONS = ["South","East","Midwest","West"];
const SEEDS = Array.from({length:16}, (_,i) => i+1);
const R1_SEEDS = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];
const FEEDERS = {8:[0,1], 9:[2,3], 10:[4,5], 11:[6,7], 12:[8,9], 13:[10,11], 14:[12,13]};
const GAME_ROUND = {};
for(let i=0; i<8; i++) GAME_ROUND[i] = 1;
for(let i=8; i<12; i++) GAME_ROUND[i] = 2;
GAME_ROUND[12] = 3; GAME_ROUND[13] = 3; GAME_ROUND[14] = 4;

const generateId = () => crypto.randomUUID();

