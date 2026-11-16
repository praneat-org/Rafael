// Follow-up questions: Detector / ask resolution + Answerer context from the session's Q/A history.
// Fake LLM only (skill cue-brain): this checks the plumbing and prompts; semantics are for eval.
import type { ServerMessage } from '@rafael/protocol';
import { afterEach, expect, test, vi } from 'vitest';
import { MemorySessionStore } from '../session/store.js';
import { SYSTEM_PROMPT as ANSWER_PROMPT, type PackIndex } from './answerer.js';
import { loadBrainConfig } from './config.js';
import { SYSTEM_PROMPT as DETECT_PROMPT, RESOLVE_PROMPT } from './detector.js';
import { renderHistory } from './history.js';
import type { LlmClient, LlmRequest } from './llm.js';
import { createPipeline } from './pipeline.js';

const config = loadBrainConfig({ DETECTOR_MODEL: 'det', ANSWERER_MODEL: 'ans' });
const pack: PackIndex = [
  { anchor: '[spec.pdf › หน้า 2]', file: 'spec.pdf', fileId: 'f1', locator: 'หน้า 2', text: 'x' },
  {
    anchor: '[price.xlsx › tab Infra]',
    file: 'price.xlsx',
    fileId: 'f2',
    locator: 'tab Infra',
    text: 'y',
  },
];

/** Routes by system prompt: Detector / resolver get scripted JSON, the Answerer gets scripted bullets. */
function fakeLlm(script: { detect?: string[]; resolve?: string[]; answer?: string[] }) {
  const reqs: { kind: 'detect' | 'resolve' | 'answer'; req: LlmRequest }[] = [];
  const llm: LlmClient = {
    async complete(req) {
      if (req.user === 'ping') return { text: '' }; // cache warm-up
      const kind = req.system === RESOLVE_PROMPT ? 'resolve' : 'detect';
      expect(req.system).toBe(kind === 'resolve' ? RESOLVE_PROMPT : DETECT_PROMPT);
      reqs.push({ kind, req });
      return { text: script[kind]?.shift() ?? '{}' };
    },
    async stream(req, onText) {
      reqs.push({ kind: 'answer', req });
      const text = script.answer?.shift() ?? 'NOT_FOUND';
      onText(text);
      return { text, inputTokens: 1000, cacheReadTokens: 900, outputTokens: 20 };
    },
    createCache: async () => 'cache-1',
    renewCache: async () => {},
    deleteCache: async () => {},
  };
  return { llm, reqs };
}
const detected = (question: string) =>
  JSON.stringify({ isQuestion: true, question, fromCustomer: true });

function setup(script: Parameters<typeof fakeLlm>[0]) {
  const f = fakeLlm(script);
  const store = new MemorySessionStore();
  const p = createPipeline({ llm: f.llm, config, getPack: () => pack }, store);
  const s = store.create('a@b.c', 'pack');
  const sent: ServerMessage[] = [];
  const send = (m: ServerMessage) => sent.push(m);
  const finals = () => sent.filter((m) => m.t === 'cue' && !m.partial);
  const say = async (text: string) => {
    const n = finals().length;
    await p.onFinalSegment(s, { text }, send);
    await vi.waitFor(() => expect(finals().length).toBe(n + 1));
  };
  const ask = async (text: string) => {
    const n = finals().length;
    expect(p.ask(s, text, send)).toBe('ok');
    await vi.waitFor(() => expect(finals().length).toBe(n + 1));
  };
  const last = () => finals().at(-1) as Extract<ServerMessage, { t: 'cue' }>;
  const user = (kind: 'detect' | 'resolve' | 'answer') =>
    f.reqs.filter((r) => r.kind === kind).at(-1)?.req.user ?? '';
  return { ...f, s, store, say, ask, last, user };
}

let logs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  logs = [];
});
const captureLogs = () =>
  vi.spyOn(console, 'log').mockImplementation((l: string) => void logs.push(l));

test('renderHistory: oldest first, anchors stripped, bounded by turns then chars', () => {
  const t = (i: number) => ({
    question: `q${i}`,
    bullets: [`a${i} [f.pdf › หน้า ${i}]`],
    notFound: false,
  });
  const all = [t(1), t(2), t(3), { question: 'q4', bullets: [], notFound: true }];
  expect(renderHistory(all, { maxTurns: 2, maxChars: 1000 })).toEqual({
    text: 'Q: q3\nA: a3\nQ: q4\nA: (not in the pack)',
    turns: 2,
  });
  expect(renderHistory(all, { maxTurns: 9, maxChars: 40 }).turns).toBe(2);
  expect(renderHistory([], { maxTurns: 9, maxChars: 30 })).toEqual({ text: '', turns: 0 });
});

test('pronoun / elided follow-up: Detector sees the Q/A, cue shows the resolved question, Answerer gets context after the cached pack', async () => {
  captureLogs();
  const t = setup({
    detect: [
      detected('ระบบรองรับผู้ใช้พร้อมกันเท่าไหร่'),
      detected('ถ้าผู้ใช้พร้อมกัน 10,000 คน ระบบต้องเพิ่มอะไร'),
      detected('ค่าใช้จ่ายของการเพิ่ม node สำหรับผู้ใช้ 10,000 คนเท่าไหร่'),
    ],
    answer: [
      '- รองรับ 2,000 คนพร้อมกัน [spec.pdf › หน้า 2]',
      '- เพิ่ม node อีก 4 ตัว [spec.pdf › หน้า 2]',
      '- node ละ 5,000 บาทต่อเดือน [price.xlsx › tab Infra]',
    ],
  });
  await t.say('ระบบรองรับผู้ใช้พร้อมกันเท่าไหร่ครับ');
  expect(t.user('detect')).not.toContain('EARLIER Q&A'); // first question: no history yet
  expect(t.user('answer')).toBe('ระบบรองรับผู้ใช้พร้อมกันเท่าไหร่');

  await t.say('แล้วถ้า 10,000 คนล่ะ ต้องเพิ่มอะไร');
  expect(t.user('detect')).toContain(
    'EARLIER Q&A:\nQ: ระบบรองรับผู้ใช้พร้อมกันเท่าไหร่\nA: รองรับ 2,000 คนพร้อมกัน',
  );
  expect(t.user('detect')).not.toContain('[spec.pdf'); // history is not a source: no anchors
  expect(t.last().question).toBe('ถ้าผู้ใช้พร้อมกัน 10,000 คน ระบบต้องเพิ่มอะไร');

  await t.say('ค่าใช้จ่ายส่วนนั้นเท่าไหร่');
  const u = t.user('answer');
  expect(u.startsWith('CONVERSATION SO FAR:\nQ: ระบบรองรับ')).toBe(true);
  expect(u).toContain('Q: ถ้าผู้ใช้พร้อมกัน 10,000 คน ระบบต้องเพิ่มอะไร\nA: เพิ่ม node อีก 4 ตัว');
  expect(u.endsWith('\n\nQUESTION: ค่าใช้จ่ายของการเพิ่ม node สำหรับผู้ใช้ 10,000 คนเท่าไหร่')).toBe(true);
  expect(t.last().sources).toEqual([{ file: 'price.xlsx', fileId: 'f2', locator: 'tab Infra' }]);

  // pack stays the cached prefix: same handle every call, history only in the user message
  const answers = t.reqs.filter((r) => r.kind === 'answer').map((r) => r.req);
  expect(new Set(answers.map((r) => r.cache))).toEqual(new Set(['cache-1']));
  expect(new Set(answers.map((r) => r.system)).size).toBe(1);
  expect(answers[0]?.system.startsWith(ANSWER_PROMPT)).toBe(true);

  // history size is logged apart, never its text (D11)
  const ans = logs.filter((l) => l.includes('"msg":"answerer"')).map((l) => JSON.parse(l));
  expect(ans.map((a) => a.historyTurns)).toEqual([0, 1, 2]);
  expect(ans[2].historyChars).toBeGreaterThan(0);
  expect(ans[2].cacheReadTokens).toBe(900);
  expect(logs.join('\n')).not.toContain('node');
});

test('an old answer claim without a pack anchor is dropped: history is never a source (D10)', async () => {
  const t = setup({
    detect: [detected('ราคาเท่าไหร่'), detected('ราคานั้นรวม VAT ไหม')],
    answer: ['- 5,000 บาท [price.xlsx › tab Infra]', '- รวม VAT แล้ว (ตามคำตอบก่อนหน้า)'],
  });
  await t.say('ราคาเท่าไหร่');
  await t.say('ราคานั้นรวม VAT ไหม');
  expect(t.last()).toMatchObject({ notFound: true, bullets: [], sources: [] });
});

test('follow-up to a "not in source" answer keeps that context', async () => {
  const t = setup({
    detect: [detected('มี on-premise ไหม'), detected('ถ้าไม่มี on-premise มี private cloud ไหม')],
    answer: ['NOT_FOUND', '- มี private cloud ใน region ไทย [spec.pdf › หน้า 2]'],
  });
  await t.say('มี on-premise ไหมครับ');
  expect(t.last().notFound).toBe(true);
  await t.say('แล้วถ้าไม่มี มีแบบ private cloud ไหม');
  expect(t.user('detect')).toContain('Q: มี on-premise ไหม\nA: (not in the pack)');
  expect(t.user('answer')).toContain('A: (not in the pack)');
  expect(t.last().question).toBe('ถ้าไม่มี on-premise มี private cloud ไหม');
});

test('topic switch: the new question is used as resolved, the prompts tell both models not to carry the old topic', async () => {
  const t = setup({
    detect: [detected('ระบบรองรับผู้ใช้พร้อมกันเท่าไหร่'), detected('onboarding ใช้เวลากี่วัน')],
    answer: ['- 2,000 คน [spec.pdf › หน้า 2]', 'NOT_FOUND'],
  });
  await t.say('ระบบรองรับผู้ใช้พร้อมกันเท่าไหร่');
  await t.say('ขอเปลี่ยนเรื่อง onboarding ใช้เวลากี่วัน');
  expect(t.last().question).toBe('onboarding ใช้เวลากี่วัน');
  expect(t.user('answer').endsWith('QUESTION: onboarding ใช้เวลากี่วัน')).toBe(true);
  expect(DETECT_PROMPT).toMatch(/changes topic[^.]*never carry/);
  expect(ANSWER_PROMPT).toMatch(/changes topic, ignore the conversation/);
  expect(RESOLVE_PROMPT).toMatch(/changes topic[^.]*never carry/);
});

test('typed ask after a voice question is resolved against the history; failure keeps the typed text', async () => {
  captureLogs();
  const t = setup({
    detect: [detected('Enterprise plan ราคาเท่าไหร่')],
    resolve: [JSON.stringify({ question: 'Enterprise plan รวม support 24/7 ไหม' }), 'garbage'],
    answer: [
      '- 50,000 บาทต่อปี [price.xlsx › tab Infra]',
      '- support 24/7 [spec.pdf › หน้า 2]',
      'NOT_FOUND',
    ],
  });
  await t.say('Enterprise plan ราคาเท่าไหร่ครับ');
  await t.ask('แล้วรวม support 24/7 ไหม');
  expect(t.user('resolve')).toBe(
    'EARLIER Q&A:\nQ: Enterprise plan ราคาเท่าไหร่\nA: 50,000 บาทต่อปี\n\nQUESTION: แล้วรวม support 24/7 ไหม',
  );
  expect(t.last().question).toBe('Enterprise plan รวม support 24/7 ไหม');

  await t.ask('ส่วนลดล่ะ');
  expect(t.last().question).toBe('ส่วนลดล่ะ'); // invalid resolver output -> as typed
  const r = logs.filter((l) => l.includes('"msg":"resolve"')).map((l) => JSON.parse(l));
  expect(r.map((x) => x.outcome)).toEqual(['resolved', 'invalid']);
  expect(typeof r[0].resolveMs === 'number' || typeof r[0].ms === 'number').toBe(true);
});

test('first typed ask (no history) skips the resolver: no extra latency', async () => {
  const t = setup({ answer: ['NOT_FOUND'] });
  await t.ask('ราคาเท่าไหร่');
  expect(t.reqs.some((r) => r.kind === 'resolve')).toBe(false);
});

test('history is per session and goes with the session on end (D11)', async () => {
  const t = setup({
    detect: [detected('ราคาเท่าไหร่')],
    answer: ['- 5,000 [price.xlsx › tab Infra]'],
  });
  await t.say('ราคาเท่าไหร่');
  const other = t.store.create('a@b.c', 'pack');
  expect(other.cues).toEqual([]);
  // resume keeps the same Session object, so the context is still there
  expect(t.store.resume(t.s.resumeToken, 'a@b.c')?.cues).toHaveLength(1);
  t.store.end(t.s.id);
  expect(t.s.cues).toEqual([]);
});
