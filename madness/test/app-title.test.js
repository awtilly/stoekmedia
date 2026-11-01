const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./_harness');

/* The app name used to be hard-coded in three <h1>s (lobby, join screen, header) and in the share and
 * notification titles. It now lives in APP_NAME / appTitleHTML() in js/00-constants.js, so renaming the
 * app (the store-facing name must not be "March Madness") is a one-line change. */

test('appTitleHTML: renders APP_NAME with the accent part in a span, exactly like the old hard-coded <h1>', () => {
  const app = createApp();
  assert.equal(app.eval('APP_NAME'), 'Madness Draft');
  assert.equal(app.appTitleHTML(), '<h1><span>Madness</span> Draft</h1>');
});

test('appTitleHTML: a name that does not start with the accent is shown whole inside the span', () => {
  const app = createApp();
  const html = app.eval("(() => { const APP_NAME = 'Bracket Buddies <3', APP_NAME_ACCENT = 'March Madness'; return " +
    app.appTitleHTML.toString().replace(/^function appTitleHTML\(\)/, '(function()') + ')(); })()');
  assert.equal(html, '<h1><span>Bracket Buddies &lt;3</span></h1>');
});

test('tripwire: no js module other than 00-constants.js hard-codes the app title', () => {
  const dir = path.join(__dirname, '..', 'js');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== '00-constants.js')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (src.includes('<span>March Madness</span>') || src.includes("'March Madness Draft'")) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'use appTitleHTML() / APP_NAME instead');
});
