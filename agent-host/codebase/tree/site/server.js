'use strict';

// Minimal match-page server. No framework: routes are matched by router.js and handlers render
// through templates/. Good enough for the size of this site; see the FIXME in router.js before
// adding anything with path params.

const http = require('node:http');
const { match } = require('./router');
const { renderNotFound } = require('./render');
const { logRequest } = require('./middleware/logger');

function createServer() {
  return http.createServer((req, res) => {
    logRequest(req);
    const route = match(req.method, req.url);
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(renderNotFound());
      return;
    }
    const body = route.handler(route.params);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createServer().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`touchline site listening on ${port}`);
  });
}

module.exports = { createServer };
