import { readdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIO_FRAME_BYTES, encodeAudioFrame, SAMPLES_PER_FRAME } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from './app.js';
import { MemorySessionStore, RESUME_GRACE_MS, SESSION_TTL_MS } from './session/store.js';

// D11 retention: a real session over a real socket leaves nothing behind.
const ORIGIN = 'chrome-extension://testid';
const TOKEN = 'ya29.SECRET-ACCESS-TOKEN';
const PACK_ID = 'pack-SECRET-ID';
const verifier = async () => ({ email: 'alice@praneat.com' });

let out: string[];
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  out = [];
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
  app?.shutdown();
  app?.closeAllConnections();
  await new Promise((r) => app?.close(r));
});

const tmpList = () => readdirSync(tmpdir()).sort().join('|');

async function runSession(store: MemorySessionStore, end: boolean) {
  app = createApp({ store, verifier, allowedOrigins: [ORIGIN] });
  app.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${(app.address() as AddressInfo).port}/ws`, {
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
  return { ...ready, pcmHex: Buffer.from(pcm.buffer).toString('hex').slice(0, 16), ws };
}

function expectNoLeak(r: { sessionId: string; resumeToken: string }) {
  const logs = out.join('\n');
  expect(logs).toContain('session.attached'); // logger really captured something
  for (const secret of [TOKEN, 'ya29', PACK_ID, r.resumeToken, '4a4b', 'JktK'])
    expect(logs).not.toContain(secret);
  expect(logs).not.toMatch(/"(text|bullets|question|transcript|pcm|audio)"/);
}

test('session.end: session + token gone, no audio / token in logs, nothing written to tmp', async () => {
  const before = tmpList();
  const store = new MemorySessionStore();
  const ended = vi.fn();
  store.onEnd(ended);
  const r = await runSession(store, true);
  expect(store.get(r.sessionId)).toBeUndefined();
  expect(store.resume(r.resumeToken, 'alice@praneat.com')).toBeUndefined();
  expect(ended).toHaveBeenCalledTimes(1);
  expect(tmpList()).toBe(before);
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
  expect(ended).toHaveBeenCalledWith(s);
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

test('a throwing end hook does not block deletion or other hooks', () => {
  const store = new MemorySessionStore();
  const ok = vi.fn();
  store.onEnd(() => {
    throw new Error('boom');
  });
  store.onEnd(ok);
  const s = store.create('a@praneat.com', 'p');
  store.end(s.id);
  expect(ok).toHaveBeenCalled();
  expect(store.get(s.id)).toBeUndefined();
});

test('server source never touches the filesystem or child processes', () => {
  const root = join(import.meta.dirname);
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  const bad = files(root)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) =>
      /from 'node:(fs|fs\/promises|child_process)'|from '(fs|child_process)'/.test(
        readFileSync(f, 'utf8'),
      ),
    );
  expect(bad).toEqual([]);
  expect(AUDIO_FRAME_BYTES).toBeGreaterThan(0);
});
