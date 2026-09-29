'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreview, buildBlurb, wordCount } = require('../previewTemplate');

test('preview mentions both teams', () => {
  const text = buildPreview({ home: 'Redvale', away: 'Fellgate Wanderers' });
  assert.match(text, /Redvale/);
  assert.match(text, /Fellgate Wanderers/);
});

test('wordCount counts whitespace-separated words', () => {
  assert.equal(wordCount('a short sentence here'), 4);
});

test('buildBlurb never exceeds the word cap plus the ellipsis', () => {
  const longNews = 'goal '.repeat(200);
  const blurb = buildBlurb({ home: 'A', away: 'B', homeNews: longNews, awayNews: longNews });
  assert.ok(wordCount(blurb) <= 121);
});
