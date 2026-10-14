const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { listJsFiles, computeStamp, readIndexTags, INDEX } = require('../scripts/stamp');

test('index.html loads every js/ file, in filename order, exactly once', () => {
  const tags = readIndexTags(fs.readFileSync(INDEX, 'utf8'));
  assert.deepEqual(tags.map(t => t.file), listJsFiles());
});

test('index.html script tags carry the current content hash (run `node scripts/stamp.js` to fix)', () => {
  const expected = computeStamp();
  const tags = readIndexTags(fs.readFileSync(INDEX, 'utf8'));
  for (const t of tags) {
    assert.equal(t.stamp, expected, t.file + ' is stamped ' + t.stamp + ' but js/ hashes to ' + expected + '. Run: node scripts/stamp.js');
  }
});

test('js/ files are classic scripts: no import/export statements', () => {
  for (const f of listJsFiles()) {
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'js', f), 'utf8');
    assert.doesNotMatch(src, /^\s*(import|export)\s/m, f + ' must not be an ES module (inline onclick handlers need globals)');
  }
});
