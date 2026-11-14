const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* Without a <link rel="icon"> the browser asks for /favicon.ico at the top of the site, which does not exist:
 * no icon on the tab, in bookmarks or in history, and a failed request on every visit. */
test('index.html names a tab icon and the file is there', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const m = html.match(/<link rel="icon"[^>]*href="([^"]+)"/);
  assert.ok(m, 'a <link rel="icon"> is present');
  assert.ok(!/^(https?:)?\//.test(m[1]), 'relative, so it also works inside the iOS app');
  assert.ok(fs.statSync(path.join(root, m[1])).size > 0, m[1] + ' exists');
});
