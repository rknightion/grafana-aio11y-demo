'use strict';

// FIXME: this only matches literal paths, no /match/:id-style params. Fine while the site has a
// handful of static routes, but the newsroom keeps asking for a real preview page per fixture
// (see docs/RUNBOOK.md) and that needs params. Don't bolt regex onto this without a test for it.

const { renderHome } = require('./render');

const routes = [
  { method: 'GET', path: '/', handler: () => renderHome() },
];

function register(method, path, handler) {
  routes.push({ method, path, handler });
}

function match(method, url) {
  const path = url.split('?')[0];
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) return null;
  return { handler: route.handler, params: {} };
}

module.exports = { register, match };
