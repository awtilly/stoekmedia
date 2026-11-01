const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('./_harness');

/*
 * warmupAudio() in js/80-pages.js is the only place the app creates and resumes its AudioContext.
 * A fake window.AudioContext records every resume() call and lets a test move the single cached
 * context between the states iOS Safari uses: 'suspended' (before the first tap), 'interrupted'
 * (after a phone call, Siri, or a trip to the home screen) and 'running'.
 */
let ctx = null; // the one instance 80-pages.js caches in its module-level _audioCtx
function FakeAudioContext() {
  this.state = 'suspended';
  this.resumes = 0;
  this.resumeResult = undefined;
  this.resume = () => { this.resumes++; return this.resumeResult; };
  this.currentTime = 0;
  this.destination = {};
  this.oscillators = [];
  this.createOscillator = () => {
    const osc = { started: false, frequency: {}, connect() {}, start() { osc.started = true; }, stop() {} };
    this.oscillators.push(osc);
    return osc;
  };
  this.createGain = () => ({ connect() {}, gain: { exponentialRampToValueAtTime() {} } });
  ctx = this;
}

let pagesLoaded = false;
function audioApp() {
  const app = createApp();
  app.window = { addEventListener() {}, AudioContext: FakeAudioContext };
  app.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  if (!pagesLoaded) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '80-pages.js'), 'utf8'), { filename: '80-pages.js' });
    pagesLoaded = true;
  }
  return app;
}

test('an interrupted context is resumed like a suspended one; running or closed contexts are left alone', () => {
  const app = audioApp();
  app.warmupAudio();                      // first call creates the context ('suspended') and resumes it
  assert.ok(ctx, 'AudioContext created on first warmup');
  assert.equal(ctx.resumes, 1, 'suspended: resumed (unchanged behaviour)');
  ctx.state = 'running';
  app.warmupAudio();
  assert.equal(ctx.resumes, 1, 'running: not resumed');
  ctx.state = 'interrupted';              // iOS after a call / Siri / home screen
  app.warmupAudio();
  assert.equal(ctx.resumes, 2, 'interrupted: resumed');
  ctx.state = 'closed';
  app.warmupAudio();
  assert.equal(ctx.resumes, 2, 'closed: not resumed');
});

test('a resume() that rejects (no user gesture has unlocked audio yet) is swallowed, not an unhandled rejection', async () => {
  const app = audioApp();
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    ctx.state = 'suspended';
    ctx.resumeResult = Promise.reject(new Error('NotAllowedError: a user gesture is required'));
    app.warmupAudio();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('the 10-second beep still sounds after an interruption', () => {
  const app = audioApp();
  ctx.state = 'interrupted';
  ctx.resumeResult = undefined;
  const before = ctx.resumes;
  app.playTimerBeep();
  assert.equal(ctx.resumes, before + 1, 'beep path resumed the interrupted context');
  assert.equal(ctx.oscillators.length, 1);
  assert.equal(ctx.oscillators[0].started, true);
});
