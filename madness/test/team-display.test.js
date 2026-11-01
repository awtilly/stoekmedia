const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

// Pure render helpers in 70-logic.js that every team card, bracket slot and
// Live row goes through. They were untested. Since the NCAA.com switch (#53) the app
// renders no team logos at all: teamLogoHTML must return '' for every shape of team,
// including rooms imported before the switch that still carry ESPN logo URLs in state.

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

test('teamLogoHTML renders nothing for any team, even one that still carries a logo URL', () => {
  const app = createApp();
  assert.equal(app.teamLogoHTML({ name: 'Duke', logo: 'https://cdn.example/duke.png' }, 32), '');
  // A hostile URL left in an old room's state never reaches the markup either.
  assert.equal(app.teamLogoHTML({ name: 'X', logo: '" onerror="alert(1)' }, 20), '');
});

test('teamLogoHTML renders nothing for play-in slots, unresolved or resolved', () => {
  const app = createApp();
  assert.equal(app.teamLogoHTML(playInTeam(), 16), '');
  assert.equal(app.teamLogoHTML(playInTeam({ playInResolved: true, name: 'Alpha St', logo: 'https://a.example/a.png' }), 16), '');
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
