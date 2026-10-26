import { randomBytes, randomUUID } from 'node:crypto';
import { log } from '../log.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // from last activity (D11: deleted after 24h)
export const RESUME_GRACE_MS = 5 * 60 * 1000; // socket gone -> session kept this long

/** Minimal socket surface so the store does not depend on `ws`. */
export type SessionSocket = { close(code?: number, reason?: string): void };

export type Session = {
  readonly id: string;
  readonly email: string;
  readonly packId: string;
  readonly resumeToken: string;
  socket: SessionSocket | undefined;
  audioFrames: number; // count only; audio content is never kept (D11)
};

/** One interface so Memorystore (Q2) can replace the in-memory map later. */
export interface SessionStore {
  create(email: string, packId: string): Session;
  get(id: string): Session | undefined;
  /** Resume needs the token AND the email authenticated on this connection. */
  resume(resumeToken: string, email: string): Session | undefined;
  attach(id: string, socket: SessionSocket): void;
  detach(id: string, socket: SessionSocket): void;
  touch(id: string): void;
  end(id: string): void;
  /** cleanup hook run on every end (session.end, grace, TTL) */
  onEnd(fn: (s: Session) => void | Promise<void>): void;
}

type Entry = { session: Session; ttl?: NodeJS.Timeout; grace?: NodeJS.Timeout };

export class MemorySessionStore implements SessionStore {
  private byId = new Map<string, Entry>();
  private byToken = new Map<string, string>();
  private endHooks: ((s: Session) => void | Promise<void>)[] = [];

  /** Cleanup hook run on every end (session.end, grace, 24 h TTL). Transcript / pack / Gemini
   * CachedContent owners (BE-89/91/94) register here so nothing outlives the session (D11, D21). */
  onEnd(fn: (s: Session) => void | Promise<void>) {
    this.endHooks.push(fn);
  }

  constructor(
    private ttlMs = SESSION_TTL_MS,
    private graceMs = RESUME_GRACE_MS,
  ) {}

  create(email: string, packId: string): Session {
    const session: Session = {
      id: randomUUID(),
      email,
      packId,
      resumeToken: randomBytes(32).toString('base64url'),
      socket: undefined,
      audioFrames: 0,
    };
    this.byId.set(session.id, { session });
    this.byToken.set(session.resumeToken, session.id);
    this.touch(session.id);
    return session;
  }

  get(id: string) {
    return this.byId.get(id)?.session;
  }

  resume(resumeToken: string, email: string) {
    const id = this.byToken.get(resumeToken);
    const session = id === undefined ? undefined : this.get(id);
    return session && session.email === email ? session : undefined;
  }

  attach(id: string, socket: SessionSocket) {
    const e = this.byId.get(id);
    if (!e) return;
    clearTimeout(e.grace);
    // reconnect before the old socket was noticed dead: the old one loses
    if (e.session.socket && e.session.socket !== socket) e.session.socket.close(4001, 'replaced');
    e.session.socket = socket;
    this.touch(id);
  }

  detach(id: string, socket: SessionSocket) {
    const e = this.byId.get(id);
    if (!e || e.session.socket !== socket) return; // already replaced by a newer socket
    e.session.socket = undefined;
    clearTimeout(e.grace);
    e.grace = setTimeout(() => this.end(id), this.graceMs).unref();
  }

  touch(id: string) {
    const e = this.byId.get(id);
    if (!e) return;
    clearTimeout(e.ttl);
    e.ttl = setTimeout(() => this.end(id), this.ttlMs).unref();
  }

  end(id: string) {
    const e = this.byId.get(id);
    if (!e) return;
    clearTimeout(e.ttl);
    clearTimeout(e.grace);
    this.byId.delete(id);
    this.byToken.delete(e.session.resumeToken);
    for (const fn of this.endHooks) {
      // one failing cleanup (sync throw or async rejection) must not block the others or the
      // socket close; log the code only, errors from providers may carry content (D11)
      const failed = () => log('end.hook.failed', { sessionId: e.session.id, code: 'HOOK_FAILED' });
      try {
        Promise.resolve(fn(e.session)).catch(failed);
      } catch {
        failed();
      }
    }
    e.session.socket?.close(1000, 'session ended');
  }
}
