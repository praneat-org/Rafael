import type { AddressInfo } from 'node:net';
import type { LogEvent } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadBrainConfig } from './config.js';
import type { LlmClient, LlmRequest } from './llm.js';
import { SUMMARY_PROMPT, summarize } from './summary.js';

const ev = (seq: number, offsetSec: number, rest: object) =>
  ({
    sessionId: 's1',
    seq,
    ts: '2026-11-18T14:00:00.000+07:00',
    offsetMs: offsetSec * 1000,
    ...rest,
  }) as LogEvent;

const log: LogEvent[] = [
  ev(0, 0, {
    type: 'session.start',
    user: 'a@praneat.com',
    folderId: 'F',
    folderName: 'ACME',
    pack: null,
  }),
  ev(1, 65, { type: 'transcript', segId: '1-1', text: 'ราคา package Pro เท่าไร' }),
  ev(2, 1935, { type: 'transcript', segId: '1-2', text: 'ตกลงใช้ package Pro ครับ' }),
  ev(3, 1950, { type: 'transcript', segId: '1-3', text: 'คุณสมชายส่ง quotation ภายในวันศุกร์' }),
  ev(4, 2000, { type: 'not_found', cueId: 'c1', question: 'มี SLA 99.99 ไหม', latencyMs: 2000 }),
  ev(5, 2010, { type: 'not_found', cueId: 'c2', question: 'ส่วนลด', latencyMs: 900, failed: true }),
];

function fakeLlm(reply: (r: LlmRequest) => string) {
  const calls: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(r) {
      calls.push(r);
      return { text: reply(r) };
    },
    stream: async () => ({ text: '' }),
    createCache: async () => 'c',
    renewCache: async () => {},
    deleteCache: async () => {},
  };
  return { llm, calls };
}

const modelOut = {
  tldr: 'คุย package Pro\nตกลงใช้ Pro\nรอ quotation\nบรรทัดที่สี่ต้องถูกตัด',
  topics: [
    {
      title: 'ราคา',
      discussed: ['ราคา package Pro'],
      decisions: [
        { text: 'ใช้ package Pro', reason: null, at: '00:32:15' },
        { text: 'แต่งขึ้น', reason: null, at: '01:59:59' }, // no such line: dropped
      ],
      parking: [],
    },
  ],
  actions: [
    { what: 'ส่ง quotation', who: 'คุณสมชาย', when: 'วันศุกร์', at: '00:32:30' },
    { what: 'นัด demo', who: 'คุณวิภา', when: 'พรุ่งนี้', at: '00:32:30' }, // never said: blanked
    { what: 'โทรตาม', who: '-', when: '?', at: '00:32:30' }, // punctuation only: blanked
  ],
};

test('claims are checked against the log: no line -> dropped, who / when not said -> null', async () => {
  const f = fakeLlm(() => `\`\`\`json\n${JSON.stringify(modelOut)}\n\`\`\``);
  const { summary, stats } = await summarize(log, { llm: f.llm, model: 'm' });
  expect(f.calls[0]?.system).toBe(SUMMARY_PROMPT);
  expect(f.calls[0]?.user).toContain('[00:32:15] ตกลงใช้ package Pro ครับ');
  expect(f.calls[0]?.user).not.toContain('SLA'); // cue questions are not transcript
  expect(summary.tldr.split('\n')).toHaveLength(3);
  expect(summary.topics[0]?.decisions).toEqual([
    { text: 'ใช้ package Pro', reason: null, at: '00:32:15' },
  ]);
  expect(summary.actions).toEqual([
    { what: 'ส่ง quotation', who: 'คุณสมชาย', when: 'วันศุกร์', at: '00:32:30' },
    { what: 'นัด demo', who: null, when: null, at: '00:32:30' },
    { what: 'โทรตาม', who: null, when: null, at: '00:32:30' },
  ]);
  // "not found" questions go to the parking lot; a model failure does not
  expect(summary.notFound).toEqual([{ text: 'มี SLA 99.99 ไหม', at: '00:33:20' }]);
  expect(stats).toEqual({ chunks: 1, droppedNoLine: 1, blankedWho: 2, blankedWhen: 2 });
});

test('long transcript: split into chunks, merged; tldr from one more call', async () => {
  const f = fakeLlm((r) =>
    r.system === SUMMARY_PROMPT ? JSON.stringify({ ...modelOut, actions: [] }) : 'รวมแล้ว',
  );
  const { summary, stats } = await summarize(log, { llm: f.llm, model: 'm', chunkChars: 30 });
  expect(stats.chunks).toBe(3);
  expect(f.calls).toHaveLength(4);
  expect(summary.tldr).toBe('รวมแล้ว');
  expect(summary.topics).toHaveLength(3);
});

test('bad model output throws (caller answers LLM_UNAVAILABLE)', async () => {
  const f = fakeLlm(() => 'not json');
  await expect(summarize(log, { llm: f.llm, model: 'm' })).rejects.toThrow();
});

let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(async () => {
  vi.restoreAllMocks();
  if (!app) return;
  app.shutdown();
  await new Promise((res) => app?.close(res));
  app = undefined;
});

async function post(body: unknown, token = 'a') {
  const f = fakeLlm(() => JSON.stringify(modelOut));
  app = createApp({
    verifier: async (t) => ({ email: t === 'a' ? 'a@praneat.com' : 'b@praneat.com' }),
    brain: { llm: f.llm, config: loadBrainConfig({ DETECTOR_MODEL: 'd', SUMMARY_MODEL: 'sum' }) },
  });
  app.listen(0);
  const res = await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/api/summary`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { res, calls: f.calls };
}

test('POST /api/summary: own log -> 200 with the summary, model from SUMMARY_MODEL', async () => {
  const { res, calls } = await post({ events: log });
  expect(res.status).toBe(200);
  const b = (await res.json()) as { summary: { actions: unknown[] } };
  expect(b.summary.actions).toHaveLength(3);
  expect(calls[0]?.model).toBe('sum');
});

test('POST /api/summary: another account log -> 403, bad body -> 400, nothing sent to the model', async () => {
  const other = await post({ events: log }, 'b');
  expect(other.res.status).toBe(403);
  expect(other.calls).toHaveLength(0);
  app?.shutdown();
  await new Promise((res) => app?.close(res));
  app = undefined;
  const bad = await post({ events: [{ type: 'nope' }] });
  expect(bad.res.status).toBe(400);
  expect(bad.calls).toHaveLength(0);
});

test('POST /api/summary: a Thai log bigger than one network chunk reaches the model intact', async () => {
  const text = 'ตกลงใช้ package Pro ครับ '.repeat(8000);
  const big = [log[0]!, ev(1, 5, { type: 'transcript', segId: '1-1', text })];
  const { res, calls } = await post({ events: big });
  expect(res.status).toBe(200);
  expect(calls[0]?.user).toContain(text.trim());
});
