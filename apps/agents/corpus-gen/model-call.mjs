// The one Bedrock call corpus-gen makes: a plain Converse request against a cheap model (Haiku by
// convention), asking for a JSON array back. Deliberately independent of src/models.mjs's
// per-team application-inference-profile routing (that path is for the in-app agents billing to a
// team); corpus-gen is a one-off local tool addressed directly at CORPUS_GEN_MODEL_ID.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { canonicalModelName } from '../src/config.mjs';

let runtime;
function defaultClient(region) { runtime ??= new BedrockRuntimeClient({ region }); return runtime; }

export function corpusGenModelId(env = process.env) {
  const value = env.CORPUS_GEN_MODEL_ID;
  if (!value) throw new Error('CORPUS_GEN_MODEL_ID is required (a Bedrock Haiku model id or inference profile ARN)');
  return value;
}

export function corpusGenRegion(env = process.env) {
  const value = env.AWS_REGION || env.AWS_DEFAULT_REGION;
  if (!value) throw new Error('AWS_REGION is required');
  return value;
}

/** The gen_ai model name recorded on generations and used to price the call. Defaults to Haiku. */
export function corpusGenModelName(env = process.env) {
  const explicit = env.CORPUS_GEN_MODEL_NAME?.trim();
  if (explicit) return explicit;
  const canonical = canonicalModelName(env.CORPUS_GEN_MODEL_ID);
  return canonical && /^claude-/.test(canonical) ? canonical : 'claude-haiku-4-5';
}

/** One Converse call. Returns { text, stopReason, usage: { inputTokens, outputTokens } }. */
export async function callGeneratorModel({ modelId, region, system, prompt, maxTokens, temperature = 0.5, client }) {
  const command = new ConverseCommand({
    modelId,
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens, temperature },
  });
  const response = await (client ?? defaultClient(region)).send(command);
  const text = (response.output?.message?.content ?? []).map((part) => part.text).filter((value) => typeof value === 'string').join('\n');
  if (!text.trim()) throw new Error(`Bedrock response has no text content (stopReason: ${response.stopReason ?? 'unknown'})`);
  return { text, stopReason: response.stopReason, usage: { inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 } };
}

/** Extracts and parses a JSON array from a model response, tolerant of ```json fences. */
export function extractJsonArray(text) {
  const stripped = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('model response did not contain a JSON array');
  let parsed;
  try { parsed = JSON.parse(stripped.slice(start, end + 1)); }
  catch (error) { throw new Error(`model response was not valid JSON: ${error.message}`); }
  if (!Array.isArray(parsed)) throw new Error('model response JSON was not an array');
  return parsed;
}
