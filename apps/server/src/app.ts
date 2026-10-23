import { createServer } from 'node:http';
import { denyAll } from './auth/verifier.js';
import { MemorySessionStore } from './session/store.js';
import { attachWs, type WsOptions } from './ws/server.js';

export function createApp(ws?: Partial<WsOptions>) {
  const server = createServer((req, res) => {
    if (req.url === '/api/health') {
      // D18: unauthenticated, fixed body, GET only
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });
  const wsApi = attachWs(server, {
    store: new MemorySessionStore(),
    verifier: denyAll,
    allowedOrigins: [],
    ...ws,
  });
  return Object.assign(server, { shutdown: wsApi.shutdown });
}
