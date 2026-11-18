import type { AddressInfo } from 'node:net';
import {
  encodeAudioFrame,
  type LogEvent,
  parseServerMessage,
  type ServerMessage,
} from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import type { PackIndex } from '../brain/answerer.js';
import { loadBrainConfig } from '../brain/config.js';
import type { LlmClient } from '../brain/llm.js';
import { record, snapshot } from '../session/convlog.js';
import { MemorySessionStore } from '../session/store.js';
import { FakeSttProvider } from '../stt/fake.js';

const ORIGIN = 'chrome-extension://testid';
const A1 = '[deck.pdf › หน้า 3]';
const pack: PackIndex = [
  { anchor: A1, file: 'deck.pdf', fileId: 'f1', locator: 'หน้า 3', text: 'PACK' },
];

let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (!app) return;
  app.shutdown();
  app.closeAllConnections();
  await new Promise((res) => app?.close(res));
  app = undefined;
});

function llm(answer: string): LlmClient {
  return {
    complete: async () => ({ text: '' }),
    async stream(_req, onText) {
      onText(answer);
      return { text: answer, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
    },
    createCache: async () => 'c',
    renewCache: async () => {},
    deleteCache: async () => {},
  };
}

function start(opts: Partial<Parameters<typeof createApp>[0]>) {
  const store = new MemorySessionStore();
  app = createApp({
    store,
    verifier: async (t) => ({ email: t === 'bob' ? 'b@praneat.com' : 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
    ...opts,
  });
  app.listen(0);
  return { store, port: (app.address() as AddressInfo).port };
}

async function client(port: number, start: object, token = 'x') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
  const msgs: ServerMessage[] = [];
  ws.on('message', (d, bin) => {
    if (bin) return;
    const p = parseServerMessage(d.toString()); // every message, the log included, is protocol v1
    expect(p.ok).toBe(true);
    if (p.ok) msgs.push(p.data);
  });
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  await new Promise((res) => ws.once('open', res));
  send({ t: 'hello', accessToken: token });
  send({ t: 'session.start', ...start });
  await vi.waitFor(() =>
    expect(msgs.some((m) => m.t === 'session.ready' || m.t === 'error')).toBe(true),
  );
  const ready = msgs.find((m) => m.t === 'session.ready');
  const getLog = async () => {
    const n = msgs.filter((m) => m.t === 'log').length;
    send({ t: 'log.get' });
    await vi.waitFor(() => expect(msgs.filter((m) => m.t === 'log').length).toBe(n + 1));
    return (msgs.filter((m) => m.t === 'log').at(-1) as { events: LogEvent[] }).events;
  };
  return { ws, msgs, send, ready, getLog };
}

const frame = (id: number) => {
  const f = new Int16Array(1600);
  f[0] = id;
  return encodeAudioFrame(id, f);
};

test('reconnect mid-session: log keeps every final once; pause leaves a marker and no transcript', async () => {
  const { port } = start({
    stt: { provider: new FakeSttProvider({ finalEvery: 2 }), voiced: (p) => p[0] !== 0 },
  });
  const a = await client(port, { packId: 'folder-1' });
  for (const i of [1, 2]) a.ws.send(frame(i));
  await vi.waitFor(async () =>
    expect((await a.getLog()).filter((e) => e.type === 'transcript')).toHaveLength(1),
  );
  a.send({ t: 'pause' });
  a.send({ t: 'pause' }); // repeated pause: still one marker
  for (const i of [3, 4]) a.ws.send(frame(i)); // dropped while paused
  a.send({ t: 'resume' });
  for (const i of [5, 6]) a.ws.send(frame(i));
  await vi.waitFor(async () =>
    expect((await a.getLog()).filter((e) => e.type === 'transcript')).toHaveLength(2),
  );
  // socket drops; same account resumes on a new one
  a.ws.terminate();
  const resumeToken = a.ready && 'resumeToken' in a.ready ? a.ready.resumeToken : '';
  const b = await client(port, { packId: 'folder-1', resumeToken });
  expect(b.ready).toBeDefined();
  for (const i of [7, 8]) b.ws.send(frame(i));
  await vi.waitFor(async () =>
    expect((await b.getLog()).filter((e) => e.type === 'transcript')).toHaveLength(3),
  );
  const log = await b.getLog();
  expect(log.map((e) => e.type)).toEqual([
    'session.start',
    'transcript',
    'pause',
    'resume',
    'transcript',
    'transcript',
  ]);
  const texts = log.flatMap((e) => (e.type === 'transcript' ? [e.text] : []));
  expect(texts).toEqual(['w1 w2', 'w5 w6', 'w7 w8']); // w3 w4 were said during the pause
  expect(new Set(log.map((e) => e.seq)).size).toBe(log.length);
  expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i));
  const sessionId = a.ready && 'sessionId' in a.ready ? a.ready.sessionId : '';
  expect(sessionId).not.toBe('');
  for (const e of log) {
    expect(e.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+07:00$/);
    expect(e.sessionId).toBe(sessionId); // the first connection's session, also after reconnect
  }
  expect(log[0]).toMatchObject({ user: 'a@praneat.com', folderId: 'folder-1', offsetMs: 0 });

  // session.end: the final copy (with session.end) arrives before the socket closes
  b.send({ t: 'session.end' });
  await new Promise((res) => b.ws.once('close', res));
  const final = (b.msgs.filter((m) => m.t === 'log').at(-1) as { events: LogEvent[] }).events;
  expect(final.at(-1)?.type).toBe('session.end');
  expect(final.filter((e) => e.type === 'transcript')).toHaveLength(3);
});

test('typed ask, answered cue and a "not found" cue are in the log with latency and sources', async () => {
  let answer = `- ราคา 100 บาท ${A1}`;
  const { port } = start({
    brain: {
      llm: { ...llm(''), stream: async (r, on) => llm(answer).stream(r, on) },
      config: loadBrainConfig({ DETECTOR_MODEL: 'd', ANSWERER_MODEL: 'a' }),
      getPack: () => pack,
    },
  });
  const c = await client(port, { packId: 'p' });
  c.send({ t: 'ask', text: 'ราคาเท่าไร' });
  await vi.waitFor(async () => expect((await c.getLog()).some((e) => e.type === 'cue')).toBe(true));
  answer = 'NOT_FOUND';
  c.send({ t: 'ask', text: 'มี SLA ไหม' });
  await vi.waitFor(async () =>
    expect((await c.getLog()).some((e) => e.type === 'not_found')).toBe(true),
  );
  const log = await c.getLog();
  expect(log.map((e) => e.type)).toEqual(['session.start', 'ask', 'cue', 'ask', 'not_found']);
  expect(log[1]).toMatchObject({ type: 'ask', text: 'ราคาเท่าไร' });
  expect(log[2]).toMatchObject({
    type: 'cue',
    sources: [{ file: 'deck.pdf', fileId: 'f1', locator: 'หน้า 3' }],
  });
  expect(log[2]).toHaveProperty('latencyMs');
  expect(log[4]).toMatchObject({ type: 'not_found', question: expect.any(String) });
});

test('log.get only on a socket with a session; another account cannot resume into it', async () => {
  const { port } = start({});
  const a = await client(port, { packId: 'p' });
  const resumeToken = a.ready && 'resumeToken' in a.ready ? a.ready.resumeToken : '';
  const bob = await client(port, { packId: 'p', resumeToken }, 'bob');
  expect(bob.msgs.find((m) => m.t === 'error')).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  bob.send({ t: 'log.get' });
  await vi.waitFor(() =>
    expect(bob.msgs.filter((m) => m.t === 'error' && m.code === 'SESSION_NOT_FOUND')).toHaveLength(
      2,
    ),
  );
  expect(bob.msgs.some((m) => m.t === 'log')).toBe(false);
});

test('record is idempotent by id; end empties the log (D11)', () => {
  const store = new MemorySessionStore();
  const s = store.create('a@x', 'p');
  record(s, { type: 'transcript', segId: '1-1', text: 'hi' }, '1-1');
  record(s, { type: 'transcript', segId: '1-1', text: 'hi' }, '1-1');
  expect(snapshot(s).filter((e) => e.type === 'transcript')).toHaveLength(1);
  store.end(s.id);
  expect(s.log).toHaveLength(0);
});

test('2 h session (2,000 finals + 100 cues): snapshot well under 3 s', () => {
  const s = new MemorySessionStore().create('a@x', 'p');
  for (let i = 0; i < 2000; i++)
    record(s, { type: 'transcript', segId: `1-${i}`, text: 'ข้อความ '.repeat(20) }, `1-${i}`);
  for (let i = 0; i < 100; i++)
    record(
      s,
      { type: 'cue', cueId: `c${i}`, question: 'q', bullets: ['b'], sources: [], latencyMs: 1 },
      `c${i}`,
    );
  const t0 = performance.now();
  const json = JSON.stringify(snapshot(s, Date.now()));
  expect(performance.now() - t0).toBeLessThan(500);
  expect(json.length).toBeLessThan(2_000_000);
});

test('a model failure is logged as not_found with failed: true; log.get echoes its id', async () => {
  const { port } = start({
    brain: {
      llm: {
        ...llm(''),
        stream: async () => {
          throw new Error('provider down');
        },
      },
      config: loadBrainConfig({ DETECTOR_MODEL: 'd', ANSWERER_MODEL: 'a' }),
      getPack: () => pack,
    },
  });
  const c = await client(port, { packId: 'p' });
  c.send({ t: 'ask', text: 'ราคาเท่าไร' });
  await vi.waitFor(async () =>
    expect((await c.getLog()).some((e) => e.type === 'not_found')).toBe(true),
  );
  expect((await c.getLog()).at(-1)).toMatchObject({ type: 'not_found', failed: true });
  c.send({ t: 'log.get', id: 'r-42' });
  await vi.waitFor(() => expect(c.msgs.some((m) => m.t === 'log' && m.id === 'r-42')).toBe(true));
});
