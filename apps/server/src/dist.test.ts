import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { expect, test } from 'vitest';
import WebSocket from 'ws';

// runs the built bundle with plain node (what Docker / Cloud Run will do); `pnpm test` builds first.
// The /ws leg proves @rafael/protocol is really bundled in (no src/*.ts import at runtime).
test('built server answers /api/health and speaks protocol v1 on /ws', async () => {
  const child = spawn('node', ['dist/index.js'], {
    env: { ...process.env, PORT: '0', DEV_FAKE_AUTH: '1', NODE_ENV: 'development' },
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      createInterface({ input: child.stdout }).once('line', (l) => resolve(JSON.parse(l).port));
      child.once('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://localhost' });
    const reply = new Promise<{ t: string }>((resolve) =>
      ws.once('message', (d) => resolve(JSON.parse(d.toString()))),
    );
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ v: 1, t: 'hello', accessToken: 'x' }));
    ws.send(JSON.stringify({ v: 1, t: 'session.start', packId: 'p' }));
    expect((await reply).t).toBe('session.ready');
    ws.close();
  } finally {
    child.kill();
  }
});
