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

function stampIndex() {
  const stamp = computeStamp();
  const html = fs.readFileSync(INDEX, 'utf8');
  const next = html.replace(TAG_RE, (_, file) => `<script src="js/${file}?v=${stamp}"></script>`);
  if (next !== html) fs.writeFileSync(INDEX, next);
  return { stamp, changed: next !== html };
}

module.exports = { listJsFiles, computeStamp, scriptTags, readIndexTags, stampIndex, INDEX, JS_DIR };

if (require.main === module) {
  const { stamp, changed } = stampIndex();
  console.log(`js stamp ${stamp} (${changed ? 'index.html updated' : 'index.html already current'})`);
}
