const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./_harness');

test('pickDeadlineMoved: same deadline => not moved; reset, cleared or missing deadline => moved', () => {
  const app = createApp();
  assert.equal(app.pickDeadlineMoved(1700000000, { seconds: 1700000000, nanoseconds: 0 }), false);
  assert.equal(app.pickDeadlineMoved(1700000000, { seconds: 1700000060, nanoseconds: 0 }), true, 'another client auto-picked and reset the clock');
  assert.equal(app.pickDeadlineMoved(1700000000, null), true, 'draft completed or clock cleared');
  assert.equal(app.pickDeadlineMoved(1700000000, undefined), true);
  assert.equal(app.pickDeadlineMoved(1700000000, 1700000000000), true, 'legacy millisecond number is not the Timestamp we watched');
});

test('pickDeadlineMoved without a reference deadline never blocks (old behaviour)', () => {
  const app = createApp();
  assert.equal(app.pickDeadlineMoved(null, { seconds: 1 }), false);
  assert.equal(app.pickDeadlineMoved(undefined, null), false);
});

test('the draft clock passes the expired deadline in, and the transaction checks it before picking', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8');
  assert.match(src, /autoPickHighestSeed\(ds\.pickDeadline && ds\.pickDeadline\.seconds != null \? ds\.pickDeadline\.seconds : null\)/);
  assert.match(src, /async function autoPickHighestSeed\(expiredDeadlineSeconds\)/);
  const tx = src.slice(src.indexOf('async function autoPickHighestSeed('));
  const guard = tx.indexOf('if(pickDeadlineMoved(expiredDeadlineSeconds, ds.pickDeadline)) return;');
  const pick = tx.indexOf('pl.teamIds.push(chosen.id)');
  assert.ok(guard > 0 && guard < pick, 'guard runs inside the transaction before the pick is written');
});
