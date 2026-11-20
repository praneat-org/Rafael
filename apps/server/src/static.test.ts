import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from './app.js';
import { parseWebOrigins } from './ws/server.js';

let dir: string;
let secretFile: string;
let server: ReturnType<typeof createApp>;
let port: number;

beforeAll(() => {
  // synthetic build output, outside the repo
  const base = mkdtempSync(join(tmpdir(), 'rafael-web-'));
  dir = join(base, 'dist');
  secretFile = join(base, 'secret.txt'); // sibling of dist: what a traversal would reach
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(secretFile, 'TOP-SECRET');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'app-abc123.css'), 'a{}');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  server = createApp({ allowedOrigins: [] }, { webDist: dir });
  server.listen(0);
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.shutdown();
  server.closeAllConnections();
  server.close();
  rmSync(join(dir, '..'), { recursive: true, force: true });
});

const get = (path: string, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method });
// fetch() normalizes ".." away; node:http sends the raw path
const raw = (path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    request({ port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    })
      .on('error', reject)
      .end();
  });

test('index.html at / : html, no-cache, security headers incl. GSI-ready CSP', async () => {
  const r = await get('/');
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(r.headers.get('cache-control')).toBe('no-cache');
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  const csp = r.headers.get('content-security-policy') ?? '';
  expect(csp).toContain('https://accounts.google.com/gsi/client');
  expect(csp).toContain(
    "connect-src 'self' https://accounts.google.com/gsi/ https://www.googleapis.com",
  );
  expect(csp).not.toMatch(/wss:|\*\.googleapis/);
  expect(await r.text()).toContain('<title>spa</title>');
});

test('hashed assets: right type, cached for a year', async () => {
  const js = await get('/assets/app-abc123.js');
  expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect((await get('/assets/app-abc123.css')).headers.get('content-type')).toContain('text/css');
  const ico = await get('/favicon.svg');
  expect(ico.headers.get('content-type')).toBe('image/svg+xml');
  expect(ico.headers.get('cache-control')).toBe('public, max-age=3600');
});

test('SPA fallback for extensionless routes, 404 for a missing file with an extension', async () => {
  const r = await get('/session/abc');
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-cache');
  expect(await r.text()).toContain('<title>spa</title>');
  expect((await get('/assets/missing.js')).status).toBe(404);
});

test('HEAD works, POST to a static path is 404', async () => {
  expect((await get('/', 'HEAD')).status).toBe(200);
  expect((await get('/', 'POST')).status).toBe(404);
});

test('/api and /ws are never served from the web build', async () => {
  expect((await get('/api/nope')).status).toBe(401); // auth gate, not index.html
  expect((await get('/api/health')).status).toBe(200);
  expect(await (await get('/api/health')).json()).toEqual({ ok: true });
  expect((await get('/ws')).status).toBe(404);
});

test('path traversal never leaves the web dir', async () => {
  for (const p of [
    '/../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/..%5csecret.txt',
    '//../secret.txt',
  ]) {
    const r = await raw(p);
    expect([400, 404], p).toContain(r.status);
    expect(r.body, p).not.toContain('TOP-SECRET');
    expect(r.body, p).not.toContain('<title>spa</title>');
  }
  expect((await raw('/%00')).status).toBe(400);
  expect((await raw('/%E0%A4%A')).status).toBe(400); // malformed escape
});

test('WS: Host is never trusted: Host evil.com + Origin https://evil.com -> 403', async () => {
  const outcome = (origin: string, host?: string) =>
    new Promise<string>((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin,
        ...(host && { headers: { host } }),
      });
      ws.once('open', () => {
        ws.close();
        res('open');
      });
      ws.once('unexpected-response', (_r, resp) => res(String(resp.statusCode)));
      ws.once('error', () => {});
    });
  expect(await outcome('https://evil.com', 'evil.com')).toBe('403');
  expect(await outcome(`https://127.0.0.1:${port}`)).toBe('403'); // even the server's own host, unless listed
});

test('WS: PUBLIC_ORIGIN (via allowedOrigins) accepted while the web build is served', async () => {
  const web = createApp(
    { allowedOrigins: ['https://rafael.example.com'] },
    { webDist: dir },
  ).listen(0);
  try {
    const p = (web.address() as AddressInfo).port;
    const status = (origin: string) =>
      new Promise<string>((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, { origin });
        ws.once('open', () => {
          ws.close();
          res('open');
        });
        ws.once('unexpected-response', (_r, resp) => res(String(resp.statusCode)));
        ws.once('error', () => {});
      });
    expect(await status('https://rafael.example.com')).toBe('open');
    expect(await status('https://evil.com')).toBe('403');
  } finally {
    web.shutdown();
    web.closeAllConnections();
    web.close();
  }
});

test('without a web dir nothing is served', async () => {
  const api = createApp({ allowedOrigins: [] }).listen(0);
  try {
    const p = (api.address() as AddressInfo).port;
    expect((await fetch(`http://127.0.0.1:${p}/`)).status).toBe(404);
  } finally {
    api.shutdown();
    api.closeAllConnections();
    api.close();
  }
});

test('an exact ALLOWED_WEB_ORIGINS entry is accepted via allowedOrigins', async () => {
  const api = createApp({ allowedOrigins: ['https://app.example.com'] }).listen(0);
  try {
    const p = (api.address() as AddressInfo).port;
    const ok = await new Promise<string>((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, { origin: 'https://app.example.com' });
      ws.once('open', () => {
        ws.close();
        res('open');
      });
      ws.once('unexpected-response', (_r, resp) => res(String(resp.statusCode)));
      ws.once('error', () => {});
    });
    expect(ok).toBe('open');
  } finally {
    api.shutdown();
    api.closeAllConnections();
    api.close();
  }
});

test('web origin entries are normalized: trailing slash, path and upper case still match; junk is skipped', async () => {
  const bad = vi.fn();
  const origins = parseWebOrigins(
    [
      'HTTPS://Rafael.Example.com/',
      ' https://b.example.com/app?x=1 ',
      'not a url',
      'ftp://x.example.com',
      '',
    ],
    bad,
  );
  expect(origins).toEqual(['https://rafael.example.com', 'https://b.example.com']);
  expect(bad).toHaveBeenCalledTimes(2);
  const api = createApp({ allowedOrigins: origins }).listen(0);
  try {
    const p = (api.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, { origin: 'https://rafael.example.com' });
    const r = await new Promise<string>((res) => {
      ws.once('open', () => {
        ws.close();
        res('open');
      });
      ws.once('unexpected-response', (_r, resp) => res(String(resp.statusCode)));
      ws.once('error', () => {});
    });
    expect(r).toBe('open');
  } finally {
    api.shutdown();
    api.closeAllConnections();
    api.close();
  }
});

test('an aborted download destroys the file stream (no leaked fd)', async () => {
  writeFileSync(join(dir, 'assets', 'big-1.js'), Buffer.alloc(32 * 1024 * 1024, 97));
  const fdsBefore = readdirSync('/proc/self/fd').length;
  await new Promise<void>((resolve) => {
    const req = request({ port, path: '/assets/big-1.js' }, (res) => {
      res.once('data', () => {
        req.destroy(); // client goes away mid-download
        resolve();
      });
    });
    req.on('error', () => {});
    req.end();
  }).catch(() => {});
  await vi.waitFor(
    () => expect(readdirSync('/proc/self/fd').length).toBeLessThanOrEqual(fdsBefore + 1),
    {
      timeout: 3000,
    },
  );
});
