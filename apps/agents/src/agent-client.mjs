// agento11y client: generation export, tool executions, conversation ratings and preflight guard
// hooks. Endpoint, tenant and token come from the same env names the SDK documents:
//   AGENTO11Y_ENDPOINT        the stack's Agent Observability ingest URL
//   AGENTO11Y_AUTH_TENANT_ID  the stack's tenant (instance) id
//   AGENTO11Y_AUTH_TOKEN      a Cloud access policy token with sigil:write
// STUB_MODEL=1 swaps in a no-op client for local runs without Grafana Cloud.
import { createAgento11yClient } from '@grafana/agento11y';
import { agentVersion, captureMode, selfAgentName } from './config.mjs';

export function contentCaptureMode(env = process.env) {
  return captureMode(env);
}

export function stubClient() {
  return {
    evaluateHook: async () => ({ action: 'allow' }),
    startGeneration: async (_start, callback) => callback({ setResult() {} }),
    startToolExecution: async (_start, callback) => callback({ setResult() {} }),
    submitConversationRating: async () => {},
    shutdown: async () => {},
  };
}

export function createAgentClient(role, telemetry, options = {}) {
  if (options.client) return options.client;
  const env = options.env ?? process.env;
  if (env.STUB_MODEL === '1') return stubClient();
  const endpoint = env.AGENTO11Y_ENDPOINT;
  const token = env.AGENTO11Y_AUTH_TOKEN;
  const tenantId = env.AGENTO11Y_AUTH_TENANT_ID;
  if (!endpoint || !token || !tenantId) throw new Error('AGENTO11Y_ENDPOINT, AGENTO11Y_AUTH_TENANT_ID and AGENTO11Y_AUTH_TOKEN are required (or set STUB_MODEL=1)');
  return createAgento11yClient({
    generationExport: { protocol: 'http', endpoint, auth: { mode: 'basic', tenantId, basicPassword: token } },
    api: { endpoint: new URL(endpoint).origin },
    contentCapture: contentCaptureMode(env),
    // Preflight hooks run the stack's guards on tool results before they reach the model.
    // failOpen keeps the demo answering if the guard service is slow or unreachable.
    hooks: { enabled: true, phases: ['preflight'], timeoutMs: 5000, failOpen: true },
    agentName: selfAgentName(role, env), agentVersion: agentVersion(env), tracer: telemetry.tracer, meter: telemetry.meter,
  });
}
