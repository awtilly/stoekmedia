const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { listJsFiles, computeStamp, readIndexTags, resolveStampConflicts, scriptTags, INDEX } = require('../scripts/stamp');

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

const tag = (v, f = '00-constants.js') => '<script src="js/' + f + '?v=' + v + '"></script>';
const LF = '\n';

test('resolveStampConflicts collapses a conflict block made only of stamped script tags', () => {
  const ours = tag('aaaaaaaaaa') + LF + tag('aaaaaaaaaa', '10-espn.js') + LF;
  const theirs = tag('bbbbbbbbbb') + LF + tag('bbbbbbbbbb', '10-espn.js') + LF;
  const html = '<head>' + LF + '<<<<<<< HEAD' + LF + ours + '=======' + LF + theirs + '>>>>>>> madness/other' + LF + '</head>' + LF;
  const out = resolveStampConflicts(html, 'cafecafe00');
  assert.doesNotMatch(out, /<<<<<<<|=======|>>>>>>>/);
  assert.equal(out, '<head>' + LF + scriptTags('cafecafe00') + LF + '</head>' + LF);
});

test('resolveStampConflicts handles diff3 style and CRLF, and leaves real conflicts alone', () => {
  const CRLF = '\r\n';
  const diff3 = '<<<<<<< HEAD' + CRLF + tag('aaaaaaaaaa') + CRLF + '||||||| base' + CRLF + tag('0000000000') + CRLF +
    '=======' + CRLF + tag('bbbbbbbbbb') + CRLF + '>>>>>>> x' + CRLF;
  assert.doesNotMatch(resolveStampConflicts(diff3, 'cafecafe00'), /<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>/);

  const real = '<<<<<<< HEAD' + LF + '<p>ours</p>' + LF + '=======' + LF + '<p>theirs</p>' + LF + '>>>>>>> x' + LF;
  assert.equal(resolveStampConflicts(real, 'cafecafe00'), real, 'non-tag conflicts are untouched');

  const mixed = '<<<<<<< HEAD' + LF + tag('aaaaaaaaaa') + LF + '<p>ours</p>' + LF + '=======' + LF + tag('bbbbbbbbbb') + LF + '>>>>>>> x' + LF;
  assert.equal(resolveStampConflicts(mixed, 'cafecafe00'), mixed, 'a side with extra content is untouched');
});
