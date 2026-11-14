const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

/* The join screen is redrawn on every room update, and on join night an update arrives each time somebody else
 * joins. The redraw used to rebuild the whole form: the name and PIN a person was typing were wiped and the
 * keyboard closed. Now only the list of names is refreshed while this room's form is on the page.
 *
 * Fake page: setting #app's innerHTML creates fresh elements for the ids found in the markup (as a browser
 * would), and counts as one rebuild of the form. */
function joinApp(players) {
  const app = createApp({ players });
  app.roomId = 'ROOM1';
  if (typeof globalThis.appTitleHTML !== 'function') globalThis.appTitleHTML = () => '<h1>Madness</h1>';
  const page = { els: {}, rebuilds: 0 };
  const appEl = {
    set innerHTML(html) {
      page.rebuilds++;
      page.els = {};
      for (const id of ['join-name', 'join-pin', 'join-returning']) {
        if (!html.includes('id="' + id + '"')) continue;
        page.els[id] = { id, value: '', innerHTML: '' };
      }
      if (page.els['join-returning']) {
        const m = html.match(/<div id="join-returning">([\s\S]*?)<\/div>\s*(?:<p class="join-meta"[\s\S]*?<\/p>\s*)?<div style="margin-top:16px/);
        page.els['join-returning'].innerHTML = m ? m[1] : 'NOT FOUND';
      }
      page.html = html;
    }
  };
  app.document = { getElementById: id => (id === 'app' ? appEl : page.els[id] || null), querySelector: () => null, addEventListener() {} };
  return { app, page };
}
const ann = { id: 'p1', name: 'Ann', pinHash: 'x:y', teamIds: [] };
const bob = { id: 'p2', name: 'Bob <b>', pinHash: 'x:y', teamIds: [] };

test('first draw builds the form and the list of names', () => {
  const { app, page } = joinApp([ann]);
  app.renderJoinScreen();
  assert.equal(page.rebuilds, 1);
  assert.ok(page.els['join-name'] && page.els['join-pin'], 'form is on the page');
  assert.match(page.els['join-returning'].innerHTML, /claimPlayer\('p1'\)/);
  assert.match(page.els['join-returning'].innerHTML, /Already in this pool\?/);
});

test('somebody else joins while a name and PIN are being typed: the form is left alone and the new name is listed', () => {
  const { app, page } = joinApp([ann]);
  app.renderJoinScreen();
  const nameEl = page.els['join-name'], pinEl = page.els['join-pin'];
  nameEl.value = 'Cat'; pinEl.value = '12';
  app.S.players = [ann, bob];
  app.renderJoinScreen();
  assert.equal(page.rebuilds, 1, 'the form was not rebuilt');
  assert.equal(page.els['join-name'], nameEl, 'same input element: focus and keyboard stay');
  assert.equal(nameEl.value, 'Cat');
  assert.equal(pinEl.value, '12');
  assert.match(page.els['join-returning'].innerHTML, /claimPlayer\('p2'\)/, 'the newcomer can be tapped');
  assert.match(page.els['join-returning'].innerHTML, /Bob &lt;b&gt;/, 'names are still escaped');
});

test('first person in an empty room: no "Returning Player" card, and it appears once someone has joined', () => {
  const { app, page } = joinApp([]);
  app.renderJoinScreen();
  assert.equal(page.els['join-returning'].innerHTML.trim(), '');
  app.S.players = [ann];
  app.renderJoinScreen();
  assert.equal(page.rebuilds, 1);
  assert.match(page.els['join-returning'].innerHTML, /Already in this pool\?/);
});

test('the last listed player is removed: the card goes away without touching the form', () => {
  const { app, page } = joinApp([ann]);
  app.renderJoinScreen();
  page.els['join-name'].value = 'Cat';
  app.S.players = [];
  app.renderJoinScreen();
  assert.equal(page.rebuilds, 1);
  assert.equal(page.els['join-returning'].innerHTML.trim(), '');
  assert.equal(page.els['join-name'].value, 'Cat');
});

test('another screen was shown in between, or the room changed: the form is built fresh', () => {
  const { app, page } = joinApp([ann]);
  app.renderJoinScreen();
  page.els = {}; // some other screen replaced the page
  app.renderJoinScreen();
  assert.equal(page.rebuilds, 2);
  page.els['join-name'].value = 'Cat';
  app.roomId = 'ROOM2'; // a different room with this form still on the page
  app.renderJoinScreen();
  assert.equal(page.rebuilds, 3, 'never carry one room\'s typed PIN into another room\'s form');
  assert.equal(page.els['join-name'].value, '');
  assert.match(page.html, /You're invited to <strong>ROOM2<\/strong>/);
});
