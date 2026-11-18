const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Tripwire for dead styles: every class a selector in index.html's <style> blocks names must appear somewhere
 * in the markup the app actually produces (the HTML outside <style>, or a js/ file, where the templates live).
 * A class built from pieces at run time ('grid-' + n) would not be seen: none are today; if one is added, list
 * it in BUILT_AT_RUNTIME with a note saying where it is put together.
 */
const ROOT = path.join(__dirname, '..');
// renderMyTeams (js/80-pages.js) builds ' m' + me.rank for the medal tint and 'r' + round for the chart bars.
const BUILT_AT_RUNTIME = ['m1', 'm2', 'm3', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'];

test('every class styled in index.html is used by the markup or the js/ templates', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  assert.ok(styleBlocks.length > 0, 'index.html still carries its styles inline');
  const selectors = styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, ' ');
  const classes = [...new Set([...selectors.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]))];
  assert.ok(classes.length > 100, 'the selector scan found the stylesheet (' + classes.length + ' classes)');
  const jsDir = path.join(ROOT, 'js');
  const used = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '') + '\n' +
    fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
  const unused = classes.filter(c => !BUILT_AT_RUNTIME.includes(c) &&
    !new RegExp('(^|[^A-Za-z0-9_-])' + c + '($|[^A-Za-z0-9_-])').test(used));
  assert.deepEqual(unused, [], 'remove these rules or use the class');
});
