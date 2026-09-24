// OpenTelemetry for the site API, loaded with --import before the server. Traces go to the
// standard OTEL_EXPORTER_OTLP_* endpoint (the in-namespace Alloy in the cluster); HTTP, Undici and
// ioredis are auto-instrumented, so one browser click is one trace through Redis and the agents.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { serviceNamespace } from './config.mjs';
const testMode = process.env.SITE_TEST_MODE === '1';
const exporter = testMode ? new InMemorySpanExporter() : new OTLPTraceExporter();
const attributes = Object.fromEntries((process.env.OTEL_RESOURCE_ATTRIBUTES || '').split(',').filter(Boolean).map(pair => { const at = pair.indexOf('='); return [pair.slice(0, at).trim(), pair.slice(at + 1).trim()]; }));
attributes['service.namespace'] ??= serviceNamespace();
attributes['service.name'] = process.env.OTEL_SERVICE_NAME || `${serviceNamespace()}-site-api`;
const sdk = new NodeSDK({ resource: resourceFromAttributes(attributes), traceExporter: exporter, instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-http': { enabled: true }, '@opentelemetry/instrumentation-undici': { enabled: true }, '@opentelemetry/instrumentation-ioredis': { enabled: true }, '@opentelemetry/instrumentation-redis': { enabled: false }, '@opentelemetry/instrumentation-fs': { enabled: false } })] });
sdk.start();
if (testMode) { globalThis.__siteSpanExporter = exporter; globalThis.__siteSdk = sdk; }
process.once('SIGTERM', () => {
  sdk.shutdown().catch((error) => console.error(JSON.stringify({ level: 'error', message: 'telemetry shutdown failed', error: error.message })));
});
