'use strict';

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} - Touchline Times</title></head>
<body>
${body}
<footer><small>18+ | the responsible gambling line goes on every odds page, not here.</small></footer>
</body>
</html>`;
}

module.exports = { layout };
