import type { AddressInfo } from 'node:net';
import { encodeAudioFrame, parseServerMessage, type ServerMessage } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import type { PackIndex } from '../brain/answerer.js';
import { loadBrainConfig } from '../brain/config.js';
import type { LlmClient } from '../brain/llm.js';
import { MemorySessionStore } from '../session/store.js';
import { FakeSttProvider } from '../stt/fake.js';

// final transcript -> Detector -> Answerer -> cue, pause; STT = FakeSttProvider, LLM = fake (BE-99)
const ORIGIN = 'chrome-extension://testid';
const config = loadBrainConfig({ DETECTOR_MODEL: 'det', ANSWERER_MODEL: 'ans' });
const A1 = '[deck.pdf › หน้า 3]';
const SECRET_Q = 'SECRET-QUESTION-ราคาเท่าไร';
const pack: PackIndex = [
  { anchor: A1, file: 'deck.pdf', fileId: 'f1', locator: 'หน้า 3', text: 'SECRET-PACK' },
];
// frame id -> the word the fake STT "hears"
const WORDS: Record<number, string> = { 1: SECRET_Q, 2: 'SECRET-chitchat', 3: 'SECRET-chitchat-2' };
const frame = (id: number) =>
  encodeAudioFrame(
    id,
    Int16Array.from({ length: 1600 }, (_, i) => (i ? 0 : id)),
  );

function fakeLlm() {
  const calls = { detector: 0, answerer: 0 };
  const llm: LlmClient = {
    async complete(req) {
      if (req.model !== 'det') return { text: '' }; // Answerer cache warm-up
      calls.detector++;
      const isQ = req.user.split('\n').at(-1)?.includes('QUESTION') ?? false;
      return {
        text: JSON.stringify({
          isQuestion: isQ,
          question: isQ ? SECRET_Q : '',
          fromCustomer: true,
        }),
        inputTokens: 5,
        outputTokens: 3,
      };
    },
    async stream(_req, onText) {
      calls.answerer++;
      onText(`- SECRET-ANSWER ${A1}`);
      return {
        text: `- SECRET-ANSWER ${A1}`,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 8,
      };
    },
    async createCache() {
      return 'cache';
    },
    async renewCache() {},
    async deleteCache() {},
  };
  return { llm, calls };
}

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

async function setup(getPack: () => PackIndex | undefined = () => pack) {
  const f = fakeLlm();
  const provider = new FakeSttProvider({ finalEvery: 1, word: (id) => WORDS[id] });
  app = createApp({
    store: new MemorySessionStore(),
    verifier: async () => ({ email: 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
    brain: { llm: f.llm, config, getPack },
    stt: { provider, voiced: () => true },
  });
  app.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${(app.address() as AddressInfo).port}/ws`, {
    origin: ORIGIN,
  });
  const raw: string[] = [];
  ws.on('message', (d) => raw.push(d.toString()));
  const msgs = (): ServerMessage[] =>
    raw.flatMap((r) => {
      const p = parseServerMessage(r);
      expect(p.ok).toBe(true);
      return p.ok ? [p.data] : [];
    });
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  await new Promise((res) => ws.once('open', res));
  send({ t: 'hello', accessToken: 'x' });
  send({ t: 'session.start', packId: 'p' });
  await vi.waitFor(() => expect(msgs().some((m) => m.t === 'session.ready')).toBe(true));
  const cues = () => msgs().flatMap((m) => (m.t === 'cue' ? [m] : []));
  const finals = () => msgs().flatMap((m) => (m.t === 'transcript' && m.final ? [m] : []));
  return { ...f, provider, ws, send, msgs, cues, finals };
}
const settle = () => new Promise((r) => setTimeout(r, 80));

test('final question -> Detector -> Answerer -> cue with a pack anchor', async () => {
  const t = await setup();
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
  const c = t.cues().at(-1);
  expect(c).toMatchObject({ notFound: false, partial: false, question: SECRET_Q });
  expect(c?.sources).toEqual([{ file: 'deck.pdf', fileId: 'f1', locator: 'หน้า 3' }]);
  expect(t.calls).toEqual({ detector: 1, answerer: 1 });
});

test('final that is not a question -> transcript only, no cue', async () => {
  const t = await setup();
  t.ws.send(frame(2));
  await vi.waitFor(() => expect(t.finals()).toHaveLength(1));
  await vi.waitFor(() => expect(t.calls.detector).toBe(1));
  await settle();
  expect(t.cues()).toHaveLength(0);
  expect(t.calls.answerer).toBe(0);
});

test('same question twice within 60 s -> one cue (Detector dedupe)', async () => {
  const t = await setup();
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.calls.detector).toBe(2));
  await settle();
  expect(t.cues().filter((c) => !c.partial)).toHaveLength(1);
});

test('ask skips the Detector', async () => {
  const t = await setup();
  t.send({ t: 'ask', text: 'manual question' });
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
  expect(t.calls).toEqual({ detector: 0, answerer: 1 });
});

test('pause: audio ignored, a late final makes no cue; resume works again', async () => {
  const t = await setup();
  t.ws.send(frame(2)); // opens the stream
  await vi.waitFor(() => expect(t.finals()).toHaveLength(1));
  t.send({ t: 'pause' });
  await settle();
  t.ws.send(frame(1));
  t.provider.handlers[0]?.onFinal(SECRET_Q); // provider still delivers a final after pause
  await settle();
  expect(t.finals()).toHaveLength(2); // transcript still shown...
  expect(t.calls.detector).toBe(1); // ...but only the pre-pause frame reached the Detector
  expect(t.cues()).toHaveLength(0);
  t.send({ t: 'resume' });
  await settle();
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
});

test('no pack -> Detector is not called', async () => {
  const t = await setup(() => undefined);
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.finals()).toHaveLength(1));
  await settle();
  expect(t.calls).toEqual({ detector: 0, answerer: 0 });
  expect(t.cues()).toHaveLength(0);
});

test('latency log per cue: sttFinalMs / detectorMs / serverTotalMs, no text (D11)', async () => {
  const t = await setup();
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
  await vi.waitFor(() => expect(out.some((l) => l.includes('"cue.latency"'))).toBe(true));
  const lat = JSON.parse(out.find((l) => l.includes('"cue.latency"')) as string);
  expect(lat).toMatchObject({ stage: 'segment', outcome: 'answered' });
  for (const k of ['sttFinalMs', 'detectorMs', 'serverTotalMs', 'firstCueMs', 'ms', 'queueMs'])
    expect(typeof lat[k], k).toBe('number');
  expect(out.some((l) => l.includes('"detector"') && l.includes('"outcome":"question"'))).toBe(
    true,
  );
  expect(out.join('\n')).not.toMatch(/SECRET/);
});
