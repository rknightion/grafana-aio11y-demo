// OpenTelemetry providers for the agents and the load generator.
//
// Exporters read the standard OTEL_EXPORTER_OTLP_* variables (endpoint, per-signal endpoints,
// headers). The exporters speak OTLP/HTTP. In the cluster they point at
// the in-namespace Alloy, which forwards to Grafana Cloud. The agento11y SDK uses these same
// providers, so its generation spans and gen_ai metrics are not lost to a no-op provider.
import { randomUUID } from 'node:crypto';
import { context, createContextKey, metrics, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { agentVersion, selfAgentName, serviceNamespace } from './config.mjs';

/** Span attribute carrying the owning team (newsroom | trading | platform); dashboards group on it. */
export const TEAM_ATTRIBUTE = 'team';

let current;
const teamContextKey = createContextKey('app.team');
export function withTeam(team, callback) { return context.with(context.active().setValue(teamContextKey, team), callback); }

// The agento11y SDK starts its own "generateText <model>" spans; copy the team onto them so
// generation spans can be grouped by team without a join.
export function teamGenerationSpanProcessor() {
  return {
    onStart(span, parentContext) {
      const team = parentContext.getValue(teamContextKey);
      if (team && span.name.startsWith('generateText ')) span.setAttribute(TEAM_ATTRIBUTE, team);
    },
    onEnd() {},
    async forceFlush() {},
    async shutdown() {},
  };
}

/** Parses OTEL_RESOURCE_ATTRIBUTES (key=value pairs, comma separated; values may contain '='). */
export function parseResourceAttributes(value = '') {
  return Object.fromEntries(value.split(',').map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const at = pair.indexOf('=');
    return at < 0 ? [pair, ''] : [decodeURIComponent(pair.slice(0, at).trim()), decodeURIComponent(pair.slice(at + 1).trim())];
  }).filter(([key]) => key));
}

export function resourceAttributes(role, env = process.env) {
  const fromEnv = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
  return {
    'deployment.environment.name': 'demo',
    'service.version': agentVersion(env),
    ...fromEnv,
    'service.namespace': fromEnv['service.namespace'] ?? serviceNamespace(env),
    'service.name': selfAgentName(role, env),
  };
}

export function startTelemetry(role, options = {}) {
  if (current) return current;
  const attributes = resourceAttributes(role);
  const serviceName = attributes['service.name'];
  const resource = defaultResource().merge(resourceFromAttributes({ ...attributes, 'service.instance.id': randomUUID() }));
  const tracerProvider = new NodeTracerProvider({ resource, spanProcessors: [teamGenerationSpanProcessor(), new BatchSpanProcessor(options.traceExporter ?? new OTLPTraceExporter())] });
  tracerProvider.register();
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const exportIntervalMillis = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 10000);
  const meterProvider = new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: options.metricExporter ?? new OTLPMetricExporter(), exportIntervalMillis })] });
  metrics.setGlobalMeterProvider(meterProvider);
  current = { tracerProvider, meterProvider, tracer: tracerProvider.getTracer(serviceName), meter: meterProvider.getMeter(serviceName), async shutdown() { await Promise.allSettled([meterProvider.shutdown(), tracerProvider.shutdown()]); current = undefined; } };
  return current;
}
export function telemetry() { return current; }
