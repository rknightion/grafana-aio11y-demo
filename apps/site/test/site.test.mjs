import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const Redis = createRequire(import.meta.url)('ioredis');
import { createSessionPlan, FIXTURE_QUESTIONS } from '../src/browser.mjs';
import { createSiteServer, browserConfig, askUrl } from '../src/server.mjs';
import { contentCapture } from '../src/config.mjs';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
function redisStub() { const data = new Map(); return net.createServer(socket => { let buffer = Buffer.alloc(0); socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); while (buffer.length) { const header = /^\*(\d+)\r\n/.exec(buffer.toString()); if (!header) break; let offset = header[0].length; const args = []; for (let i = 0; i < Number(header[1]); i++) { const line = buffer.indexOf('\r\n', offset); if (line < 0) return; const size = Number(buffer.subarray(offset + 1, line).toString()); if (buffer.length < line + 2 + size + 2) return; args.push(buffer.subarray(line + 2, line + 2 + size).toString()); offset = line + 2 + size + 2; } buffer = buffer.subarray(offset); const [command, key, value] = args; if (command.toUpperCase() === 'GET') { const hit = data.get(key); socket.write(hit == null ? '$-1\r\n' : `$${Buffer.byteLength(hit)}\r\n${hit}\r\n`); } else if (command.toUpperCase() === 'SET') { data.set(key, value); socket.write('+OK\r\n'); } else socket.write('+OK\r\n'); } }); }); }
function decodeResponse(raw) {
  const separator = Buffer.from('\r\n\r\n');
  const headerEnd = raw.indexOf(separator);
  if (headerEnd < 0) throw new Error('incomplete HTTP response headers');
  const headers = raw.subarray(0, headerEnd).toString('latin1');
  const body = raw.subarray(headerEnd + separator.length);
  if (!/transfer-encoding:\s*chunked/i.test(headers)) return body.toString('utf8');

  const crlf = Buffer.from('\r\n');
  const decodedChunks = [];
  let offset = 0;
  while (true) {
    const lineEnd = body.indexOf(crlf, offset);
    if (lineEnd < 0) throw new Error('incomplete HTTP chunk size');
    const sizeText = body.subarray(offset, lineEnd).toString('ascii').split(';', 1)[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid HTTP chunk size');
    offset = lineEnd + crlf.length;
    if (size === 0) break;
    const chunkEnd = offset + size;
    if (chunkEnd + crlf.length > body.length || body[chunkEnd] !== 13 || body[chunkEnd + 1] !== 10) {
      throw new Error('incomplete HTTP chunk');
    }
    decodedChunks.push(body.subarray(offset, chunkEnd));
    offset = chunkEnd + crlf.length;
  }
  return Buffer.concat(decodedChunks).toString('utf8');
}
function rawPost(port, traceId, payload) { return new Promise((resolve, reject) => { const socket = net.connect(port, '127.0.0.1'); const chunks = []; const body = JSON.stringify(payload); socket.on('connect', () => socket.write(`POST /api/picks HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\ntraceparent: 00-${traceId}-1234567890abcdef-01\r\n\r\n${body}`)); socket.on('data', part => chunks.push(part)); socket.on('end', () => { const raw = Buffer.concat(chunks); const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n')); const headers = raw.subarray(0, headerEnd).toString('latin1'); resolve({ status: Number(headers.match(/^HTTP\/1\.1 (\d+)/)?.[1]), body: decodeResponse(raw) }); }); socket.on('error', reject); }); }

test('every browser session plan finishes inside the CronJob activeDeadlineSeconds of 600', () => {
  // Worst case per plan: jitter, page load (30s), each answer wait (45s) and the think times.
  for (let seed = 1; seed <= 2000; seed += 1) {
    const plan = createSessionPlan(seed);
    const worst = plan.startDelayMs + 30_000 + plan.questions.length * 45_000 + plan.thinkTimesMs.reduce((a, b) => a + b, 0);
    assert.ok(worst < 540_000, `seed ${seed}: ${worst}ms leaves under a minute of the 600s deadline`);
  }
});

test('browser session plans are seeded, jittered and draw distinct fixture questions', async () => {
  const seed = 20260923;
  const plan = createSessionPlan(seed);
  assert.deepEqual(plan, createSessionPlan(seed));
  assert.ok(plan.startDelayMs >= 0 && plan.startDelayMs <= 4 * 60 * 1000);
  assert.ok(plan.questions.length >= 1 && plan.questions.length <= 3);
  assert.equal(new Set(plan.questions).size, plan.questions.length);
  assert.ok(plan.questions.every(question => FIXTURE_QUESTIONS.includes(question)));
  assert.ok(plan.thinkTimesMs.every(milliseconds => milliseconds >= 5 * 1000 && milliseconds <= 40 * 1000));

  const fixtures = JSON.parse(await readFile(new URL('../../mcp-tools/src/data/fixtures.json', import.meta.url), 'utf8'));
  assert.ok(FIXTURE_QUESTIONS.length >= 10);
  assert.ok(FIXTURE_QUESTIONS.every(question => fixtures.some(({ home, away }) => question.includes(home) && question.includes(away))));
  assert.ok(FIXTURE_QUESTIONS.every(question => /\b(odds?|prices?|news|form|injury)\b/i.test(question)));
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(page, /value="What are the odds and recent news for Harbour City vs Northgate Rovers\?"/);
  assert.match(page, /Touchline Times/);
});

test('picks requests keep browser context through HTTP, Redis and the orchestrator and preserve failure usage', async () => {
  const exporter = globalThis.__siteSpanExporter; assert.ok(exporter); exporter.reset();
  let upstreamHeader; let orchestratorCalls = 0; let upstreamStatus = 200; let upstreamBody = { status: 'ok', answer: 'Harbour City vs Northgate Rovers 🏟️', usage: [] }; const upstreamRequests = [];
  const orchestrator = http.createServer(async (req, res) => { upstreamHeader = req.headers.traceparent; orchestratorCalls++; let raw = ''; for await (const chunk of req) raw += chunk; upstreamRequests.push(JSON.parse(raw)); res.writeHead(upstreamStatus, { 'content-type': 'application/json' }); res.end(JSON.stringify(upstreamBody)); });
  const orchestratorPort = await listen(orchestrator);
  const fakeRedis = redisStub(); const redisPort = await listen(fakeRedis);
  const redis = new Redis(redisPort, '127.0.0.1', { enableReadyCheck: false, maxRetriesPerRequest: 1 });
  const site = createSiteServer({ redis, orchestratorUrl: `http://127.0.0.1:${orchestratorPort}/v1/ask`, config: browserConfig({ FARO_URL: 'https://collector.example/collect' }) }); const sitePort = await listen(site);
  try {
    const page = await fetch(`http://127.0.0.1:${sitePort}/`); assert.match(await page.text(), /window.SITE_CONFIG = \{"faroUrl":"https:\/\/collector.example\/collect","appName":"touchline-site-web","appVersion":"v1","environment":"demo"\}/);
    const script = await (await fetch(`http://127.0.0.1:${sitePort}/app.js`)).text(); assert.match(script, /traceparent|TracingInstrumentation/);
    const browserTraceId = '1234567890abcdef1234567890abcdef';
    const payload = { question: 'Harbour City odds?', userId: 'test' };
    const response = await rawPost(sitePort, browserTraceId, payload);
    assert.equal(response.status, 200); assert.match(response.body, /\"oddsCacheHit\":false/); assert.match(response.body, /\"usage\":\[\]/, 'orchestrator usage remains at the top level'); assert.match(upstreamHeader, new RegExp(`^00-${browserTraceId}-`));
    assert.equal(JSON.parse(response.body).answer, 'Harbour City vs Northgate Rovers 🏟️', 'chunk sizes count UTF-8 bytes, not string characters');
    assert.equal(upstreamRequests[0].conversationId, undefined, 'conversationId remains optional');
    assert.equal(upstreamRequests[0].conversationTitle, undefined, 'conversationTitle remains optional');
    await globalThis.__siteSdk._tracerProvider.forceFlush(); const spans = exporter.getFinishedSpans().filter(span => span.spanContext().traceId === browserTraceId);
    assert.equal(spans.filter(span => span.kind === 1 && span.attributes['http.route'] === '/api/picks').length, 1, `site SERVER spans: ${spans.map(span => span.name)}`);
    assert.equal(spans.filter(span => span.kind === 2 && span.attributes['url.path'] === '/v1/ask').length, 1, `orchestrator CLIENT spans: ${spans.map(span => span.name)}`);
    assert.ok(spans.some(span => /redis|GET|SET/i.test(span.name)), `Redis: ${spans.map(span => span.name)}`);
    const secondTraceId = 'abcdef1234567890abcdef1234567890';
    const second = await rawPost(sitePort, secondTraceId, payload);
    assert.match(second.body, /\"oddsCacheHit\":true/);
    assert.match(upstreamHeader, new RegExp(`^00-${secondTraceId}-`));
    const conversationId = 'touchline-loadgen-followup-test';
    const conversationTitle = 'Harbour City vs Northgate Rovers prices';
    const firstConversationTurn = await rawPost(sitePort, '22222222222222222222222222222222', { question: 'What are the odds for Harbour City vs Northgate Rovers?', userId: 'loadgen-test', conversationId, conversationTitle });
    const followupTurn = await rawPost(sitePort, '33333333333333333333333333333333', { question: 'Give one more concise detail for Harbour City vs Northgate Rovers.', userId: 'loadgen-test', conversationId, conversationTitle });
    assert.equal(firstConversationTurn.status, 200);
    assert.equal(followupTurn.status, 200);
    assert.match(upstreamRequests[3].question, /^Give one more concise detail/);
    assert.deepEqual(upstreamRequests.slice(2, 4).map(({ conversationId: id, conversationTitle: title }) => ({ conversationId: id, conversationTitle: title })), [
      { conversationId, conversationTitle },
      { conversationId, conversationTitle },
    ]);
    const oversizedId = await rawPost(sitePort, '44444444444444444444444444444444', { ...payload, conversationId: 'i'.repeat(129) });
    const oversizedTitle = await rawPost(sitePort, '55555555555555555555555555555555', { ...payload, conversationTitle: 't'.repeat(257) });
    assert.equal(oversizedId.status, 400);
    assert.equal(oversizedTitle.status, 400);
    const partialUsage = [{ model: 'haiku-4-5', inputTokens: 19, outputTokens: 7 }];
    upstreamStatus = 500; upstreamBody = { error: 'upstream failure', usage: partialUsage };
    const failureTraceId = '11111111111111111111111111111111';
    const failed = await rawPost(sitePort, failureTraceId, { question: 'Match preview for Harbour City vs Northgate Rovers', userId: 'test' });
    assert.equal(failed.status, 502);
    assert.deepEqual(JSON.parse(failed.body).usage, partialUsage);
    assert.equal(orchestratorCalls, 5, 'cache hit still calls the orchestrator, follow-ups reach it, and failures return usage');
    const invalid = await rawPost(sitePort, '66666666666666666666666666666666', { question: 'Harbour City odds?' });
    assert.equal(invalid.status, 400, 'userId is required');
  } finally { redis.disconnect(); site.closeAllConnections(); orchestrator.closeAllConnections(); fakeRedis.closeAllConnections?.(); await close(site); await close(orchestrator); await close(fakeRedis); }
});

test('runtime config: names follow the namespace, ORCHESTRATOR_URL may be a base URL, capture follows env', () => {
  assert.deepEqual(browserConfig({}), { faroUrl: '', appName: 'touchline-site-web', appVersion: 'v1', environment: 'demo' });
  assert.equal(browserConfig({ SERVICE_NAMESPACE: 'matchday' }).appName, 'matchday-site-web');
  assert.equal(browserConfig({ OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=matchday' }).appName, 'matchday-site-web');
  assert.equal(askUrl({}), 'http://touchline-orchestrator:8080/v1/ask');
  assert.equal(askUrl({ ORCHESTRATOR_URL: 'http://touchline-orchestrator:8080' }), 'http://touchline-orchestrator:8080/v1/ask');
  assert.equal(askUrl({ ORCHESTRATOR_URL: 'http://o:1/custom/ask' }), 'http://o:1/custom/ask');
  assert.equal(contentCapture({ AGENTO11Y_CONTENT_CAPTURE_MODE: 'none', CONTENT_CAPTURE: 'true' }), false);
  assert.equal(contentCapture({}), true);
});
