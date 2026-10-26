import { createServer } from 'node:http';
import { audit } from './audit.js';
import { denyAll } from './auth/verifier.js';
import { MemorySessionStore } from './session/store.js';
import { attachWs, type WsOptions } from './ws/server.js';

export function createApp(ws?: Partial<WsOptions>) {
  const verifier = ws?.verifier ?? denyAll;
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    // D13/D18: every /api/* needs a verified Google token; only GET /api/health is exempt
    if (path.startsWith('/api/') && !(path === '/api/health' && req.method === 'GET')) {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
      const who = m?.[1] ? await verifier(m[1]).catch(() => null) : null;
      if (!who) {
        audit({ event: 'auth.denied', source: 'http' });
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"code":"UNAUTHORIZED"}');
        return;
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
  const store = ws?.store ?? new MemorySessionStore();
  // one place for session.end / session.expired, whichever path ended it (explicit, grace, TTL)
  store.onEnd((s, reason) =>
    audit({
      event: reason === 'expired' ? 'session.expired' : 'session.end',
      email: s.email,
      sessionId: s.id,
    }),
  );
  const wsApi = attachWs(server, {
    store,
    allowedOrigins: [],
    ...ws,
    verifier,
  });
  return Object.assign(server, { shutdown: wsApi.shutdown });
}
