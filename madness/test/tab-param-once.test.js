const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* js/90-boot.js runs on load and needs the whole app, so only its opening lines are run here: the part that
 * reads the address and tidies it, up to the comment that starts the room lookup. */
const src = fs.readFileSync(path.join(__dirname, '..', 'js', '90-boot.js'), 'utf8');
const head = src.slice(0, src.indexOf('// Home-screen shortcuts'));

function boot(address) {
  const location = new URL(address);
  const remembered = [];
  const sb = {
    URL, URLSearchParams,
    window: { location, history: { replaceState: (s, t, url) => { location.href = String(url); } } },
    sanitizeRoomCode: raw => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    rememberJoinKey: (code, key) => remembered.push(code + ':' + key)
  };
  vm.runInNewContext(head + '\n;__out = { tabParam, urlRoom };', sb);
  return { search: location.search, out: sb.__out, remembered };
}

test('the opening lines of 90-boot.js were found', () => {
  assert.ok(head.includes('const tabParam') && head.length < src.length);
});

test('the tab a shortcut asks for is read, then taken out of the address so a reload does not force it again', () => {
  const r = boot('https://example.test/madness/?tab=live');
  assert.equal(r.out.tabParam, 'live', 'still used for this start');
  assert.equal(r.search, '');
});

test('the room stays in the address; the invite code and the tab leave it', () => {
  const r = boot('https://example.test/madness/?room=POOL1&key=ABCD2345&tab=bracket');
  assert.equal(r.out.tabParam, 'bracket');
  assert.equal(r.out.urlRoom, 'POOL1');
  assert.equal(r.search, '?room=POOL1');
  assert.deepEqual(r.remembered, ['POOL1:ABCD2345']);
});

test('an address without a tab is left alone', () => {
  assert.equal(boot('https://example.test/madness/?room=POOL1').search, '?room=POOL1');
});
