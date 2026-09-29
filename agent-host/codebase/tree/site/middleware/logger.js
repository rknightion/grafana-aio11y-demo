'use strict';

// TODO: this only logs to stdout; once alloy is picking up container logs we should switch to
// structured JSON lines (see the gateway's own logging for the shape we want).
function logRequest(req) {
  const line = `${new Date().toISOString()} ${req.method} ${req.url}`;
  // eslint-disable-next-line no-console
  console.log(line);
  return line;
}

module.exports = { logRequest };
