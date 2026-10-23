import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { createApp } from './app.js';

test('GET /api/health returns ok', async () => {
  const server = createApp().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  } finally {
    server.close();
  }
});

test('non-GET/HEAD /api/health returns 405', async () => {
  const server = createApp().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/api/health`;
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await fetch(url, { method })).status).toBe(405);
    }
    expect((await fetch(url, { method: 'HEAD' })).status).toBe(200);
  } finally {
    server.close();
  }
});
