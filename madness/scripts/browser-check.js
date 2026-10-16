#!/usr/bin/env node
/*
 * Runs every test/browser/*.html check in headless Chrome and reports the "#out" lines.
 * Zero dependencies: serves the repo over Node's http module (no stray python servers),
 * launches Chrome with --dump-dom, exits 1 if any line is not "ok".
 *
 *   node scripts/browser-check.js            # all checks
 *   node scripts/browser-check.js live-diff  # only files whose name contains the argument
 *   CHROME="C:/path/to/chrome.exe" node scripts/browser-check.js
 *   UA=iphone node scripts/browser-check.js  # iPhone user agent for every page
 *
 * A page that needs the iPhone user agent declares it with the text "browser-check: ua=iphone"
 * anywhere in its HTML (a comment is fine); the runner then sets it for that page only.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');            // repo root (serves /madness/...)
const DIR = path.resolve(__dirname, '..', 'test', 'browser');
const filter = process.argv[2] || '';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  return candidates.find(p => fs.existsSync(p));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(ROOT, urlPath);
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function runOne(chrome, url, file) {
  // Chrome's helper processes inherit stdout and outlive the browser process, so a piped
  // execFileSync never returns. Give Chrome a real file descriptor instead (verified 2026-10-16).
  const os = require('os');
  const { spawn } = require('child_process');
  const tmp = path.join(os.tmpdir(), 'madness-dom-' + process.pid + '.html');
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--dump-dom', '--virtual-time-budget=8000'];
  const wantsIphone = process.env.UA === 'iphone' || /browser-check:\s*ua=iphone/.test(fs.readFileSync(file, 'utf8'));
  if (wantsIphone) args.push('--user-agent=' + IPHONE_UA);
  args.push(url);
  // Must be async: a synchronous spawn blocks the event loop, and the static server lives in
  // this same process, so Chrome would wait forever for its first response.
  const fd = fs.openSync(tmp, 'w');
  const r = await new Promise(resolve => {
    const child = spawn(chrome, args, { stdio: ['ignore', fd, 'ignore'] });
    const timer = setTimeout(() => { child.kill(); resolve({ status: null, error: { code: 'ETIMEDOUT' } }); }, 60000);
    child.on('exit', code => { clearTimeout(timer); resolve({ status: code }); });
    child.on('error', err => { clearTimeout(timer); resolve({ status: null, error: err }); });
  });
  fs.closeSync(fd);
  const dom = fs.readFileSync(tmp, 'utf8');
  try { fs.unlinkSync(tmp); } catch (e) {}
  const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) return ['FAIL no #out element in dump (chrome status ' + r.status + (r.error ? ', ' + r.error.code : '') + ')'];
  return m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').split('\n').map(l => l.trim()).filter(Boolean);
}

(async () => {
  const chrome = findChrome();
  if (!chrome) { console.error('Chrome not found; set CHROME=<path>'); process.exit(2); }
  if (!fs.existsSync(DIR)) { console.log('no test/browser directory on this branch'); return; }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html') && f.includes(filter)).sort();
  if (!files.length) { console.log('no browser checks match', JSON.stringify(filter)); return; }
  const srv = await serve();
  const port = srv.address().port;
  let failed = 0, total = 0;
  try {
    for (const f of files) {
      const lines = await runOne(chrome, `http://127.0.0.1:${port}/madness/test/browser/${f}`, path.join(DIR, f));
      const bad = lines.filter(l => !/^ok\b/.test(l));
      total += lines.length; failed += bad.length || (lines.length ? 0 : 1);
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${f}: ${lines.length - bad.length}/${lines.length}`);
      for (const l of bad) console.log('     ' + l);
    }
  } finally {
    srv.close();
  }
  console.log(`\n${total - failed}/${total} checks passed across ${files.length} file(s)`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
