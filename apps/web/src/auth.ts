// Google Identity Services token client (replaces chrome.identity). D13: scopes exactly these.
// The access token lives in this object's memory only, never in localStorage / logs (D11).
export const GSI_SRC = 'https://accounts.google.com/gsi/client';
export const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.readonly';
export const HD = 'praneat.com'; // hint only: the server decides who may use Rafael

export type TokenResponse = { access_token?: string; expires_in?: number | string; error?: string };
export type TokenClient = { requestAccessToken(o?: { prompt?: string }): void };
export type Gis = {
  initTokenClient(c: {
    client_id: string;
    scope: string;
    hd?: string;
    callback: (r: TokenResponse) => void;
    error_callback: (e: { type?: string }) => void;
  }): TokenClient;
};

export const isClientId = (id: string | undefined): id is string =>
  !!id && id.endsWith('.apps.googleusercontent.com');

/** Loads the GIS script once (the only remote script, Google's own; a web page may, MV3 may not). */
export function loadGis(doc: Document = document): Promise<Gis> {
  const w = window as unknown as { google?: { accounts?: { oauth2?: Gis } } };
  const ready = w.google?.accounts?.oauth2;
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => {
      const g = w.google?.accounts?.oauth2;
      if (g) resolve(g);
      else reject(new Error('gsi'));
    };
    s.onerror = () => reject(new Error('gsi'));
    doc.head.append(s);
  });
}

const SKEW_MS = 60_000; // treat a token as expired a minute early

export class WebAuth {
  private token: { value: string; exp: number } | null = null;
  private client: Promise<TokenClient> | null = null;
  private waiting: ((r: TokenResponse | null) => void) | null = null;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private clientId: string,
    private gis: () => Promise<Gis> = loadGis,
    private now: () => number = Date.now,
  ) {}

  /** cached and still valid, else null (no UI) */
  cached(): string | null {
    return this.token && this.token.exp > this.now() ? this.token.value : null;
  }

  /**
   * interactive: from a click (Google popup, `select` = always show the account chooser).
   * Not interactive: the cached token, else a silent refresh (prompt none). null = no token.
   */
  async getToken(interactive: boolean, opts: { fresh?: boolean; select?: boolean } = {}) {
    const reusable = !opts.fresh && !opts.select;
    if (reusable && this.cached()) return this.cached();
    if (!interactive && this.inflight) return this.inflight; // silent joins a request already running
    // a click must not join a silent request (it would get no popup): wait it out, then ask for itself
    while (this.inflight) await this.inflight;
    if (reusable && this.cached()) return this.cached(); // the silent one just got a token
    this.token = null;
    this.inflight = this.request(interactive, opts.select).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * While a session is live: renew the token silently `leadMs` before it expires, so a reconnect
   * (Cloud Run cuts the socket every 60 min, the token lasts 60) never meets an expired token.
   * `onNeedSignIn(true)` when the silent renewal failed (retried every `retryMs`; an interactive
   * sign-in also clears it); the session itself is untouched. Returns stop().
   */
  keepFresh(
    onNeedSignIn: (need: boolean) => void,
    leadMs = 5 * 60_000,
    retryMs = 30_000,
  ): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stopped) return;
      const wait = this.token ? this.token.exp - leadMs - this.now() : 0;
      if (wait > 0) {
        onNeedSignIn(false);
        timer = setTimeout(run, wait);
        return;
      }
      const t = await this.getToken(false, { fresh: true });
      if (stopped) return;
      onNeedSignIn(t === null);
      timer = setTimeout(run, t ? 0 : retryMs);
    };
    void run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  /** forget the token (sign-out of Rafael; the Google session stays) */
  clear() {
    this.token = null;
  }

  private async request(interactive: boolean, select?: boolean): Promise<string | null> {
    try {
      this.client ??= this.gis().then((g) =>
        g.initTokenClient({
          client_id: this.clientId,
          scope: SCOPES,
          hd: HD,
          callback: (r) => this.waiting?.(r),
          error_callback: () => this.waiting?.(null), // popup closed / blocked
        }),
      );
      const client = await this.client;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await new Promise<TokenResponse | null>((resolve) => {
        this.waiting = resolve;
        // a silent request may never call back (no Google session): do not hang a reconnect
        if (!interactive) timer = setTimeout(() => resolve(null), 10_000);
        client.requestAccessToken({
          prompt: interactive ? (select ? 'select_account' : '') : 'none',
        });
      });
      clearTimeout(timer);
      this.waiting = null;
      if (!r?.access_token || r.error) return null;
      const ttl = Number(r.expires_in);
      this.token = {
        value: r.access_token,
        exp: this.now() + (Number.isFinite(ttl) ? ttl : 3600) * 1000 - SKEW_MS,
      };
      return r.access_token;
    } catch {
      this.client = null; // script blocked / offline: try loading again next time
      return null; // reason may name the account: not logged
    }
  }
}
