import type { OffscreenToPanel } from './messages';

/**
 * request id -> resolver: an answer only ever settles the request it was sent for.
 * `send` returns false when the request could not be sent (no port / port gone) -> resolves null at once.
 */
export class PendingRequests {
  private pending = new Map<string, (v: unknown) => void>();

  request<T>(timeoutMs: number, send: (id: string) => boolean): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      const id = crypto.randomUUID();
      const done = (v: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve((v as T | null) ?? null);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      this.pending.set(id, done);
      if (!send(id)) done(null);
    });
  }

  /** feed a `log` / `summary` answer from the session */
  settle(m: Extract<OffscreenToPanel, { k: 'log' | 'summary' }>) {
    if (m.id) this.pending.get(m.id)?.(m.k === 'log' ? m.events : m.summary);
  }
}
