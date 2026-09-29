#!/usr/bin/env node
'use strict';

// Quick local draft: node editorial/cli.js "<home>" "<away>" ["<news for home>"] ["<news for away>"]
// Doesn't call the MCP tools itself - that's what a Claude Code session does. This is just for a
// fast local sanity check of the template.
const { buildPreview } = require('./previewTemplate');

function main(argv) {
  const [home, away, homeNews, awayNews] = argv;
  if (!home || !away) {
    console.error('usage: cli.js <home> <away> [homeNews] [awayNews]');
    process.exitCode = 2;
    return;
  }
  console.log(buildPreview({ home, away, homeNews, awayNews }));
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main };
