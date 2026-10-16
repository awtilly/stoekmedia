// Long-press-to-clear on bracket slots is delegated through data-lp attributes
// (js/70-logic.js) instead of inline ontouch* handlers, so the page's touchstart
// and touchmove listeners can be passive. These tests cover the delegation glue.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

function slotEl(lp) {
  const el = { getAttribute: (k) => (k === 'data-lp' ? lp : null) };
  el.closest = (sel) => (sel === '[data-lp]' && lp != null ? el : null);
  return el;
}
function touch(target, cancelable) {
  const e = { target, defaultPrevented: false, cancelable: !!cancelable };
  e.preventDefault = () => { e.defaultPrevented = true; };
  return e;
}
const flush = () => new Promise((r) => setImmediate(r));

test('longPressAction parses region and Final Four slots, rejects junk', () => {
  const app = createApp();
  assert.equal(typeof app.longPressAction('r:South:3'), 'function');
  assert.equal(typeof app.longPressAction('ff:2'), 'function');
  for (const bad of ['', null, 'r:South', 'r:South:x', 'ff:', 'ff:1:2', 'click:1', 'r::1']) {
    assert.equal(app.longPressAction(bad), null, 'rejects ' + JSON.stringify(bad));
  }
});

test('holding a region slot for 500 ms clears that game (admin gated)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const app = createApp();
    app.S.bracket.South[3] = 'South-4';
    app.onBracketTouchStart(touch(slotEl('r:South:3')));
    mock.timers.tick(499);
    assert.equal(app.__calls.requireAdmin, 0, 'nothing before 500 ms');
    mock.timers.tick(1);
    await flush();
    assert.equal(app.__calls.requireAdmin, 1, 'requireAdmin asked once');
    assert.equal(app.S.bracket.South[3], null, 'game cleared');
    assert.equal(app.__calls.render, 1);
    const end = touch(slotEl('r:South:3'), true);
    app.onBracketTouchEnd(end);
    assert.equal(end.defaultPrevented, true, 'ghost click after a long press is cancelled');
    const again = touch(slotEl('r:South:3'), true);
    app.onBracketTouchEnd(again);
    assert.equal(again.defaultPrevented, false, 'flag is consumed by the first touchend');
  } finally {
    mock.timers.reset();
  }
});

test('holding a Final Four slot routes to clearFFGame', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const app = createApp();
    app.S.bracket.ff[1] = 'West-1';
    app.onBracketTouchStart(touch(slotEl('ff:1')));
    mock.timers.tick(500);
    await flush();
    assert.equal(app.__calls.requireAdmin, 1);
    assert.equal(app.S.bracket.ff[1], null);
  } finally {
    mock.timers.reset();
  }
});

test('a touchmove (scroll) before 500 ms cancels the long press', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const app = createApp();
    app.S.bracket.South[3] = 'South-4';
    app.onBracketTouchStart(touch(slotEl('r:South:3')));
    mock.timers.tick(200);
    app.cancelLongPress();
    mock.timers.tick(1000);
    await flush();
    assert.equal(app.__calls.requireAdmin, 0, 'no admin prompt');
    assert.equal(app.S.bracket.South[3], 'South-4', 'game untouched');
    const end = touch(slotEl('r:South:3'), true);
    app.onBracketTouchEnd(end);
    assert.equal(end.defaultPrevented, false, 'tap/scroll still produces its click');
  } finally {
    mock.timers.reset();
  }
});

test('touches outside a slot never start a timer, and a short tap is not prevented', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const app = createApp();
    app.onBracketTouchStart(touch(slotEl(null)));
    app.onBracketTouchStart(touch(null));
    app.onBracketTouchStart(touch({}));
    mock.timers.tick(1000);
    assert.equal(app.__calls.requireAdmin, 0);
    app.onBracketTouchStart(touch(slotEl('r:East:0')));
    mock.timers.tick(100);
    const end = touch(slotEl('r:East:0'), true);
    app.onBracketTouchEnd(end);
    assert.equal(end.defaultPrevented, false);
    mock.timers.tick(1000);
    assert.equal(app.__calls.requireAdmin, 0, 'timer was cleared by touchend');
  } finally {
    mock.timers.reset();
  }
});
