import { describe, expect, it } from 'vitest';
import { loadBrainConfig } from './config.js';
import { createDetector, type DetectorLog, normalizeQuestion, similarity } from './detector.js';
import type { LlmClient, LlmRequest } from './llm.js';

const config = loadBrainConfig({ DETECTOR_MODEL: 'fake-model' });

// Fake LLM: replies are scripted per call; records the requests it received.
function fake(replies: (string | Error)[]) {
  const reqs: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(req) {
      reqs.push(req);
      const r = replies.shift();
      if (r === undefined || r instanceof Error) throw r ?? new Error('no reply');
      return { text: r, inputTokens: 10, outputTokens: 5 };
    },
  };
  return { llm, reqs };
}
const q = (question: string, fromCustomer = true) =>
  JSON.stringify({ isQuestion: true, question, fromCustomer });
const no = JSON.stringify({ isQuestion: false, question: '', fromCustomer: false });

function setup(replies: (string | Error)[]) {
  const f = fake(replies);
  let t = 0;
  const logs: DetectorLog[] = [];
  const d = createDetector({ llm: f.llm, config, now: () => t, log: (e) => logs.push(e) });
  return {
    ...f,
    d,
    logs,
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe('detector', () => {
  it('direct Thai question from customer -> question', async () => {
    const s = setup([q('ระบบรองรับผู้ใช้พร้อมกันกี่คน')]);
    const r = await s.d.onFinalSegment({ text: 'ระบบรองรับผู้ใช้พร้อมกันกี่คนครับ', speaker: 'customer' });
    expect(r).toEqual({ kind: 'question', question: 'ระบบรองรับผู้ใช้พร้อมกันกี่คน' });
    expect(s.reqs[0]?.model).toBe('fake-model');
    expect(s.logs[0]).toMatchObject({ stage: 'detector', outcome: 'question', attempts: 1 });
  });

  it('mixed Thai/English question', async () => {
    const s = setup([q('SSO รองรับ Google Workspace ไหม')]);
    const r = await s.d.onFinalSegment({ text: 'does SSO รองรับ Google Workspace ไหมครับ' });
    expect(r.kind).toBe('question');
  });

  it('statement -> not-question', async () => {
    const s = setup([no]);
    expect(await s.d.onFinalSegment({ text: 'ขอบคุณครับ' })).toEqual({
      kind: 'none',
      reason: 'not-question',
    });
  });

  it('rhetorical question by pitcher -> none (model says isQuestion=false or fromCustomer=false)', async () => {
    const s = setup([no, q('แล้วทำไมต้องเป็นเรา', false)]);
    expect((await s.d.onFinalSegment({ text: 'แล้วทำไมต้องเป็นเรา? เพราะเรามีทีมเก่ง' })).kind).toBe(
      'none',
    );
    expect(await s.d.onFinalSegment({ text: 'แล้วทำไมต้องเป็นเรา?' })).toEqual({
      kind: 'none',
      reason: 'not-customer',
    });
  });

  it('prompt carries rhetorical negatives; window holds only last 30 s and newest segment is last', async () => {
    const s = setup([no, no, no]);
    s.at(0);
    await s.d.onFinalSegment({ text: 'old' });
    s.at(20_000);
    await s.d.onFinalSegment({ text: 'mid', speaker: 'customer' });
    s.at(31_000); // 'old' (31 s ago) falls out, 'mid' (11 s ago) stays
    await s.d.onFinalSegment({ text: 'new' });
    expect(s.reqs[0]?.system).toContain('RHETORICAL');
    expect(s.reqs[2]?.user).toBe('[customer] mid\nnew');
  });

  it('same question within 60 s -> duplicate; after 60 s -> allowed again', async () => {
    const s = setup([
      q('ระบบรองรับผู้ใช้พร้อมกันกี่คน'),
      q('ระบบรองรับผู้ใช้พร้อมกันกี่คนครับ'),
      q('ระบบรองรับผู้ใช้พร้อมกันกี่คน'),
    ]);
    s.at(0);
    expect((await s.d.onFinalSegment({ text: 'a' })).kind).toBe('question');
    s.at(30_000);
    expect(await s.d.onFinalSegment({ text: 'b' })).toEqual({ kind: 'none', reason: 'duplicate' });
    s.at(61_000); // first asked at 0 -> expired
    expect((await s.d.onFinalSegment({ text: 'c' })).kind).toBe('question');
  });

  it('different question within 60 s is not a duplicate', async () => {
    const s = setup([q('ระบบรองรับผู้ใช้พร้อมกันกี่คน'), q('ราคาต่อเดือนเท่าไหร่')]);
    await s.d.onFinalSegment({ text: 'a' });
    expect((await s.d.onFinalSegment({ text: 'b' })).kind).toBe('question');
  });

  it('invalid model output -> not a question', async () => {
    const s = setup(['sorry I cannot', '{"isQuestion":"yes"}']);
    expect(await s.d.onFinalSegment({ text: 'a' })).toEqual({ kind: 'none', reason: 'invalid' });
    expect(await s.d.onFinalSegment({ text: 'b' })).toEqual({ kind: 'none', reason: 'invalid' });
  });

  it('retries once on failure, then gives up with no cue', async () => {
    const ok = setup([new Error('boom'), q('ราคาเท่าไหร่')]);
    expect((await ok.d.onFinalSegment({ text: 'a' })).kind).toBe('question');
    expect(ok.logs[0]?.attempts).toBe(2);

    const bad = setup([new Error('x'), new Error('y'), q('never reached')]);
    expect(await bad.d.onFinalSegment({ text: 'a' })).toEqual({ kind: 'none', reason: 'error' });
    expect(bad.reqs).toHaveLength(2);
  });

  it('warns (no text) when a segment exceeds the 600 ms budget', async () => {
    const f = fake([no]);
    let p = 0;
    const warns: unknown[] = [];
    const d = createDetector({
      llm: f.llm,
      config,
      perf: () => (p += 700),
      warn: (e) => warns.push(e),
    });
    await d.onFinalSegment({ text: 'ข้อความลับ' });
    expect(warns).toEqual([{ stage: 'detector', ms: 700, budgetMs: 600 }]);
  });

  it('log never contains transcript or question text (D11)', async () => {
    const s = setup([q('คำถามลับของลูกค้า')]);
    await s.d.onFinalSegment({ text: 'ข้อความลับ' });
    const l = JSON.stringify(s.logs);
    expect(l).not.toContain('ลับ');
  });
});

describe('dedupe helpers', () => {
  it('normalize strips trailing particles and punctuation', () => {
    expect(normalizeQuestion('ราคาเท่าไหร่ครับ?')).toBe('ราคาเท่าไหร่');
    expect(normalizeQuestion('ขอถามหน่อยค่ะ ราคาเท่าไหร่คะ')).toBe('ขอถามหน่อยราคาเท่าไหร่');
  });
  it('normalize never cuts particles inside words', () => {
    expect(normalizeQuestion('ใครชนะ')).toBe('ใครชนะ');
    expect(normalizeQuestion('คะแนนเท่าไหร่')).toBe('คะแนนเท่าไหร่');
    expect(normalizeQuestion('ครับผมขอถาม')).toBe('ครับผมขอถาม');
  });
  it('similarity', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('ราคาเท่าไหร่', 'ผู้ใช้พร้อมกันกี่คน')).toBeLessThan(0.3);
  });
  const sim = (a: string, b: string) => similarity(normalizeQuestion(a), normalizeQuestion(b));
  it('true duplicates score well above threshold, similar-but-different well below', () => {
    const t = loadBrainConfig({ DETECTOR_MODEL: 'm' }).detector.dedupeSimilarity;
    const dup = [
      sim('ระบบรองรับผู้ใช้พร้อมกันกี่คน', 'ระบบรองรับผู้ใช้พร้อมกันกี่คนครับ'),
      sim('ราคาต่อเดือนเท่าไหร่', 'ราคาต่อเดือนเท่าไหร่คะ?'),
    ];
    const diff = [
      sim('ระบบรองรับผู้ใช้พร้อมกันกี่คน', 'ระบบรองรับกี่ภาษา'),
      sim('ราคาต่อเดือนเท่าไหร่', 'ราคาต่อปีเท่าไหร่'),
      sim('ใครชนะการประมูลครั้งก่อน', 'คะแนนการประมูลครั้งก่อนเท่าไหร่'),
    ];
    for (const d of dup) expect(d).toBeGreaterThanOrEqual(t + 0.1);
    for (const d of diff) expect(d).toBeLessThanOrEqual(t - 0.1);
  });
});

describe('config', () => {
  it('requires DETECTOR_MODEL', () => {
    expect(() => loadBrainConfig({})).toThrow();
  });
});
