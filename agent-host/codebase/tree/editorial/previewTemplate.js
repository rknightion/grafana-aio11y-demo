'use strict';

const MAX_BLURB_WORDS = 120;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildPreview({ home, away, homeNews, awayNews, h2hLine }) {
  const intro = `${home} host ${away} this weekend.`;
  const homeParagraph = homeNews ? `${home}: ${homeNews}` : `${home} go in with no fresh team news.`;
  const awayParagraph = awayNews ? `${away}: ${awayNews}` : `${away} go in with no fresh team news.`;
  const closing = h2hLine || 'The two sides have no recent head-to-head record on file.';
  return [intro, homeParagraph, awayParagraph, closing].join('\n\n');
}

function buildBlurb(args) {
  const full = buildPreview(args);
  const words = full.split(/\s+/);
  if (words.length <= MAX_BLURB_WORDS) return full;
  return `${words.slice(0, MAX_BLURB_WORDS).join(' ')}...`;
}

module.exports = { buildPreview, buildBlurb, wordCount, MAX_BLURB_WORDS };
