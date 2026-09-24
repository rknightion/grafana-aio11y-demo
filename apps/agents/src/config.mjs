// Runtime configuration shared by the agents, the load generator and the experiment runner.
// Everything that differs between deployments comes from the environment; nothing here knows
// about a particular cluster, account or Grafana stack.

export const ROLES = ['orchestrator', 'news', 'odds', 'editorial', 'compliance'];

// Default owning team per agent. The Helm chart passes AGENT_TEAM explicitly (it mirrors
// local.agent_teams in terraform/locals.tf); these defaults only matter for local runs.
const DEFAULT_TEAMS = { orchestrator: 'platform', news: 'newsroom', odds: 'trading', editorial: 'newsroom', compliance: 'platform' };

const truthy = new Set(['1', 'true', 'yes', 'on']);
const falsy = new Set(['0', 'false', 'no', 'off']);

export function boolEnv(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const normalised = String(value).trim().toLowerCase();
  if (truthy.has(normalised)) return true;
  if (falsy.has(normalised)) return false;
  throw new Error(`invalid boolean value: ${value}`);
}

/** This process's role: AGENT_ROLE, or ROLE as the Helm chart sets it. */
export function currentRole(env = process.env) {
  return (env.AGENT_ROLE || env.ROLE || 'orchestrator').trim();
}

/**
 * Resource attribute service.namespace and the prefix of every service and agent name:
 * SERVICE_NAMESPACE, else service.namespace from OTEL_RESOURCE_ATTRIBUTES, else "touchline".
 */
export function serviceNamespace(env = process.env) {
  if (env.SERVICE_NAMESPACE) return env.SERVICE_NAMESPACE.trim();
  const match = (env.OTEL_RESOURCE_ATTRIBUTES ?? '').split(',').map((pair) => pair.trim()).find((pair) => pair.startsWith('service.namespace='));
  return match?.slice('service.namespace='.length).trim() || 'touchline';
}

/** The agent name for a role, e.g. touchline-news (also the Kubernetes Service name). */
export function agentName(role, env = process.env) {
  return `${serviceNamespace(env)}-${role}`;
}

/** This process's own agent name: OTEL_SERVICE_NAME when set, so gen_ai.agent.name == service.name. */
export function selfAgentName(role, env = process.env) {
  return (env.OTEL_SERVICE_NAME || agentName(role, env)).trim();
}

export function agentTeam(role, env = process.env) {
  return (env.AGENT_TEAM || DEFAULT_TEAMS[role] || 'platform').trim();
}

export function agentVersion(env = process.env) {
  return (env.AGENT_VERSION || 'v1').trim();
}

const CAPTURE_MODES = new Set(['default', 'full', 'no_tool_content', 'metadata_only', 'full_with_metadata_spans']);

/**
 * The agento11y content capture mode. AGENTO11Y_CONTENT_CAPTURE_MODE wins when set (any SDK mode,
 * or "none" meaning metadata_only); otherwise CONTENT_CAPTURE=true|false (default true) picks
 * full or metadata_only. metadata_only keeps tokens, models, timing and tool names but no
 * prompt, response or tool content.
 */
export function captureMode(env = process.env) {
  const explicit = env.AGENTO11Y_CONTENT_CAPTURE_MODE?.trim().toLowerCase();
  if (explicit) {
    if (explicit === 'none') return 'metadata_only';
    if (!CAPTURE_MODES.has(explicit)) throw new Error(`invalid AGENTO11Y_CONTENT_CAPTURE_MODE ${explicit}`);
    return explicit;
  }
  return boolEnv(env.CONTENT_CAPTURE, true) ? 'full' : 'metadata_only';
}

/** Whether prompt and question text may appear outside agento11y (titles, logs). */
export function contentCapture(env = process.env) {
  return captureMode(env) !== 'metadata_only';
}

/** Specialist endpoint for a role. {name} is the agent name, {role} the bare role. */
export function specialistUrl(role, env = process.env) {
  const template = env.SPECIALIST_URL_TEMPLATE || 'http://{name}:8080/v1/agent';
  return template.replaceAll('{name}', agentName(role, env)).replaceAll('{role}', role);
}

const PROFILE_ARN = /^arn:aws[a-z-]*:bedrock:[a-z0-9-]+:\d{12}:application-inference-profile\/[a-z0-9]+$/;

/**
 * Bedrock model routing for one agent.
 *
 * Every agent calls a per-team Bedrock application inference profile, so cost and usage are
 * attributable to the owning team. The simple form is one profile:
 *   MODEL_PROFILE_ARN=arn:aws:bedrock:...:application-inference-profile/abc123
 *   MODEL_KEY=haiku                       (the bedrock_models key; default "default")
 *   MODEL_NAME=claude-haiku-4-5           (recorded as the gen_ai model name; default MODEL_KEY)
 * The orchestrator can also accept per-request model overrides (x-agent-model, used by the
 * model-comparison experiments) when it is given several profiles:
 *   MODEL_PROFILES={"haiku":{"arn":"...","name":"claude-haiku-4-5"},"sonnet":{"arn":"...","name":"claude-sonnet-4-6"}}
 * MODEL_KEY picks the default among them; MODEL_PROFILE_ARN / MODEL_NAME override that entry.
 */
export function modelConfig(env = process.env) {
  let profiles = {};
  if (env.MODEL_PROFILES) {
    let parsed;
    try { parsed = JSON.parse(env.MODEL_PROFILES); } catch { throw new Error('MODEL_PROFILES must be JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MODEL_PROFILES must be a JSON object');
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || typeof value.arn !== 'string') throw new Error(`MODEL_PROFILES.${key} needs an arn`);
      profiles[key] = { arn: value.arn.trim(), name: (typeof value.name === 'string' && value.name.trim()) || key };
    }
  }
  const defaultKey = (env.MODEL_KEY || Object.keys(profiles)[0] || 'default').trim();
  const base = profiles[defaultKey] ?? { arn: '', name: defaultKey };
  profiles = { ...profiles, [defaultKey]: { arn: (env.MODEL_PROFILE_ARN || base.arn).trim(), name: (env.MODEL_NAME || base.name).trim() } };
  for (const profile of Object.values(profiles)) profile.name = canonicalModelName(profile.name);
  return { defaultKey, profiles };
}

/**
 * Canonical Claude model name from a Bedrock model or inference profile id, so MODEL_NAME can be
 * given as the id itself: "eu.anthropic.claude-haiku-4-5-20251001-v1:0" -> "claude-haiku-4-5".
 * Anything that is not a Bedrock Anthropic id is returned unchanged.
 */
export function canonicalModelName(value) {
  const match = /^(?:[a-z]{2,6}\.)?anthropic\.(claude-[a-z0-9-]+?)(?:-\d{8})?(?:-v\d+(?::\d+)?)?$/.exec(value ?? '');
  return match ? match[1] : value;
}

export function validateProfileArn(arn) {
  if (!PROFILE_ARN.test(arn ?? '')) throw new Error('model profile must be a Bedrock application inference profile ARN (set MODEL_PROFILE_ARN)');
  return arn;
}

/**
 * Some Claude generations reject an explicit temperature (their sampling is fixed when extended
 * thinking is on by default). Leave temperature out for those; set it for everything else.
 */
export function supportsTemperature(modelName) {
  return !/claude-(?:haiku|sonnet|opus)-5(?:$|[-.@])/.test(modelName ?? '');
}
