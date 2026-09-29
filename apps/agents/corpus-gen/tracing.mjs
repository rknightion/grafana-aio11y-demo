// Traces corpus-gen the same way the in-app agents trace themselves: one @grafana/agento11y
// client, agent name touchline-corpus-gen (role "corpus-gen" through the same selfAgentName /
// serviceNamespace helpers everything else uses), OTLP export through the standard env. No-op-safe
// when the env isn't configured (a local `--dry-run` or a quick check run), never throws.
import { startTelemetry } from '../src/telemetry.mjs';
import { createAgentClient, stubClient } from '../src/agent-client.mjs';
import { selfAgentName } from '../src/config.mjs';

export const CORPUS_GEN_ROLE = 'corpus-gen';

export function corpusGenAgentName(env = process.env) {
  return selfAgentName(CORPUS_GEN_ROLE, env);
}

/** Registers the OTel providers corpus-gen's spans/metrics use. Safe to call with no OTLP env set. */
export function createCorpusGenTelemetry(env = process.env, warn = console.warn) {
  const hasOtlp = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
  if (!hasOtlp) warn('corpus-gen: no OTEL_EXPORTER_OTLP_ENDPOINT configured; this run\'s spans and metrics will not reach Grafana Cloud.');
  return startTelemetry(CORPUS_GEN_ROLE);
}

/**
 * The agento11y client for this run: real (exporting generations to Agent Observability) when
 * AGENTO11Y_ENDPOINT/AGENTO11Y_AUTH_TENANT_ID/AGENTO11Y_AUTH_TOKEN are set, otherwise a no-op stub
 * that still lets the run proceed.
 */
export function createCorpusGenClient(telemetry, env = process.env, warn = console.warn) {
  const hasAgento11y = Boolean(env.AGENTO11Y_ENDPOINT && env.AGENTO11Y_AUTH_TENANT_ID && env.AGENTO11Y_AUTH_TOKEN);
  if (!hasAgento11y) {
    warn('corpus-gen: AGENTO11Y_ENDPOINT / AGENTO11Y_AUTH_TENANT_ID / AGENTO11Y_AUTH_TOKEN not set; running without Agent Observability tracing (no-op client).');
    return stubClient();
  }
  return createAgentClient(CORPUS_GEN_ROLE, telemetry, { env });
}
