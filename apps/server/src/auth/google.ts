import { createHash } from 'node:crypto';
import type { TokenVerifier } from './verifier.js';

export type GoogleVerifierOptions = {
  /** OAuth client id of the extension (BE-71); token `aud` must match (D13) */
  clientId: string;
  fetch?: typeof fetch; // injectable for tests
  now?: () => number;
  domain?: string;
  timeoutMs?: number;
};

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';
const MAX_CACHE = 1000;

/**
 * D13: tokeninfo gives aud + email + email_verified + expires_in in one call. Fail-closed: any
 * error / non-200 / bad shape -> null. Cache is keyed by sha256(token), never the raw token,
 * and lives at most expires_in. Token and response bodies are never logged.
 */
export function createGoogleVerifier(o: GoogleVerifierOptions): TokenVerifier {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const suffix = `@${o.domain ?? 'praneat.com'}`;
  const cache = new Map<string, { email: string; exp: number }>();

  return async (token) => {
    if (!token) return null;
    const key = createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.exp > now()) return { email: hit.email };
    cache.delete(key);

    let info: Record<string, unknown>;
    try {
      // POST body, not query string: keeps the token out of any URL log
      const res = await doFetch(TOKENINFO, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: token }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
      });
      if (!res.ok) return null;
      info = (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
    const email = typeof info.email === 'string' ? info.email.toLowerCase() : '';
    const ttl = Number(info.expires_in);
    if (
      (info.aud !== o.clientId && info.azp !== o.clientId) ||
      // tokeninfo returns email_verified as the string "true"
      !(info.email_verified === true || info.email_verified === 'true') ||
      !email.endsWith(suffix) ||
      !(ttl > 0)
    )
      return null;

    if (cache.size >= MAX_CACHE) {
      for (const [k, v] of cache) if (v.exp <= now()) cache.delete(k);
      if (cache.size >= MAX_CACHE) cache.clear(); // ponytail: crude cap, LRU if it ever matters
    }
    cache.set(key, { email, exp: now() + ttl * 1000 });
    return { email };
  };
}
