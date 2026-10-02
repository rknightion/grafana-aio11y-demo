import { createHash } from 'node:crypto';

// Cross-process memory of recently asked first questions, so the load generator and every
// site-browser run never open two conversations with the same words close together (AIO-0001 AC2).
// Shared through the chart's Redis; each app brings its own client (ioredis) and passes it in.

export const RECENT_QUESTION_TTL_SECONDS = 45 * 60;
const KEY_PREFIX = 'touchline:recent-question:';

/**
 * Returns claim(question) -> Promise<boolean>: true when no process asked this exact text within
 * the TTL (and records it), false when one did. Without a client, or when Redis fails, every
 * question is fresh: synthetic traffic never stops for want of the dedupe store.
 */
export function questionClaimer(client, ttlSeconds = RECENT_QUESTION_TTL_SECONDS) {
  if (!client) return async () => true;
  return async (question) => {
    const key = KEY_PREFIX + createHash('sha256').update(question).digest('hex');
    try {
      return (await client.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    } catch {
      return true;
    }
  };
}

/**
 * The first of `candidates` (strings, in order) that claim() accepts, or null when every one was
 * asked recently: the caller skips that turn rather than repeat someone's opening words.
 */
export async function firstFresh(candidates, claim) {
  for (const question of candidates) if (await claim(question)) return question;
  return null;
}
