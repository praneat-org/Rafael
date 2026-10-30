import { createServer } from 'node:http';
import { ExcludeIds } from '@rafael/protocol';
import { z } from 'zod';
import { audit } from './audit.js';
import { denyAll } from './auth/verifier.js';
import { MemorySessionStore } from './session/store.js';
import { attachWs, type WsOptions } from './ws/server.js';

export function createApp(ws?: Partial<WsOptions>) {
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
      // BE-108: re-read the Drive folder into the pack of the caller's own session
      const refresh = /^\/api\/pack\/([\w-]+)\/refresh$/.exec(path);
      if (refresh) {
        const json = (code: number, body: object) =>
          res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();
        const s = store.get(refresh[1]!);
        // another user's session looks the same as a missing one
        if (!s || s.email !== who.email || !wsApi?.packs)
          return json(404, { code: 'SESSION_NOT_FOUND' });
        // optional JSON body { exclude?: string[] } (BE-112); empty body = keep the last list
        let raw = '';
        for await (const c of req) {
          raw += c;
          if (raw.length > 64 * 1024) return json(400, { code: 'BAD_MESSAGE' });
        }
        let exclude: string[] | undefined;
        if (raw.trim()) {
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {}
          const p = z.strictObject({ exclude: ExcludeIds.optional() }).safeParse(body);
          if (!p.success) return json(400, { code: 'BAD_MESSAGE' });
          exclude = p.data.exclude;
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
