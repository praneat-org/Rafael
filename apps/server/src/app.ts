import { createServer } from 'node:http';

export function createApp() {
  return createServer((req, res) => {
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
}
