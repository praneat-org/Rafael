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
  // tests park the Detector / Answerer here to land `pause` mid-flight
  const gates: { detector?: Promise<void>; answerer?: Promise<void>; distinct?: boolean } = {};
  const llm: LlmClient = {
    async complete(req) {
      if (req.model !== 'det') return { text: '' }; // Answerer cache warm-up
      calls.detector++;
      await gates.detector;
      const isQ = req.user.split('\n').at(-1)?.includes('QUESTION') ?? false;
      return {
        text: JSON.stringify({
          isQuestion: isQ,
          question: isQ ? (gates.distinct ? `${SECRET_Q} ${calls.detector}` : SECRET_Q) : '',
          fromCustomer: true,
        }),
        inputTokens: 5,
        outputTokens: 3,
      };
    },
    async stream(_req, onText) {
      calls.answerer++;
      await gates.answerer;
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
  return { llm, calls, gates };
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

async function setup(
  getPack: () => PackIndex | undefined = () => pack,
  o: { config?: typeof config; now?: () => number } = {},
) {
  const f = fakeLlm();
  const provider = new FakeSttProvider({ finalEvery: 1, word: (id) => WORDS[id] });
  app = createApp({
    store: new MemorySessionStore(),
    verifier: async () => ({ email: 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
    brain: { llm: f.llm, config: o.config ?? config, getPack },
    stt: { provider, voiced: () => true, now: o.now },
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

test('pause: stream closed, audio ignored, no cue; resume reopens the stream', async () => {
  const t = await setup();
  t.ws.send(frame(2)); // opens the stream
  await vi.waitFor(() => expect(t.finals()).toHaveLength(1));
  t.send({ t: 'pause' });
  await vi.waitFor(() => expect(t.provider.closes).toBe(1)); // an idle stream would be cut by the provider
  t.ws.send(frame(1));
  await settle();
  expect(t.finals()).toHaveLength(1);
  expect(t.calls.detector).toBe(1);
  expect(t.cues()).toHaveLength(0);
  t.send({ t: 'resume' });
  await settle();
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
  expect(t.provider.starts.length).toBe(2);
  const ids = t.finals().map((m) => (m as { segId: string }).segId);
  expect(new Set(ids).size).toBe(ids.length); // segIds stay unique across the reopen
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

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
}
const dropped = () => out.filter((l) => l.includes('"cue.dropped"') && l.includes('"paused"'));

test('pause while the Detector is still running -> no Answerer call, no cue', async () => {
  const t = await setup();
  const g = gate();
  t.gates.detector = g.p;
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.calls.detector).toBe(1));
  t.send({ t: 'pause' });
  await settle();
  g.open();
  await vi.waitFor(() => expect(dropped()).toHaveLength(1));
  expect(t.calls.answerer).toBe(0);
  expect(t.cues()).toHaveLength(0);
});

test('3 finals queued behind a slow Detector, then pause -> none of them cue, queued ones skip the Detector', async () => {
  const t = await setup();
  const g = gate();
  t.gates.detector = g.p;
  t.ws.send(frame(1));
  t.ws.send(frame(1));
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.finals()).toHaveLength(3));
  await vi.waitFor(() => expect(t.calls.detector).toBe(1));
  t.send({ t: 'pause' });
  await settle();
  g.open();
  await vi.waitFor(() => expect(dropped()).toHaveLength(3));
  expect(t.calls).toEqual({ detector: 1, answerer: 0 });
  expect(t.cues()).toHaveLength(0);
});

test('pause while the Answerer is generating -> the cue is not emitted', async () => {
  const t = await setup();
  const g = gate();
  t.gates.answerer = g.p;
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.calls.answerer).toBe(1));
  t.send({ t: 'pause' });
  await settle();
  g.open();
  await vi.waitFor(() => expect(dropped().length).toBeGreaterThan(0));
  await settle();
  expect(t.cues()).toHaveLength(0);
});

test('ask while paused -> BAD_MESSAGE, no cue; after resume it works', async () => {
  const t = await setup();
  t.send({ t: 'pause' });
  await settle();
  t.send({ t: 'ask', text: 'manual question' });
  await vi.waitFor(() =>
    expect(t.msgs().find((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' }),
  );
  expect(t.calls.answerer).toBe(0);
  t.send({ t: 'resume' });
  await settle();
  t.send({ t: 'ask', text: 'manual question' });
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
});

test('over-budget stages log budget.exceeded (stt, answerer first token, total) without text', async () => {
  let clock = 0;
  const tight = {
    ...config,
    answerer: { ...config.answerer, firstTokenBudgetMs: -1 },
    pipeline: { sttFinalBudgetMs: 800, firstCueBudgetMs: 0 },
  };
  const t = await setup(() => pack, { config: tight, now: () => (clock += 1000) });
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.cues().some((c) => !c.partial)).toBe(true));
  await vi.waitFor(() => expect(out.some((l) => l.includes('"cue.latency"'))).toBe(true));
  const stages = out
    .filter((l) => l.includes('"budget.exceeded"'))
    .map((l) => JSON.parse(l).stage)
    .sort();
  expect(stages).toEqual(['answerer', 'stt', 'total']);
  expect(out.join('\n')).not.toMatch(/SECRET/);
});

test('more than 2 questions in flight -> the extra one is dropped and logged (busy)', async () => {
  const t = await setup();
  const g = gate();
  t.gates.answerer = g.p;
  t.gates.distinct = true;
  for (let i = 0; i < 3; i++) t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.calls.detector).toBe(3));
  await vi.waitFor(() =>
    expect(out.some((l) => l.includes('"cue.dropped"') && l.includes('"busy"'))).toBe(true),
  );
  g.open();
  await vi.waitFor(() => expect(t.cues().filter((c) => !c.partial)).toHaveLength(2));
  expect(out.join('\n')).not.toMatch(/SECRET/);
});

test('slow Detector -> budget.exceeded stage=detector', async () => {
  const tight = { ...config, detector: { ...config.detector, budgetMs: -1 } };
  const t = await setup(() => pack, { config: tight });
  t.ws.send(frame(2));
  await vi.waitFor(() =>
    expect(
      out.some((l) => l.includes('"budget.exceeded"') && l.includes('"stage":"detector"')),
    ).toBe(true),
  );
  expect(out.join('\n')).not.toMatch(/SECRET/);
});

test('a final arriving after session.end is ignored: no Detector call, no cue, no text in logs', async () => {
  const t = await setup();
  t.ws.send(frame(2));
  await vi.waitFor(() => expect(t.finals()).toHaveLength(1));
  t.send({ t: 'session.end' });
  await vi.waitFor(() => expect(t.ws.readyState).toBe(WebSocket.CLOSED));
  t.provider.handlers[0]?.onFinal(SECRET_Q); // late delivery from the provider
  await settle();
  expect(t.calls).toEqual({ detector: 1, answerer: 0 });
  expect(t.cues()).toHaveLength(0);
  expect(out.join('\n')).not.toMatch(/SECRET/);
});

test('pause then quick resume before the Detector answers -> the pre-pause question gives no cue', async () => {
  const t = await setup();
  const g = gate();
  t.gates.detector = g.p;
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.calls.detector).toBe(1));
  t.send({ t: 'pause' });
  t.send({ t: 'resume' });
  await settle();
  g.open();
  await vi.waitFor(() => expect(dropped()).toHaveLength(1));
  expect(t.calls.answerer).toBe(0);
  expect(t.cues()).toHaveLength(0);
});

test('pause then quick resume while the Answerer is generating -> that cue is dropped too', async () => {
  const t = await setup();
  const g = gate();
  t.gates.answerer = g.p;
  t.ws.send(frame(1));
  await vi.waitFor(() => expect(t.calls.answerer).toBe(1));
  t.send({ t: 'pause' });
  t.send({ t: 'resume' });
  await settle();
  g.open();
  await vi.waitFor(() => expect(dropped().length).toBeGreaterThan(0));
  await settle();
  expect(t.cues()).toHaveLength(0);
});
