import type { AddressInfo } from 'node:net';
import type { ServerMessage } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import type { PackIndex } from '../brain/answerer.js';
import { loadBrainConfig } from '../brain/config.js';
import type { LlmClient } from '../brain/llm.js';
import { MemorySessionStore } from '../session/store.js';

const ORIGIN = 'chrome-extension://testid';
const config = loadBrainConfig({ DETECTOR_MODEL: 'det', ANSWERER_MODEL: 'ans' });
const A1 = '[deck.pdf › หน้า 3]';
const PACK_TEXT = 'SECRET-PACK-TEXT';
const QUESTION = 'SECRET-QUESTION ราคาเท่าไร';
const ANSWER = 'SECRET-ANSWER ราคา 100 บาท';
const pack: PackIndex = [
  { anchor: A1, file: 'deck.pdf', fileId: 'f1', locator: 'หน้า 3', text: PACK_TEXT },
];

function fake(deltas: string[], gate?: Promise<void>) {
  const live = new Set<string>();
  let n = 0;
  const calls = { stream: 0, complete: 0 };
  const llm: LlmClient = {
    async complete() {
      calls.complete++;
      return { text: '' };
    },
    async stream(_req, onText) {
      calls.stream++;
      await gate;
      for (const d of deltas) onText(d);
      return { text: deltas.join(''), inputTokens: 10, outputTokens: 5, cacheReadTokens: 8 };
    },
    async createCache() {
      const h = `cache-${++n}`;
      live.add(h);
      return h;
    },
    async renewCache() {},
    async deleteCache(h) {
      live.delete(h);
    },
  };
  return { llm, live, calls };
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
  deltas: string[],
  getPack: () => PackIndex | undefined = () => pack,
  gate?: Promise<void>,
) {
  const f = fake(deltas, gate);
  const store = new MemorySessionStore();
  app = createApp({
    store,
    verifier: async () => ({ email: 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
    brain: { llm: f.llm, config, getPack },
  });
  app.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${(app.address() as AddressInfo).port}/ws`, {
    origin: ORIGIN,
  });
  const msgs: ServerMessage[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  await new Promise((res) => ws.once('open', res));
  send({ t: 'hello', accessToken: 'x' });
  send({ t: 'session.start', packId: 'p' });
  await vi.waitFor(() => expect(msgs.some((m) => m.t === 'session.ready')).toBe(true));
  return { ...f, store, ws, msgs, send };
}
const cues = (msgs: ServerMessage[]) => msgs.flatMap((m) => (m.t === 'cue' ? [m] : []));

test('ask -> partial cue then final cue, bullets carry a pack anchor', async () => {
  const t = await setup([`- ${ANSWER} ${A1}\n`, `- ราคาเพิ่ม 5 ${A1}`]);
  t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(cues(t.msgs).some((c) => !c.partial)).toBe(true));
  const cs = cues(t.msgs);
  expect(cs.length).toBeGreaterThanOrEqual(3); // 2 partial + final
  expect(cs.filter((c) => c.partial).length).toBeGreaterThanOrEqual(2);
  expect(cs.at(-1)?.partial).toBe(false);
  expect(new Set(cs.map((c) => c.cueId)).size).toBe(1);
  expect(cs.at(-1)?.bullets).toHaveLength(2);
  expect(cs.at(-1)?.sources).toEqual([{ file: 'deck.pdf', fileId: 'f1', locator: 'หน้า 3' }]);
  expect(cs.at(-1)?.notFound).toBe(false);
});

test('answer outside the pack -> notFound final cue, no sources', async () => {
  const t = await setup(['NOT_FOUND']);
  t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(cues(t.msgs).some((c) => !c.partial)).toBe(true));
  const c = cues(t.msgs).at(-1);
  expect(c).toMatchObject({ notFound: true, bullets: [], sources: [], partial: false });
});

test('a bullet with an anchor that is not in the pack is dropped (D10)', async () => {
  const t = await setup(['- invented claim [fake.pdf › หน้า 9]\n']);
  t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(cues(t.msgs).some((c) => !c.partial)).toBe(true));
  expect(cues(t.msgs).at(-1)).toMatchObject({ notFound: true, sources: [] });
});

test('ask before the pack is ready -> PACK_NOT_READY, nothing is generated; works once the pack exists', async () => {
  let ready = false;
  const t = await setup([`- ${ANSWER} ${A1}`], () => (ready ? pack : undefined));
  t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(t.msgs.some((m) => m.t === 'error')).toBe(true));
  expect(t.msgs.find((m) => m.t === 'error')).toMatchObject({ code: 'PACK_NOT_READY' });
  expect(t.calls.stream).toBe(0);
  expect(t.live.size).toBe(0);
  ready = true;
  t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(cues(t.msgs).some((c) => !c.partial)).toBe(true));
});

test('ask text over 2000 chars -> BAD_MESSAGE, never reaches the model', async () => {
  const t = await setup([`- ${ANSWER} ${A1}`]);
  t.send({ t: 'ask', text: 'ก'.repeat(2001) });
  await vi.waitFor(() => expect(t.msgs.some((m) => m.t === 'error')).toBe(true));
  expect(t.msgs.find((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
  expect(t.calls.stream).toBe(0);
});

test('session end disposes the answerer: cache deleted at the provider', async () => {
  const t = await setup([`- ${ANSWER} ${A1}`]);
  t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(cues(t.msgs).some((c) => !c.partial)).toBe(true));
  expect(t.live.size).toBe(1); // cache exists while the session lives
  t.send({ t: 'session.end' });
  await vi.waitFor(() => expect(t.live.size).toBe(0));
});

test('ask right after session.end creates no answerer and no cache (D21)', async () => {
  const t = await setup([`- ${ANSWER} ${A1}`]);
  t.send({ t: 'session.end' });
  t.send({ t: 'ask', text: QUESTION });
  await new Promise((r) => setTimeout(r, 200));
  expect(t.calls.stream).toBe(0);
  expect(t.live.size).toBe(0);
});

test('in-flight cap: 3rd concurrent ask -> BAD_MESSAGE, first two still answer', async () => {
  let release = () => {};
  const t = await setup(
    [`- ${ANSWER} ${A1}`],
    () => pack,
    new Promise<void>((r) => {
      release = r;
    }),
  );
  for (let i = 0; i < 3; i++) t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(t.msgs.some((m) => m.t === 'error')).toBe(true));
  expect(t.msgs.find((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
  release();
  await vi.waitFor(() => expect(cues(t.msgs).filter((c) => !c.partial)).toHaveLength(2));
});

test('logs: latency per stage per cue, no question / answer / pack text (D11)', async () => {
  const t = await setup([`- ${ANSWER} ${A1}`]);
  t.send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(cues(t.msgs).some((c) => !c.partial)).toBe(true));
  await vi.waitFor(() => expect(out.some((l) => l.includes('cue.latency'))).toBe(true));
  const lat = JSON.parse(out.find((l) => l.includes('cue.latency')) as string);
  expect(lat).toMatchObject({ stage: 'ask', outcome: 'answered', bullets: 1 });
  for (const k of ['cueId', 'queueMs', 'firstCueMs', 'ms']) expect(lat).toHaveProperty(k);
  const ans = JSON.parse(out.find((l) => l.includes('"answerer"')) as string);
  expect(ans).toHaveProperty('firstTokenMs');
  const all = out.join('\n');
  for (const secret of ['SECRET-QUESTION', 'SECRET-ANSWER', PACK_TEXT, 'ราคา']) {
    expect(all).not.toContain(secret);
  }
});

test('ask with no brain configured -> LLM_UNAVAILABLE (not PACK_NOT_READY)', async () => {
  app = createApp({
    store: new MemorySessionStore(),
    verifier: async () => ({ email: 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
  });
  app.listen(0);
  const port = (app.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
  const msgs: ServerMessage[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  await new Promise((res) => ws.once('open', res));
  send({ t: 'hello', accessToken: 'tok' });
  send({ t: 'session.start', packId: 'folder-1' });
  await vi.waitFor(() => expect(msgs.some((m) => m.t === 'session.ready')).toBe(true));
  send({ t: 'ask', text: QUESTION });
  await vi.waitFor(() => expect(msgs.some((m) => m.t === 'error')).toBe(true));
  expect(msgs.find((m) => m.t === 'error')).toMatchObject({ code: 'LLM_UNAVAILABLE' });
});
