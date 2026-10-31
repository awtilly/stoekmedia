const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Tripwire for dead code: every top-level function declared in js/ must be referenced at least once
 * somewhere other than its own declaration (another module, an inline onclick in a template string,
 * index.html or sw.js). Entry points called only by the browser (event handlers wired by name in
 * markup) count, because the markup lives in those same files.
 */
const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

test('every top-level function in js/ is referenced somewhere besides its declaration', () => {
  const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();
  const sources = jsFiles.map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8'));
  const corpus = sources.join('\n') + '\n' +
    fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + '\n' +
    fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const unreferenced = [];
  sources.forEach((src, i) => {
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = m[1];
      const ident = '[A-Za-z0-9_$]';
      const uses = corpus.match(new RegExp('(^|[^' + ident.slice(1, -1) + '])' + name.split('$').join('[$]') + '($|[^' + ident.slice(1, -1) + '])', 'gm')) || [];
      if (uses.length <= 1) unreferenced.push(jsFiles[i] + ': ' + name);
    }
  });
  assert.deepEqual(unreferenced, [], 'remove these or wire them up');
});
