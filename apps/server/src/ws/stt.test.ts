import type { AddressInfo } from 'node:net';
import { encodeAudioFrame, parseServerMessage, type ServerMessage } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import { MemorySessionStore } from '../session/store.js';
import { FakeSttProvider } from '../stt/fake.js';
import type { SttOptions } from '../stt/service.js';

const ORIGIN = 'chrome-extension://testid';
const word = (id: number) => (id > 0 ? `SECRET-WORD-${id}` : undefined);
const pcm = (id: number) => {
  const f = new Int16Array(1600);
  f[0] = id;
  return f;
};

let out: string[];
let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (!app) return;
  app.shutdown();
  app.closeAllConnections();
  await new Promise((res) => app?.close(res));
});

async function setup(stt?: Partial<SttOptions>, provider = new FakeSttProvider({ word })) {
  const store = new MemorySessionStore();
  app = createApp({
    store,
    verifier: async () => ({ email: 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
    stt: { provider, ...stt },
  });
  app.listen(0);
  const port = (app.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: ORIGIN,
  });
  const raw: string[] = [];
  ws.on('message', (d) => raw.push(d.toString()));
  const msgs = () =>
    raw.flatMap((r) => {
      const p = parseServerMessage(r); // every server message must satisfy protocol v1
      expect(p.ok).toBe(true);
      return p.ok ? [p.data] : [];
    });
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  await new Promise((res) => ws.once('open', res));
  send({ t: 'hello', accessToken: 'x' });
  send({ t: 'session.start', packId: 'p' });
  await vi.waitFor(() => expect(msgs().some((m) => m.t === 'session.ready')).toBe(true));
  const audio = (from: number, to: number) => {
    for (let i = from; i <= to; i++) ws.send(encodeAudioFrame(i, pcm(i)));
  };
  return { provider, store, port, ws, msgs, send, audio };
}
const transcripts = (ms: ServerMessage[]) => ms.flatMap((m) => (m.t === 'transcript' ? [m] : []));

test('audio frames -> partial then final transcript messages (protocol v1)', async () => {
  const t = await setup();
  t.audio(1, 3);
  await vi.waitFor(() => expect(transcripts(t.msgs()).some((m) => m.final)).toBe(true));
  const ts = transcripts(t.msgs());
  expect(ts.filter((m) => !m.final).map((m) => m.text)).toEqual([
    'SECRET-WORD-1',
    'SECRET-WORD-1 SECRET-WORD-2',
    'SECRET-WORD-1 SECRET-WORD-2 SECRET-WORD-3',
  ]);
  expect(ts.at(-1)).toMatchObject({
    final: true,
    text: 'SECRET-WORD-1 SECRET-WORD-2 SECRET-WORD-3',
  });
});

test('rollover over the socket: every word once, in order', async () => {
  const t = await setup({ rolloverMs: 2000, overlapMs: 500 });
  t.audio(1, 60);
  await vi.waitFor(() => expect(t.provider.starts.length).toBeGreaterThanOrEqual(3));
  await vi.waitFor(() => {
    const text = transcripts(t.msgs())
      .filter((m) => m.final)
      .map((m) => m.text)
      .join(' ');
    expect(text).toContain('SECRET-WORD-54');
  });
  const text = transcripts(t.msgs())
    .filter((m) => m.final)
    .map((m) => m.text)
    .join(' ');
  const ids = [...text.matchAll(/SECRET-WORD-(\d+)/g)].map((m) => Number(m[1]));
  expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => i + 1));
});

test('final segments reach the Brain callback with the session', async () => {
  const seen: string[] = [];
  const t = await setup({
    onFinal: (s, seg) => void seen.push(`${s.email}|${seg.text}`),
    getHints: () => ['Praneat'],
  });
  t.audio(1, 3);
  await vi.waitFor(() =>
    expect(seen).toEqual(['a@praneat.com|SECRET-WORD-1 SECRET-WORD-2 SECRET-WORD-3']),
  );
  expect(t.provider.starts).toEqual([['Praneat']]);
});

test('provider down -> error STT_UNAVAILABLE, session stays usable', async () => {
  const p = new FakeSttProvider({ word });
  p.failStarts = 1;
  const t = await setup({}, p);
  t.audio(1, 1);
  await vi.waitFor(() =>
    expect(t.msgs().find((m) => m.t === 'error')).toMatchObject({ code: 'STT_UNAVAILABLE' }),
  );
  expect(t.ws.readyState).toBe(WebSocket.OPEN);
});

test('session.end closes the stream; later frames never open a new one; log has no transcript (D11)', async () => {
  const t = await setup();
  t.audio(1, 3);
  await vi.waitFor(() => expect(t.provider.starts.length).toBe(1));
  t.send({ t: 'session.end' });
  await vi.waitFor(() => expect(t.ws.readyState).toBe(WebSocket.CLOSED));
  expect(t.provider.starts.length).toBe(1);
  expect(out.join('\n')).not.toContain('SECRET-WORD');
});

test('audio before session.start is ignored', async () => {
  const t = await setup();
  const ws2 = new WebSocket(`ws://127.0.0.1:${t.port}/ws`, {
    origin: ORIGIN,
  });
  await new Promise((res) => ws2.once('open', res));
  ws2.send(JSON.stringify({ v: 1, t: 'hello', accessToken: 'x' }));
  ws2.send(encodeAudioFrame(1, pcm(1)));
  await new Promise((r) => setTimeout(r, 50));
  expect(t.provider.starts.length).toBe(0);
  ws2.close();
});

test('session.end flushes the pending final to the client before the socket closes', async () => {
  const t = await setup();
  t.audio(1, 2); // finalEvery=3: two words still pending
  await vi.waitFor(() => expect(transcripts(t.msgs()).length).toBe(2)); // 2 partials
  t.send({ t: 'session.end' });
  await vi.waitFor(() => expect(t.ws.readyState).toBe(WebSocket.CLOSED));
  expect(
    transcripts(t.msgs())
      .filter((m) => m.final)
      .map((m) => m.text),
  ).toEqual(['SECRET-WORD-1 SECRET-WORD-2']);
});
