import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';

// runs the built server with plain node (what Docker / Cloud Run will do); `pnpm test` builds first
test('built server answers /api/health', async () => {
  const port = 18080 + Math.floor(Math.random() * 1000);
  const child = spawn('node', ['dist/index.js'], { env: { ...process.env, PORT: String(port) } });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
  } finally {
    child.kill();
  }
});
