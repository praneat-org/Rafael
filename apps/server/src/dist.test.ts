import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { expect, test } from 'vitest';

// runs the built server with plain node (what Docker / Cloud Run will do); `pnpm test` builds first
test('built server answers /api/health', async () => {
  const child = spawn('node', ['dist/index.js'], { env: { ...process.env, PORT: '0' } });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      createInterface({ input: child.stdout }).once('line', (l) => resolve(JSON.parse(l).port));
      child.once('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
  } finally {
    child.kill();
  }
});
