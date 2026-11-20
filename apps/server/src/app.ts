import { createServer, type IncomingMessage } from 'node:http';
import { PackExclude } from '@rafael/protocol';
import { audit } from './audit.js';
import { denyAll } from './auth/verifier.js';
import { SummaryRequest, summarize } from './brain/summary.js';
import { log } from './log.js';
import { MemorySessionStore } from './session/store.js';
import { createStaticHandler } from './static.js';
import { attachWs, type WsOptions } from './ws/server.js';

const SUMMARY_MAX_BYTES = 8 * 1024 * 1024; // 2 h log is well under 2 MB

const TOO_LARGE = Symbol('too large');
/**
 * Request body as UTF-8, capped in bytes. Decoded once at the end, so a Thai char split
 * across two chunks stays intact. null = the client went away mid-body (no unhandled rejection).
 */
async function readBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let n = 0;
  try {
    for await (const c of req as AsyncIterable<Buffer>) {
      n += c.length;
      if (n > maxBytes) return TOO_LARGE;
      chunks.push(c);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `webDist`: directory of the web build; when set it is served at / and the WS accepts same-origin pages. */
export function createApp(ws?: Partial<WsOptions>, o: { webDist?: string } = {}) {
  const web = o.webDist ? createStaticHandler(o.webDist) : undefined;
  const verifier = ws?.verifier ?? denyAll;
  const store = ws?.store ?? new MemorySessionStore();
  // one place for session.end / session.expired, whichever path ended it (explicit, grace, TTL)
  store.onEnd((s, reason) =>
    audit({
      event: reason === 'expired' ? 'session.expired' : 'session.end',
      email: s.email,
      sessionId: s.id,
    }),
  );
  let wsApi: ReturnType<typeof attachWs> | undefined; // set below, before any request arrives
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    // D13/D18: every /api/* needs a verified Google token; only GET /api/health is exempt
    if (path.startsWith('/api/') && !(path === '/api/health' && req.method === 'GET')) {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
      const token = m?.[1];
      const who = token ? await verifier(token).catch(() => null) : null;
      if (!token || !who) {
        audit({ event: 'auth.denied', source: 'http' });
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"code":"UNAUTHORIZED"}');
        return;
      }
      const json = (code: number, body: object) =>
        res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      // meeting summary from the caller's own Conversation Log (the End screen holds the last copy).
      // Nothing is stored: the log and the summary only pass through (D11)
      if (path === '/api/summary') {
        if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();
        const brain = ws?.brain;
        if (!brain) return json(503, { code: 'LLM_UNAVAILABLE' });
        const body = await readBody(req, SUMMARY_MAX_BYTES);
        if (body === null) return json(400, { code: 'BAD_MESSAGE' });
        if (body === TOO_LARGE) return json(413, { code: 'BAD_MESSAGE' });
        let raw: unknown;
        try {
          raw = JSON.parse(body);
        } catch {}
        const p = SummaryRequest.safeParse(raw);
        if (!p.success) return json(400, { code: 'BAD_MESSAGE' });
        const start = p.data.events[0];
        // only the account that opened the session
        if (start?.type !== 'session.start' || start.user !== who.email)
          return json(403, { code: 'UNAUTHORIZED' });
        const t0 = Date.now();
        try {
          const { summary, stats } = await summarize(p.data.events, {
            llm: brain.llm,
            model: brain.config.summaryModel,
          });
          // D11: counts and ms only
          log('summary', { sessionId: start.sessionId, ms: Date.now() - t0, ...stats });
          return json(200, { summary });
        } catch {
          log('summary.failed', { sessionId: start.sessionId, ms: Date.now() - t0 });
          return json(502, { code: 'LLM_UNAVAILABLE' });
        }
      }
      // BE-108: re-read the Drive folder into the pack of the caller's own session
      const refresh = /^\/api\/pack\/([\w-]+)\/refresh$/.exec(path);
      if (refresh) {
        if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();
        const s = store.get(refresh[1]!);
        // another user's session looks the same as a missing one
        if (!s || s.email !== who.email || !wsApi?.packs)
          return json(404, { code: 'SESSION_NOT_FOUND' });
        // BE-112: optional JSON body { exclude?: string[] }; empty body = no exclusions
        const body = await readBody(req, 64 * 1024);
        if (body === null) return json(400, { code: 'BAD_MESSAGE' });
        if (body === TOO_LARGE) return json(413, { code: 'BAD_MESSAGE' });
        let exclude: string[] | undefined;
        if (body.trim()) {
          let raw: unknown;
          try {
            raw = JSON.parse(body);
          } catch {}
          const p = PackExclude.optional().safeParse(
            (raw as { exclude?: unknown } | null)?.exclude,
          );
          if (!p.success || typeof raw !== 'object') return json(400, { code: 'BAD_MESSAGE' });
          exclude = p.data;
        }
        const { result: r, files } = await wsApi.packs.refresh(s, token, 'pack.refresh', exclude);
        return json(
          r === 'ready' ? 200 : r === 'superseded' ? 409 : r === 'too-large' ? 413 : 502,
          {
            code:
              r === 'ready'
                ? 'OK'
                : r === 'too-large'
                  ? 'PACK_TOO_LARGE'
                  : r === 'superseded'
                    ? 'SUPERSEDED'
                    : 'PACK_BUILD_FAILED',
            // same shape as the WS error: names + token counts, largest first (D11)
            ...(r === 'too-large' && { files }),
          },
        );
      }
    }
    if (path === '/api/health') {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (web && !path.startsWith('/api/') && path !== '/ws') {
      try {
        if (await web(req, res, path)) return;
      } catch {
        // a throw here must not become an unhandled rejection (kills the process and every live WS)
        if (!res.headersSent) res.writeHead(500).end();
        else res.destroy();
        return;
      }
    }
    res.writeHead(404).end();
  });
  wsApi = attachWs(server, {
    allowedOrigins: [],
    ...ws,
    store,
    verifier,
  });
  const { shutdown } = wsApi;
  return Object.assign(server, { shutdown });
}
