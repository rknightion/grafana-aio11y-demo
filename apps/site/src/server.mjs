// Touchline Times site API.
//   GET  /          the reader page, with runtime config (Faro collector URL etc.) injected
//   GET  /app.js    the bundled, Faro-instrumented browser code
//   POST /api/picks { question, userId, conversationId?, conversationTitle? } -> orchestrator answer
//   GET  /healthz
// Odds questions consult a five-minute Redis cache keyed by user and question, but the
// orchestrator is still called on every request so each browser action keeps its full trace.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { context, trace } from '@opentelemetry/api';
import { serviceNamespace } from './config.mjs';
const require = createRequire(import.meta.url);
// CommonJS require so the OTel require-hook instrumentation patches http and ioredis.
const http = require('node:http');
const Redis = require('ioredis');

const root = new URL('../public/', import.meta.url);
const text = (name) => readFile(new URL(name, root), 'utf8');
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const MAX_CONVERSATION_ID_LENGTH = 128;
const MAX_CONVERSATION_TITLE_LENGTH = 256;
const key = (userId, question) => `picks:${userId}:${question.trim().toLowerCase()}`;
async function readBody(req) { let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16384) throw new Error('request too large'); } return JSON.parse(body); }
function optionalText(value, maxLength) {
  if (value == null) return { valid: true, value: undefined };
  if (typeof value !== 'string' || value.length > maxLength) return { valid: false, value: undefined };
  return { valid: true, value: value.trim() || undefined };
}

/** Browser runtime config. Only non-secret values: the Faro collector URL is public by design. */
export function browserConfig(env = process.env) {
  return {
    faroUrl: env.FARO_URL || '',
    appName: env.FARO_APP_NAME || `${serviceNamespace(env)}-site-web`,
    appVersion: env.FARO_APP_VERSION || env.APP_VERSION || 'v1',
    environment: env.FARO_ENVIRONMENT || 'demo',
  };
}

/** ORCHESTRATOR_URL may be the orchestrator base URL (as the Helm chart sets it) or the full /v1/ask URL. */
export function askUrl(env = process.env) {
  const url = new URL(env.ORCHESTRATOR_URL || `http://${serviceNamespace(env)}-orchestrator:8080`);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1/ask';
  return url.href;
}

export function createSiteServer({ redis, orchestratorUrl = askUrl(), config = browserConfig() } = {}) {
  if (!redis) throw new Error('redis client required');
  const configJson = JSON.stringify(config).replaceAll('<', '\\u003c');
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    trace.getSpan(context.active())?.setAttribute('http.route', path === '/api/picks' ? '/api/picks' : path);
    try {
      if (req.method === 'GET' && path === '/healthz') return json(res, 200, { status: 'ok' });
      if (req.method === 'GET' && path === '/') { const page = (await text('index.html')).replace('__SITE_CONFIG_JSON__', configJson); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(page); }
      if (req.method === 'GET' && path === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(await text('app.bundle.js')); }
      if (req.method !== 'POST' || path !== '/api/picks') return json(res, 404, { error: 'not found' });
      let input;
      try { input = await readBody(req); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const { question, userId } = input || {};
      const conversationId = optionalText(input?.conversationId, MAX_CONVERSATION_ID_LENGTH);
      const conversationTitle = optionalText(input?.conversationTitle, MAX_CONVERSATION_TITLE_LENGTH);
      if (!conversationId.valid || !conversationTitle.valid) return json(res, 400, { error: 'conversationId and conversationTitle must be strings within their length limits' });
      if (typeof question !== 'string' || !question.trim() || question.length > 2000 || typeof userId !== 'string' || !userId.trim() || userId.length > 128) return json(res, 400, { error: 'question and userId are required' });
      const oddsLookup = /\bodds?\b/i.test(question);
      let cachedOdds = null;
      if (oddsLookup) { try { cachedOdds = await redis.get(key(userId, question)); } catch (e) { console.error(JSON.stringify({ level: 'warn', message: 'cache read failed', error: e.message })); } }
      const upstreamPayload = { question, userId };
      if (conversationId.value) upstreamPayload.conversationId = conversationId.value;
      if (conversationTitle.value) upstreamPayload.conversationTitle = conversationTitle.value;
      const upstream = await fetch(orchestratorUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(upstreamPayload), signal: AbortSignal.timeout(30000) });
      if (!upstream.ok) {
        const failure = await upstream.json().catch(() => null);
        // Partial token usage survives failures so the load generator can still pace its budget.
        return json(res, 502, {
          error: 'orchestrator request failed',
          status: upstream.status,
          ...(Array.isArray(failure?.usage) ? { usage: failure.usage } : {}),
        });
      }
      const answer = await upstream.json();
      if (!answer || typeof answer !== 'object') return json(res, 502, { error: 'orchestrator response invalid' });
      if (oddsLookup && !cachedOdds) { try { await redis.set(key(userId, question), JSON.stringify({ answer: answer.answer }), 'EX', 300); } catch (e) { console.error(JSON.stringify({ level: 'warn', message: 'cache write failed', error: e.message })); } }
      const active = trace.getSpan(context.active())?.spanContext();
      console.log(JSON.stringify({ level: 'info', message: 'picks served', trace_id: active?.traceId, span_id: active?.spanId }));
      return json(res, 200, { ...answer, oddsCacheHit: Boolean(cachedOdds) });
    } catch (e) { console.error(JSON.stringify({ level: 'error', message: e.message })); return json(res, 500, { error: 'internal error' }); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const redis = new Redis(process.env.REDIS_URL || `redis://${serviceNamespace()}-redis:6379`, { maxRetriesPerRequest: 1 });
  const server = createSiteServer({ redis });
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  process.once('SIGTERM', () => server.close(() => redis.quit()));
}
