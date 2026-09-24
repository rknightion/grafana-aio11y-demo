// Bedrock model calls. Two API paths, both Claude on Amazon Bedrock:
//   converse (default)  bedrock-runtime Converse against the agent's application inference
//                       profile ARN, so usage and cost land on the owning team's profile.
//   mantle              the Anthropic Messages API on Bedrock (bedrock-mantle endpoint), SigV4
//                       signed. Opt-in per agent with BEDROCK_API=mantle; it addresses a base
//                       model id (MANTLE_MODEL, default "anthropic.<model name>"), not a profile.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { modelConfig, supportsTemperature, validateProfileArn } from './config.mjs';

export const modelCap = (role, variant) => role === 'editorial' ? 800 : role === 'orchestrator' ? (variant?.maxTokens ?? 500) : 300;

function region() {
  const value = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!value) throw new Error('AWS_REGION is required');
  return value;
}
let runtime;
function runtimeClient() { runtime ??= new BedrockRuntimeClient({ region: region() }); return runtime; }

/** The model key an agent uses: the override (validated against the configured profiles) or the default. */
export function modelForRole(_role, override, models = modelConfig()) {
  if (override !== undefined && !Object.hasOwn(models.profiles, override)) throw new Error('invalid x-agent-model');
  return override ?? models.defaultKey;
}
export function modelIdentity(key, models = modelConfig()) {
  return { provider: 'anthropic', name: models.profiles[key]?.name ?? key };
}
export function profileArn(key, models = modelConfig()) {
  return validateProfileArn(models.profiles[key]?.arn);
}

function runtimeMessages(messages) {
  return messages.map((message) => ({ role: message.role, content: message.content.map((part) => part.type === 'text' ? { text: part.text } : part.type === 'toolUse' ? { toolUse: part.toolUse } : { toolResult: part.toolResult }) }));
}
export async function converseRuntime({ role, model, messages, system, tools, toolChoice, temperature, maxTokens, client, models = modelConfig() }) {
  const modelId = profileArn(model, models);
  const withTemperature = supportsTemperature(modelIdentity(model, models).name);
  const command = new ConverseCommand({ modelId, system: [{ text: system }], messages: runtimeMessages(messages), inferenceConfig: { maxTokens: maxTokens ?? modelCap(role), ...(withTemperature ? { temperature: temperature ?? 0.2 } : {}) }, ...(tools.length ? { toolConfig: { tools: tools.map((tool) => ({ toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: tool.inputSchema } } })), ...(toolChoice ? { toolChoice: { any: {} } } : {}) } } : {}) });
  const response = await (client ?? runtimeClient()).send(command);
  const content = (response.output?.message?.content ?? []).flatMap((part) => {
    // Extended-thinking blocks are private reasoning: never forwarded or recorded as the answer.
    if (part.reasoningContent !== undefined) return [];
    if (part.text !== undefined) return [{ type: 'text', text: part.text }];
    if (part.toolUse !== undefined) return [{ type: 'toolUse', toolUse: part.toolUse }];
    throw new Error('Bedrock response contains an unsupported content block');
  });
  if (!content.length) { const error = new Error(`Bedrock response has no visible content (stopReason: ${response.stopReason ?? 'unknown'})`); error.partialUsage = { inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 }; error.stopReason = response.stopReason; throw error; }
  return { content, stopReason: response.stopReason, usage: { inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 }, model };
}

function mantleMessages(messages) {
  return messages.map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content.map((part) => part.type === 'text' ? { type: 'text', text: part.text } : part.type === 'toolUse' ? { type: 'tool_use', id: part.toolUse.toolUseId, name: part.toolUse.name, input: part.toolUse.input } : { type: 'tool_result', tool_use_id: part.toolResult.toolUseId, content: part.toolResult.content.map((item) => ({ type: 'text', text: item.text ?? JSON.stringify(item.json) })) }) }));
}
export async function converseMantle({ role, model, messages, system, tools, toolChoice, temperature, maxTokens, signer, fetchImpl = fetch, models = modelConfig(), mantleModel = process.env.MANTLE_MODEL }) {
  const awsRegion = region();
  const url = new URL(`https://bedrock-mantle.${awsRegion}.api.aws/anthropic/v1/messages`);
  const modelName = modelIdentity(model, models).name;
  const body = JSON.stringify({ model: mantleModel || `anthropic.${modelName}`, max_tokens: maxTokens ?? modelCap(role), ...(supportsTemperature(modelName) ? { temperature: temperature ?? 0.2 } : {}), system, messages: mantleMessages(messages), tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })), ...(toolChoice ? { tool_choice: { type: 'any' } } : {}) });
  const awsSigner = signer ?? new SignatureV4({ credentials: defaultProvider(), region: awsRegion, service: 'bedrock-mantle', sha256: Sha256 });
  const signed = await awsSigner.sign(new HttpRequest({ protocol: url.protocol, hostname: url.hostname, method: 'POST', path: url.pathname, headers: { host: url.hostname, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body }));
  const response = await fetchImpl(url, { method: 'POST', headers: signed.headers, body });
  if (!response.ok) {
    const error = new Error(`mantle Messages failed: ${response.status}`);
    const failure = await response.json().catch(() => ({}));
    const usage = failure.usage ?? failure.error?.usage;
    if (Number.isFinite(usage?.input_tokens) && Number.isFinite(usage?.output_tokens) && usage.input_tokens >= 0 && usage.output_tokens >= 0) error.partialUsage = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
    error.stopReason = failure.stop_reason;
    throw error;
  }
  const result = await response.json();
  return { content: (result.content ?? []).map((part) => part.type === 'tool_use' ? { type: 'toolUse', toolUse: { toolUseId: part.id, name: part.name, input: part.input } } : { type: 'text', text: part.text ?? '' }), stopReason: result.stop_reason, usage: { inputTokens: result.usage?.input_tokens ?? 0, outputTokens: result.usage?.output_tokens ?? 0 }, model };
}

/** Deterministic stand-in for Bedrock (STUB_MODEL=1): one tool call per specialist, then text. */
export function stubModel({ role, model, messages }) {
  const priorTools = messages.flatMap((item) => item.content).filter((part) => part.type === 'toolResult');
  if (role !== 'orchestrator' && priorTools.length === 0) {
    const name = ({ odds: 'get_odds', news: 'get_news', compliance: 'get_offers' })[role];
    if (name) return { content: [{ type: 'toolUse', toolUse: { toolUseId: `${role}-stub-tool`, name, input: name === 'get_news' ? { team: 'Harbour City' } : {} } }], stopReason: 'tool_use', usage: { inputTokens: 20, outputTokens: 8 }, model };
  }
  return { content: [{ type: 'text', text: `${role} answer based on supplied context.` }], stopReason: 'end_turn', usage: { inputTokens: 30, outputTokens: 15 }, model };
}
