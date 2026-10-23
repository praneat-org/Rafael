// Manual check: start -> drop socket -> reconnect with resumeToken -> same sessionId.
// Server: NODE_ENV=development DEV_FAKE_AUTH=1 pnpm --filter server dev      Client: node apps/server/scripts/ws-resume.mjs [ws://127.0.0.1:8080/ws]
import WebSocket from 'ws';

const url = process.argv[2] ?? 'ws://127.0.0.1:8080/ws';
const connect = () =>
  new Promise((resolve) => {
    const ws = new WebSocket(url, { origin: 'http://localhost' });
    ws.once('open', () => {
      ws.send(JSON.stringify({ v: 1, t: 'hello', accessToken: 'dev' }));
      resolve(ws);
    });
  });
const ready = (ws, msg) =>
  new Promise((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString())));
    ws.send(JSON.stringify({ v: 1, t: 'session.start', packId: 'demo', ...msg }));
  });

const a = await connect();
const first = await ready(a, {});
console.log('start   ->', first.t, first.sessionId);
a.terminate(); // socket drops mid-session
const b = await connect();
const second = await ready(b, { resumeToken: first.resumeToken });
console.log('resume  ->', second.t, second.sessionId);
const c = await connect();
const bad = await ready(c, { resumeToken: 'wrong' });
console.log('bad tok ->', bad.t, bad.code);
console.log(first.sessionId === second.sessionId ? 'OK same session' : 'FAIL different session');
for (const ws of [b, c]) ws.close();
process.exit(first.sessionId === second.sessionId ? 0 : 1);
