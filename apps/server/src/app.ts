import { createServer } from 'node:http';

export function createApp() {
  return createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });
}
