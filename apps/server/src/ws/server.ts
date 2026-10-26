import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  decodeAudioFrame,
  type ErrorCode,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
} from '@rafael/protocol';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { audit } from '../audit.js';
import type { TokenVerifier } from '../auth/verifier.js';
import { type BrainOptions, createPipeline } from '../brain/pipeline.js';
import { log } from '../log.js';
import type { Session, SessionStore } from '../session/store.js';

// close codes (4xxx = app level); 1012 = service restart, client should reconnect
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_HELLO_TIMEOUT = 4408;
export const CLOSE_RESTART = 1012;

export type WsOptions = {
  store: SessionStore;
  verifier: TokenVerifier;
  /** e.g. ["chrome-extension://<EXTENSION_ID>"] (D13) */
  allowedOrigins: string[];
  /** dev only: also accept http(s)://localhost and 127.0.0.1 */
  allowLocalhost?: boolean;
  helloTimeoutMs?: number;
  heartbeatMs?: number;
  /** ask path (BE-99). Without it, `ask` answers LLM_UNAVAILABLE. */
  brain?: BrainOptions;
};

function originAllowed(origin: string | undefined, o: WsOptions): boolean {
  if (!origin) return false;
  if (o.allowedOrigins.includes(origin)) return true;
  if (!o.allowLocalhost) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function attachWs(http: Server, opts: WsOptions) {
  const { store, verifier } = opts;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const alive = new WeakSet<WebSocket>();
  const pipeline = opts.brain && createPipeline(opts.brain, store);

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws') return void socket.destroy();
    if (!originAllowed(req.headers.origin, opts)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  // heartbeat keeps proxies from cutting idle sockets; no pong in a round -> terminate
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, opts.heartbeatMs ?? 25_000);
  beat.unref();

  function onConnection(ws: WebSocket) {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));

    let email: string | undefined; // set once hello is verified
    let accessToken: string | undefined; // from hello, memory only (D13)
    let session: Session | undefined;
    const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
    const fail = (code: ErrorCode) => send({ v: PROTOCOL_VERSION, t: 'error', code });

    // D19: hello must be the first message, within the timeout
    const helloTimer = setTimeout(
      () => ws.close(CLOSE_HELLO_TIMEOUT, 'hello timeout'),
      opts.helloTimeoutMs ?? 5000,
    );
    helloTimer.unref();

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (session) store.detach(session.id, ws);
    });
    ws.on('error', () => ws.terminate());

    async function handle(data: RawData, isBinary: boolean) {
      // resumed on a newer socket: this one may still be closing, must not touch or end the session
      if (session && session.socket !== ws) return;
      if (isBinary) {
        // audio is only accepted inside a session (and so after hello)
        if (!session) return;
        if (!decodeAudioFrame(data as Buffer)) return fail('BAD_MESSAGE');
        session.audioFrames++; // stub for STT (BE-89): count only
        return;
      }
      const parsed = parseClientMessage(data.toString());
      if (!email) {
        // not authenticated yet: only a valid hello is acceptable
        if (!parsed.ok || parsed.data.t !== 'hello') {
          fail(parsed.ok ? 'UNAUTHORIZED' : parsed.error.code);
          return ws.close(CLOSE_UNAUTHORIZED, 'hello required');
        }
        // helloTimer keeps running while verifying: a hung verifier still gets 4408
        const who = await verifier(parsed.data.accessToken).catch(() => null);
        if (!who) {
          audit({ event: 'auth.denied', source: 'ws' });
          fail('UNAUTHORIZED');
          return ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        }
        clearTimeout(helloTimer);
        email = who.email;
        accessToken = parsed.data.accessToken;
        return;
      }
      if (!parsed.ok) return fail(parsed.error.code);
      const m = parsed.data;
      switch (m.t) {
        case 'hello':
          return fail('BAD_MESSAGE'); // already authenticated
        case 'session.start': {
          if (session) return fail('BAD_MESSAGE');
          // socket closed while this message waited in the queue: attaching now would
          // never be detached and the session would live for the full 24 h TTL
          if (ws.readyState !== ws.OPEN) return;
          const s = m.resumeToken
            ? store.resume(m.resumeToken, email)
            : store.create(email, m.packId);
          if (!s) return fail('SESSION_NOT_FOUND');
          s.accessToken = accessToken;
          session = s;
          store.attach(s.id, ws);
          audit({
            event: 'session.start',
            email,
            sessionId: s.id,
            resumed: Boolean(m.resumeToken),
          });
          log('session.attached', { sessionId: s.id, resumed: Boolean(m.resumeToken) });
          return send({
            v: PROTOCOL_VERSION,
            t: 'session.ready',
            sessionId: s.id,
            resumeToken: s.resumeToken,
          });
        }
        case 'session.end':
          if (!session) return fail('SESSION_NOT_FOUND');
          log('session.ended', { sessionId: session.id, audioFrames: session.audioFrames });
          store.end(session.id); // also closes the socket
          return;
        case 'ask': {
          if (!session) return fail('SESSION_NOT_FOUND');
          const sock = ws;
          // BE-108: no pack yet -> no guessing, tell the client
          const r = pipeline?.ask(session, m.text, (c) => {
            if (sock.readyState === sock.OPEN) send(c);
          });
          if (r !== 'ok') fail(r === 'busy' ? 'BAD_MESSAGE' : 'LLM_UNAVAILABLE');
          return;
        }
        default: // pause / resume: stubs for BE-89
          if (!session) return fail('SESSION_NOT_FOUND');
      }
    }

    // messages run one at a time: the client may send session.start right after hello
    // without waiting, and hello verification is async
    let queue: Promise<unknown> = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      queue = queue.then(() => handle(data, isBinary)).catch(() => ws.terminate());
    });
  }

  return {
    /** SIGTERM: tell every client to reconnect (1012) */
    shutdown() {
      clearInterval(beat);
      for (const ws of wss.clients) ws.close(CLOSE_RESTART, 'restart');
    },
  };
}
