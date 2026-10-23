import { createServer } from 'node:http';

export function createApp() {
  return createServer((req, res) => {
    if (req.url === '/api/health') {
      // D18: unauthenticated, fixed body, GET/HEAD only
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });
}
