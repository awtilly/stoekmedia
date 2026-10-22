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
    has(attrs, 'type="password"', msg);
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
