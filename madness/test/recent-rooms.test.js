const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* getRecentRooms() lives in js/60-rooms.js, which the harness does not load (Firestore at top
 * level), so just that function is evaluated on top of the harness globals. */
function appWithRecent(stored) {
  const app = createApp();
  const m = new Map([['mm4_rooms', JSON.stringify(stored)]]);
  app.localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '60-rooms.js'), 'utf8');
  const start = src.indexOf('function getRecentRooms');
  const end = src.indexOf('function saveRecentRoom');
  assert.ok(start > 0 && end > start, 'could not locate getRecentRooms');
  vm.runInThisContext(src.slice(start, end), { filename: '60-rooms.js#getRecentRooms' });
  return app;
}

test('recent rooms keep clean codes, in order, capped at five', () => {
  const app = appWithRecent([{ code: 'ALPHA' }, { code: 'B2' }, { code: 'C3' }, { code: 'D4' }, { code: 'E5' }, { code: 'F6' }]);
  assert.deepEqual(app.getRecentRooms().map(r => r.code), ['ALPHA', 'B2', 'C3', 'D4', 'E5']);
});

test('a code stored before sanitisation that would break out of the onclick string is dropped', () => {
  const app = appWithRecent([
    { code: "');alert(1);('" }, { code: 'GOOD1' }, { code: '<img src=x onerror=alert(1)>' }, { code: 'a-b' }, { code: 'X' }, { code: 42 }, null
  ]);
  assert.deepEqual(app.getRecentRooms().map(r => r.code), ['GOOD1']);
});

test('lower-case or padded codes (never produced by the app) are not shown either', () => {
  const app = appWithRecent([{ code: 'abc' }, { code: ' ABC ' }, { code: 'ABC' }]);
  assert.deepEqual(app.getRecentRooms().map(r => r.code), ['ABC']);
});
