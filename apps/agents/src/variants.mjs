// Orchestrator prompt variants. Each variant is a JSON file; its agent version is
// "<AGENT_VERSION>-<id>-<first 8 hex of the file's sha256>", so editing a variant file changes the
// version that Agent Observability charts and experiments compare.
//
// By default the orchestrator rotates variants on a deterministic per-UTC-day schedule of 2-3
// hour windows, which makes version comparisons appear in the Performance views without any
// operator action. VARIANT_MODE=<id> pins one variant; the x-agent-variant header overrides both.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { agentVersion } from './config.mjs';

export const VARIANT_IDS = ['brief', 'balanced', 'contextual'];

export function variantVersion(id, raw, env = process.env) {
  return `${agentVersion(env)}-${id}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

const variants = new Map(await Promise.all(VARIANT_IDS.map(async (id) => {
  const raw = await readFile(new URL(`./variants/${id}.json`, import.meta.url));
  const value = JSON.parse(raw);
  if (value.id !== id) throw new Error(`invalid variant ${id}`);
  return [id, { ...value, agentVersion: variantVersion(id, raw) }];
})));

function randomForDay(day) {
  let seed = createHash('sha256').update(day).digest().readUInt32BE(0);
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000; };
}
function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function variantSchedule(day) {
  const random = randomForDay(day);
  const lengths = shuffle([2, 2, 2, 2, 2, 2, 3, 3, 3, 3], random);
  const order = shuffle(VARIANT_IDS, random);
  let hour = 0;
  return lengths.map((length, index) => { const window = { startHour: hour, endHour: hour + length, id: order[index % order.length] }; hour += length; return window; });
}
export async function selectVariant({ now = new Date(), header, mode = process.env.VARIANT_MODE || 'rotate' } = {}) {
  if (header !== undefined) {
    if (!VARIANT_IDS.includes(header)) throw new Error('invalid x-agent-variant');
    return variants.get(header);
  }
  if (mode !== 'rotate' && !VARIANT_IDS.includes(mode)) throw new Error('invalid VARIANT_MODE');
  if (mode !== 'rotate') return variants.get(mode);
  const day = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  return variants.get(variantSchedule(day).find((window) => hour < window.endHour).id);
}
