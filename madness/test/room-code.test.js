const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

test('sanitizeRoomCode: upper-cases and keeps letters and digits only', () => {
  const app = createApp();
  assert.equal(app.sanitizeRoomCode('buckets 2027'), 'BUCKETS2027');
  assert.equal(app.sanitizeRoomCode('  abc  '), 'ABC');
});

test('sanitizeRoomCode: strips HTML, path separators and quotes', () => {
  const app = createApp();
  assert.equal(app.sanitizeRoomCode('<img src=x onerror=alert(1)>'), 'IMGSRCXONERRORALERT1');
  assert.equal(app.sanitizeRoomCode("rooms/evil' \"x"), 'ROOMSEVILX');
});

test('sanitizeRoomCode: rejects codes shorter than 2 and truncates longer than 20', () => {
  const app = createApp();
  assert.equal(app.sanitizeRoomCode('a'), '');
  assert.equal(app.sanitizeRoomCode(''), '');
  assert.equal(app.sanitizeRoomCode(null), '');
  assert.equal(app.sanitizeRoomCode(undefined), '');
  assert.equal(app.sanitizeRoomCode('/'), '');
  assert.equal(app.sanitizeRoomCode('abcdefghijklmnopqrstuvwxyz').length, 20);
});

test('escapeHtml: neutralises the characters that matter in attribute and text context', () => {
  const app = createApp();
  assert.equal(app.escapeHtml('<b a="1">&\'</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
});
