#!/usr/bin/env node
/*
 * Madness version stamp.
 *
 * sw.js serves every non-HTML asset cache-first, so a changed js/ file would
 * never reach an installed PWA unless its URL changes. index.html is
 * network-first, so we bust the cache by appending ?v=<hash> to each
 * <script src="js/..."> tag, where <hash> is derived from the js/ contents.
 *
 *   node scripts/stamp.js          # rewrite index.html with the current hash
 *   node --test test/              # fails if index.html is out of date
 *
 * After a merge that conflicts only on the stamped <script> tags, running it again
 * resolves that conflict block (see resolveStampConflicts).
 *
 * Zero dependencies by design.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const INDEX = path.join(ROOT, 'index.html');

function listJsFiles() {
  return fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();
}

function computeStamp() {
  const h = crypto.createHash('sha256');
  for (const f of listJsFiles()) {
    h.update(f + '\n');
    // normalise line endings so the hash is identical on Windows (autocrlf) and Linux checkouts
    h.update(fs.readFileSync(path.join(JS_DIR, f), 'utf8').replace(/\r\n/g, '\n'));
  }
  return h.digest('hex').slice(0, 10);
}

function scriptTags(stamp) {
  return listJsFiles().map(f => `<script src="js/${f}?v=${stamp}"></script>`).join('\n');
}

const TAG_RE = /<script src="js\/([^"?]+)\?v=([0-9a-f]+)"><\/script>/g;

function readIndexTags(html) {
  const out = [];
  let m;
  while ((m = TAG_RE.exec(html)) !== null) out.push({ file: m[1], stamp: m[2] });
  return out;
}

const TAG_LINE_RE = /^<script src="js\/[^"?]+\?v=[0-9a-f]+"><\/script>$/;
// git conflict block; the optional middle part is the diff3 "base" section.
const CONFLICT_RE = /<<<<<<< [^\n]*\r?\n([\s\S]*?)(?:\|\|\|\|\|\|\| [^\n]*\r?\n[\s\S]*?)?=======\r?\n([\s\S]*?)>>>>>>> [^\n]*\r?\n/g;

/*
 * Every branch that touches js/ restamps the same script tags, so merging two such branches
 * leaves a conflict block around them and nothing else. If a conflict block holds only js/
 * script tags (and blank lines) on both sides, replace it with freshly generated tags; any
 * other conflict is left for a human.
 */
function resolveStampConflicts(html, stamp) {
  const onlyTags = part => part.split(/\r?\n/).every(l => l.trim() === '' || TAG_LINE_RE.test(l.trim()));
  return html.replace(CONFLICT_RE, (whole, ours, theirs) =>
    onlyTags(ours) && onlyTags(theirs) ? scriptTags(stamp) + '\n' : whole);
}

function stampIndex() {
  const stamp = computeStamp();
  const html = fs.readFileSync(INDEX, 'utf8');
  const next = resolveStampConflicts(html, stamp)
    .replace(TAG_RE, (_, file) => `<script src="js/${file}?v=${stamp}"></script>`);
  if (next !== html) fs.writeFileSync(INDEX, next);
  return { stamp, changed: next !== html };
}

module.exports = { listJsFiles, computeStamp, scriptTags, readIndexTags, resolveStampConflicts, stampIndex, INDEX, JS_DIR };

if (require.main === module) {
  const { stamp, changed } = stampIndex();
  console.log(`js stamp ${stamp} (${changed ? 'index.html updated' : 'index.html already current'})`);
}
