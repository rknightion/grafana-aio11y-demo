// Loaded with --import before the service starts: registers HTTP client/server auto-instrumentation,
// then starts the tracer and meter providers for this role.
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

const role = process.env.AGENT_ROLE || process.env.ROLE || 'orchestrator';
const ROUTES = ['/healthz', '/v1/ask', '/v1/agent'];
registerInstrumentations({ instrumentations: [
  new HttpInstrumentation({ startIncomingSpanHook: (request) => {
    const path = new URL(request.url, 'http://agents.local').pathname;
    return { 'http.route': ROUTES.includes(path) ? path : 'unknown' };
  } }),
  // Specialist calls carry an explicitly injected traceparent and use the service's own CLIENT
  // span. Ignoring them here avoids a second, competing traceparent header from Undici.
  new UndiciInstrumentation({ ignoreRequestHook: (request) => request.path.startsWith('/v1/agent') }),
] });
const { startTelemetry } = await import('./telemetry.mjs');
startTelemetry(role);
globalThis.__agentsAutoHttp = true;
