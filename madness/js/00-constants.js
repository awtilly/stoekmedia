const RN = {1:"Round of 64", 2:"Round of 32", 3:"Sweet 16", 4:"Elite 8", 5:"Final Four", 6:"Championship"};
const REGIONS = ["South","East","Midwest","West"];
const SEEDS = Array.from({length:16}, (_,i) => i+1);
const R1_SEEDS = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];
const FEEDERS = {8:[0,1], 9:[2,3], 10:[4,5], 11:[6,7], 12:[8,9], 13:[10,11], 14:[12,13]};

const generateId = () => crypto.randomUUID();

