const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

// Pure render helpers in 70-logic.js that every team card, bracket slot and
// Live row goes through. They were untested; the logo helper in particular is
// the only place a team's logo URL (which comes from ESPN, not from us) is put
// into markup, so its escaping is a security boundary.

function playInTeam(overrides) {
  return Object.assign({
    id: 'South-16', seed: 16, name: 'TBD', logo: '', record: '',
    playIn: true, playInResolved: false,
    playInTeams: [
      { name: 'Alpha St', logo: 'https://a.example/a.png', abbr: 'ALP', record: '20-12' },
      { name: 'Beta U', logo: 'https://b.example/b.png', abbr: 'BET', record: '19-14' }
    ]
  }, overrides || {});
}

test('escapeHtml escapes all five HTML-sensitive characters and nothing else', () => {
  const app = createApp();
  assert.equal(app.escapeHtml(`<a href="x" title='y'>&</a>`),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(app.escapeHtml('Plain Team 2027'), 'Plain Team 2027');
});

test('escapeHtml coerces non-strings so a numeric seed or undefined cannot throw', () => {
  const app = createApp();
  assert.equal(app.escapeHtml(16), '16');
  assert.equal(app.escapeHtml(undefined), 'undefined');
  assert.equal(app.escapeHtml(null), 'null');
});

test('teamLogoHTML returns an empty string when the team has no logo', () => {
  const app = createApp();
  assert.equal(app.teamLogoHTML({ name: 'No Logo', logo: '' }, 24), '');
  assert.equal(app.teamLogoHTML({ name: 'No Logo' }, 24), '');
});

test('teamLogoHTML renders one lazy img at the requested size', () => {
  const app = createApp();
  const html = app.teamLogoHTML({ name: 'Duke', logo: 'https://cdn.example/duke.png' }, 32);
  assert.equal(html,
    '<img src="https://cdn.example/duke.png" loading="lazy" style="width:32px;height:32px;object-fit:contain">');
});

test('teamLogoHTML escapes the logo URL so a hostile ESPN payload cannot break out of the attribute', () => {
  const app = createApp();
  const html = app.teamLogoHTML({ name: 'X', logo: '" onerror="alert(1)' }, 20);
  assert.ok(!html.includes('onerror="alert'), 'raw attribute injected: ' + html);
  assert.ok(html.includes('src="&quot; onerror=&quot;alert(1)"'));
  // Exactly one img tag and one src attribute.
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.equal((html.match(/ src=/g) || []).length, 1);
});

test('teamLogoHTML for an unresolved play-in shows both teams logos and skips a missing one', () => {
  const app = createApp();
  const both = app.teamLogoHTML(playInTeam(), 16);
  assert.equal((both.match(/<img /g) || []).length, 2);
  assert.ok(both.includes('https://a.example/a.png') && both.includes('https://b.example/b.png'));

  const t = playInTeam();
  t.playInTeams[1].logo = '';
  const one = app.teamLogoHTML(t, 16);
  assert.equal((one.match(/<img /g) || []).length, 1);
  assert.ok(one.includes('https://a.example/a.png'));
});

test('teamLogoHTML for a resolved play-in uses the single winner logo, not the pair', () => {
  const app = createApp();
  const t = playInTeam({ playInResolved: true, name: 'Alpha St', logo: 'https://a.example/a.png' });
  const html = app.teamLogoHTML(t, 16);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.ok(html.includes('https://a.example/a.png'));
});

test('teamDisplayName joins the play-in pair until resolved, then shows the winner', () => {
  const app = createApp();
  assert.equal(app.teamDisplayName(playInTeam()), 'Alpha St / Beta U');
  assert.equal(app.teamDisplayName(playInTeam({ playInResolved: true, name: 'Beta U' })), 'Beta U');
  assert.equal(app.teamDisplayName({ name: 'Gonzaga' }), 'Gonzaga');
});

test('teamRecordDisplay returns the record or an empty string, never undefined', () => {
  const app = createApp();
  assert.equal(app.teamRecordDisplay({ name: 'Duke', record: '28-5' }), '28-5');
  assert.equal(app.teamRecordDisplay({ name: 'Duke', record: '' }), '');
  assert.equal(app.teamRecordDisplay({ name: 'Duke' }), '');
});

test('teamRecordDisplay for a play-in joins the known records and drops blanks', () => {
  const app = createApp();
  assert.equal(app.teamRecordDisplay(playInTeam()), '20-12 / 19-14');
  const t = playInTeam();
  t.playInTeams[0].record = '';
  assert.equal(app.teamRecordDisplay(t), '19-14');
  t.playInTeams[1].record = undefined;
  assert.equal(app.teamRecordDisplay(t), '');
});
