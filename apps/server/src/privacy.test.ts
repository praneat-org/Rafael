import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeAudioFrame, SAMPLES_PER_FRAME } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from './app.js';
import { MemorySessionStore, RESUME_GRACE_MS, SESSION_TTL_MS } from './session/store.js';

// D11 retention: a real session over a real socket leaves nothing behind.
const ORIGIN = 'chrome-extension://testid';
const TOKEN = 'ya29.SECRET-ACCESS-TOKEN';
// not Drive-id shaped on purpose: the audit log (BE-97) records a Drive folder id, never other client text
const PACK_ID = 'pack SECRET ID';
const verifier = async () => ({ email: 'alice@praneat.com' });

let out: string[];
let app: ReturnType<typeof createApp> | undefined;
let tmp: string;
const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
beforeEach(() => {
  out = [];
  app = undefined;
  // per-test temp dir: os.tmpdir() (what any temp-file code would use) points here
  tmp = mkdtempSync(join(tmpdir(), 'rafael-priv-'));
  process.env.TMPDIR = process.env.TMP = process.env.TEMP = tmp;
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, k).mockImplementation((...a) => void out.push(a.join(' ')));
  for (const s of [process.stdout, process.stderr])
    vi.spyOn(s, 'write').mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
  const a = app;
  if (!a) return;
  a.shutdown();
  a.closeAllConnections();
  await new Promise((r) => a.close(r));
});

async function runSession(store: MemorySessionStore, end: boolean) {
  const a = createApp({ store, verifier, allowedOrigins: [ORIGIN] });
  app = a;
  a.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${(a.address() as AddressInfo).port}/ws`, {
    origin: ORIGIN,
  });
  const msgs: { t: string; sessionId?: string; resumeToken?: string }[] = [];
  ws.on('message', (d, bin) => bin || msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ v: 1, t: 'hello', accessToken: TOKEN }));
  ws.send(JSON.stringify({ v: 1, t: 'session.start', packId: PACK_ID }));
  await vi.waitFor(() => expect(msgs.find((m) => m.t === 'session.ready')).toBeDefined());
  const ready = msgs.find((m) => m.t === 'session.ready') as {
    sessionId: string;
    resumeToken: string;
  };
  const pcm = new Int16Array(SAMPLES_PER_FRAME).fill(0x4a4b); // distinctive audio bytes
  for (let i = 0; i < 5; i++) ws.send(encodeAudioFrame(i, pcm));
  await vi.waitFor(() => expect(store.get(ready.sessionId)?.audioFrames).toBe(5));
  const closed = new Promise((r) => ws.once('close', r));
  if (end) {
    ws.send(JSON.stringify({ v: 1, t: 'session.end' }));
    await closed;
  } else ws.terminate();
  return { ...ready, frame: Buffer.from(pcm.buffer) };
}

// every encoding a logger could plausibly emit for these audio bytes
function audioNeedles(pcm: Buffer): string[] {
  const part = pcm.subarray(0, 30);
  return [
    part.toString('hex'),
    part.toString('latin1').slice(0, 12),
    ...[0, 1, 2].flatMap((o) => [
      pcm
        .subarray(o, o + 30)
        .toString('base64')
        .slice(0, 24),
      pcm
        .subarray(o, o + 30)
        .toString('base64url')
        .slice(0, 24),
    ]),
  ];
}

function expectNoLeak(r: { sessionId: string; resumeToken: string; frame: Buffer }) {
  const logs = out.join('\n');
  expect(logs).toContain('session.attached'); // logger really captured something
  for (const secret of [TOKEN, 'ya29', PACK_ID, r.resumeToken, ...audioNeedles(r.frame)])
    expect(logs).not.toContain(secret);
  expect(logs).not.toMatch(/"(text|bullets|question|transcript|pcm|audio)"/);
}

test('session.end: session + token gone, no audio / token in logs, nothing written to tmp', async () => {
  const store = new MemorySessionStore();
  const ended = vi.fn();
  store.onEnd(ended);
  const r = await runSession(store, true);
  expect(store.get(r.sessionId)).toBeUndefined();
  expect(store.resume(r.resumeToken, 'alice@praneat.com')).toBeUndefined();
  expect(ended).toHaveBeenCalledTimes(1);
  expect(readdirSync(tmp)).toEqual([]);
  expectNoLeak(r);
});

test('socket lost: session deleted after the grace period', async () => {
  const store = new MemorySessionStore(SESSION_TTL_MS, 50); // short grace, real timers
  const ended = vi.fn();
  store.onEnd(ended);
  const r = await runSession(store, false);
  await vi.waitFor(() => expect(store.get(r.sessionId)).toBeUndefined());
  expect(ended).toHaveBeenCalledTimes(1);
  expectNoLeak(r);
});

test('24 h TTL ends an idle session and runs the end hooks', () => {
  vi.useFakeTimers();
  const store = new MemorySessionStore();
  const ended = vi.fn();
  store.onEnd(ended);
  const s = store.create('alice@praneat.com', 'p');
  vi.advanceTimersByTime(SESSION_TTL_MS);
  expect(store.get(s.id)).toBeUndefined();
  expect(store.resume(s.resumeToken, 'alice@praneat.com')).toBeUndefined();
  expect(ended).toHaveBeenCalledWith(s, 'expired');
});

test('grace period (5 min) after disconnect ends the session', () => {
  vi.useFakeTimers();
  const store = new MemorySessionStore();
  const s = store.create('alice@praneat.com', 'p');
  const sock = { close() {} };
  store.attach(s.id, sock);
  store.detach(s.id, sock);
  vi.advanceTimersByTime(RESUME_GRACE_MS);
  expect(store.get(s.id)).toBeUndefined();
});

test('throwing / rejecting end hooks do not block deletion, other hooks or cause unhandledRejection', async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const store = new MemorySessionStore();
  const ok = vi.fn();
  store.onEnd(() => {
    throw new Error('boom');
  });
  store.onEnd(async () => {
    throw new Error('async boom with customer text');
  });
  store.onEnd(ok);
  const s = store.create('a@praneat.com', 'p');
  store.end(s.id);
  await new Promise((r) => setTimeout(r, 20)); // let a stray rejection surface
  process.off('unhandledRejection', unhandled);
  expect(ok).toHaveBeenCalled();
  expect(store.get(s.id)).toBeUndefined();
  expect(unhandled).not.toHaveBeenCalled();
  expect(vi.mocked(console.log).mock.calls.join()).not.toContain('customer text');
});

const FS_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](?:node:)?(?:fs|fs\/promises|child_process)['"]/;

test.each([
  `import { x } from 'node:fs';`,
  `import fs from "fs";`,
  `import { readFile } from 'fs/promises'`,
  `import * as f from 'node:fs/promises'`,
  `const f = await import('node:fs')`,
  `const f = require("fs")`,
  `import 'fs'`,
  `import { spawn } from 'node:child_process'`,
])('fs matcher catches: %s', (src) => expect(src).toMatch(FS_IMPORT));

test('server source never touches the filesystem or child processes', () => {
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  const bad = files(import.meta.dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => FS_IMPORT.test(readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});
