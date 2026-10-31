#!/usr/bin/env node
// Assemble www/, the web bundle Capacitor ships inside the iOS app.
// Sources are the exact files GitHub Pages serves from ../ (nothing is forked), so the app
// and stoekmedia.com/madness always run the same code. Zero dependencies: plain Node 18+.
//
// One rewrite happens on the copy, never on the source: the Firebase SDK <script> tags that
// point at www.gstatic.com are downloaded once (pinned version URLs never change) and served
// from www/vendor/ instead. The app then launches without a round-trip to Google, and no
// executable code is fetched from the internet at runtime (App Review 2.5.2 / 4.2).
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const WEB = path.resolve(APP, '..');
const WWW = path.join(APP, 'www');
const CACHE = path.join(APP, '.vendor-cache');

// sw.js is left out on purpose: WKWebView runs no service worker for capacitor://, and
// js/90-boot.js skips registration inside the shell (isNativeShell).
const COPY = ['index.html', 'manifest.json', 'privacy.html', 'js', 'icons'];

async function vendor(url) {
  const m = url.match(/^https:\/\/www\.gstatic\.com\/(firebasejs\/[\d.]+\/[\w.-]+\.js)$/);
  if (!m) throw new Error('unexpected remote script, refusing to bundle: ' + url);
  const rel = 'vendor/' + m[1];
  const cached = path.join(CACHE, m[1]);
  if (!fs.existsSync(cached)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  const dest = path.join(WWW, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(cached, dest);
  return rel;
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

async function main() {
  fs.rmSync(WWW, { recursive: true, force: true });
  fs.mkdirSync(WWW, { recursive: true });
  for (const name of COPY) {
    const src = path.join(WEB, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(WWW, name), { recursive: true });
  }

  const indexPath = path.join(WWW, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const remote = [...html.matchAll(/<script\s+src="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
  for (const url of remote) html = html.split('"' + url + '"').join('"' + await vendor(url) + '"');
  fs.writeFileSync(indexPath, html);

  const left = html.match(/<script\s+src="https?:\/\//g);
  if (left) throw new Error(left.length + ' remote <script> tag(s) still in www/index.html');

  console.log('www/ built: ' + countFiles(WWW) + ' files, ' + remote.length + ' Firebase scripts bundled');
}

main().catch(err => { console.error('sync-www failed: ' + err.message); process.exit(1); });
