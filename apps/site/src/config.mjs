// Deployment-specific names come from the environment; defaults assume the Helm chart's
// same-namespace Service names (<SERVICE_NAMESPACE>-orchestrator, -redis, -site-api).
export function serviceNamespace(env = process.env) {
  if (env.SERVICE_NAMESPACE) return env.SERVICE_NAMESPACE.trim();
  const match = (env.OTEL_RESOURCE_ATTRIBUTES ?? '').split(',').map((pair) => pair.trim()).find((pair) => pair.startsWith('service.namespace='));
  return match?.slice('service.namespace='.length).trim() || 'touchline';
}
// Mirrors the agents: AGENTO11Y_CONTENT_CAPTURE_MODE=none|metadata_only or CONTENT_CAPTURE=false turn it off.
export function contentCapture(env = process.env) {
  const mode = env.AGENTO11Y_CONTENT_CAPTURE_MODE?.trim().toLowerCase();
  if (mode) return !['none', 'metadata_only'].includes(mode);
  return !['0', 'false', 'no', 'off'].includes(String(env.CONTENT_CAPTURE ?? 'true').trim().toLowerCase());
}
