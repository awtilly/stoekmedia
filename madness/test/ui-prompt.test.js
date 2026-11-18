const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/* 40-ui.js is not one of the harness logic files; it only declares functions (and one top-level let),
   so load it once on top of createApp(). Later createApp() calls reset the stubs but keep these. */
const UI_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', '40-ui.js'), 'utf8');
createApp();
vm.runInThisContext(UI_SRC, { filename: '40-ui.js' });
const attrsFor = (msg, opts) => globalThis.promptInputAttrs(msg, opts);
const has = (s, part, label) => assert.ok(s.includes(part), (label || '') + ' expected ' + part + ' in: ' + s);

test('PIN prompts get the phone number pad, a 4-char cap and no autocorrect', () => {
  for (const msg of ['Enter 4-digit admin PIN:', 'Set a 4-digit PIN for Joe:', 'Enter your 4-digit PIN:', 'Set a 4-digit admin PIN to protect editing:']) {
    const attrs = attrsFor(msg, { placeholder: '4-digit PIN' });
    has(attrs, 'inputmode="numeric"', msg);
    has(attrs, 'pattern="[0-9]*"', msg);
    has(attrs, 'maxlength="4"', msg);
    has(attrs, 'autocomplete="off"', msg);
    has(attrs, 'enterkeyhint="done"', msg);
    has(attrs, 'placeholder="4-digit PIN"', msg);
  }
});

test('name and passphrase prompts keep exactly the old attributes', () => {
  assert.equal(attrsFor('Enter your player name:', {}), 'placeholder="" value=""');
  assert.equal(attrsFor('Enter your passphrase:', { defaultValue: 'a"b' }), 'placeholder="" value="a&quot;b"');
  assert.equal(attrsFor('Pick 14-digits worth of luck:', {}), 'placeholder="" value=""', 'only the whole word 4-digit counts');
});

test('PIN digits are masked; name, passphrase and other-keyboard prompts stay visible text', () => {
  has(attrsFor('Enter 4-digit admin PIN:', {}), 'type="password" inputmode="numeric"');
  for (const [msg, opts] of [['Enter your player name:', {}], ['Enter your passphrase:', {}], ['Enter your email:', { inputmode: 'email' }], ['Room name:', { defaultValue: 'type="password"' }]]) {
    const attrs = attrsFor(msg, opts);
    assert.ok(!/(^|\s)type=/.test(attrs), msg + ' must not set type: ' + attrs);
  }
});

test('an explicit inputmode wins: numeric without "4-digit", or another keyboard verbatim', () => {
  has(attrsFor('Enter the code:', { inputmode: 'numeric' }), 'type="password" inputmode="numeric" pattern=');
  assert.equal(attrsFor('Enter your email:', { inputmode: 'email' }), 'placeholder="" value="" inputmode="email"');
  assert.ok(!attrsFor('Enter your email:', { inputmode: 'em"ail' }).includes('em"ail'), 'escaped');
});

test('appPrompt builds its <input> through promptInputAttrs (tripwire)', () => {
  const body = UI_SRC.slice(UI_SRC.indexOf('function appPrompt('), UI_SRC.indexOf('function appConfirm('));
  has(body, '<input class="modal-input" id="${id}" ${promptInputAttrs(message, { placeholder, defaultValue, inputmode })}>');
  has(body, "inputmode = ''", 'appPrompt accepts an inputmode option');
});

test('a PIN being typed in to unlock is masked; a PIN being chosen stays visible (no confirm step to catch a typo)', () => {
  for (const msg of ['Enter 4-digit admin PIN:', 'Enter your 4-digit PIN:']) has(attrsFor(msg, {}), 'type="password" inputmode="numeric"', msg);
  for (const msg of ['Set a 4-digit admin PIN to protect editing:', 'This room has no admin PIN yet.\nSet a 4-digit PIN to protect editing:',
    'Set a 4-digit PIN to replace your passphrase:', 'This seat has no PIN yet. Set a 4-digit PIN to claim it:', 'Set a 4-digit PIN for Joe:']) {
    const attrs = attrsFor(msg, { placeholder: '4-digit PIN' });
    assert.ok(!/(^|\s)type=/.test(attrs), msg + ' must stay visible: ' + attrs);
    has(attrs, 'inputmode="numeric"', msg);
    has(attrs, 'maxlength="4"', msg);
  }
  has(attrsFor('Reset code, 4-digit:', {}), 'type="password"', 'only the whole word Set counts as choosing');
});

test('tripwire: every PIN prompt in js/ is either a masked "Enter" or a visible "Set"', () => {
  const dir = path.join(__dirname, '..', 'js');
  const masked = [], visible = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/appPrompt[(](['"])((?:(?!\1).)*)\1/g)) {
      const msg = m[2].replace(/\\n/g, '\n');
      if (!/4-digit/.test(msg)) continue;
      (/(^|\s)type="password"/.test(attrsFor(msg, {})) ? masked : visible).push(msg);
    }
  }
  assert.deepEqual(masked.sort(), ['Enter 4-digit admin PIN:', 'Enter your 4-digit PIN:']);
  assert.ok(visible.length >= 5 && visible.every(m => /Set a 4-digit/.test(m)), 'visible PIN prompts are the ones that choose a PIN: ' + JSON.stringify(visible));
});
