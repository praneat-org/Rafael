import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrices } from '../../../bench/eval/src/cost.js';
import { parseKey } from '../../../bench/eval/src/key.js';
import { buildReport } from '../../../bench/eval/src/report.js';
import { loadBrainConfig } from '../src/brain/config.js';
import type { LlmClient } from '../src/brain/llm.js';
import type { SttProvider } from '../src/stt/provider.js';
import { auditReport } from './audio-report.js';
import { assertSyntheticDump, parseTimeline, parseWav, runAudio } from './audio-runner.js';
import { buildFixturePack } from './text-runner.js';

const fx = new URL('../../../bench/eval/fixtures/', import.meta.url).pathname;
const keys = parseKey(readFileSync(`${fx}synthetic-deal/key.csv`, 'utf8')).slice(0, 3);
const config = loadBrainConfig({ DETECTOR_MODEL: 'd', ANSWERER_MODEL: 'a' });

function wav(pcm: Int16Array, rate = 16000, ch = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(36 + pcm.length * 2, 4);
  h.write('WAVEfmt ', 8, 'latin1');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2 * ch, 28);
  h.writeUInt16LE(2 * ch, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1');
  h.writeUInt32LE(pcm.length * 2, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer)]);
}

// "speech" = loud frames; STT finalises the next question text after 3 silent frames
const fakeStt = (texts: string[]): SttProvider => ({
  start(_h, h) {
    let n = 0;
    let voiced = false;
    let silent = 0;
    return {
      push(pcm) {
        if (pcm.some((x) => Math.abs(x) > 800)) {
          voiced = true;
          silent = 0;
        } else if (voiced && ++silent === 3) {
          voiced = false;
          h.onFinal(texts[n++] ?? '');
        }
      },
      async close() {},
    };
  },
});

const fakeLlm = (): LlmClient => ({
  async complete(req) {
    const q = req.user.split('\n').at(-1);
    return { text: JSON.stringify({ isQuestion: true, question: q, fromCustomer: true }) };
  },
  async stream(req, onText) {
    const k = keys.find((x) => x.question === req.user);
    onText(k?.anchor ? `- ${k.answer} ${k.anchor}\n` : 'NOT_FOUND');
    return { text: '', inputTokens: 100, cacheReadTokens: 90, outputTokens: 10 };
  },
  async createCache() {
    return 'c1';
  },
  async renewCache() {},
  async deleteCache() {},
});

// 3 questions of 1 s speech at 0 / 4 / 8 s, audio clock sped up 5x (frameMs 20)
const speech = (ms: number[]) => {
  const pcm = new Int16Array(16 * 9500);
  for (const s of ms) pcm.fill(5000, s * 16, (s + 1000) * 16);
  return pcm;
};
const timeline = {
  synthetic: true,
  sampleRate: 16000 as const,
  questions: [0, 4000, 8000].map((s, i) => ({
    id: `q${i + 1}`,
    text: 'x',
    startMs: s,
    endMs: s + 1000,
  })),
};

describe('audio runner', () => {
  it('replays audio through STT + pipeline, matches cues by timeline, scores and reports', async () => {
    const pack = await buildFixturePack(`${fx}synthetic-deal/pack`);
    const { results, extraCues, duplicateCues } = await runAudio({
      llm: fakeLlm(),
      config,
      pack,
      stt: fakeStt(keys.map((k) => k.question)),
      pcm: speech([0, 4000, 8000]),
      timeline,
      frameMs: 20,
      warmMs: 0,
      tailMs: 1000,
      idleMs: 300,
    });
    expect(extraCues).toBe(0);
    expect(duplicateCues).toBe(0);
    expect(results).toHaveLength(3);
    results.forEach((r, i) => {
      expect(r.cue?.notFound).toBe(false);
      expect(r.cue?.sources).toEqual([keys[i]?.anchor]);
      expect(r.timings.total).toBeGreaterThanOrEqual(0);
      expect(r.timings.total).toBeLessThan(1500);
      expect(r.usage.cacheReadTokens).toBe(90);
    });
    const base = buildReport(
      keys,
      results,
      new Set(pack.anchors),
      10,
      parsePrices(readFileSync(`${fx}prices.json`, 'utf8')),
    );
    expect(base).toContain('| out-of-source | 0 |');
    const md = auditReport({
      base,
      ids: ['q1', 'q2', 'q3'],
      results,
      extraCues,
      duplicateCues,
      synthetic: true,
    });
    expect(md).toContain('NOT FOR GO/NO-GO');
    expect(md).toContain('| q3 |');
  }, 20_000);

  it("a cue before its question endMs is a duplicate, not that question's cue (BE-122)", async () => {
    const pack = await buildFixturePack(`${fx}synthetic-deal/pack`);
    // q2 is "spoken" until 7000 ms; its own question (spoken 4000) is answered ~5 s -> before endMs -> duplicate.
    // The next utterance (7500, answered ~8.6 s) lands in q2's window after endMs -> fills q2's slot.
    const tl = {
      ...timeline,
      questions: [
        { id: 'q1', text: 'x', startMs: 0, endMs: 1000 },
        { id: 'q2', text: 'x', startMs: 4000, endMs: 7000 },
        { id: 'q3', text: 'x', startMs: 9000, endMs: 9500 },
      ],
    };
    const { results, extraCues, duplicateCues } = await runAudio({
      llm: fakeLlm(),
      config,
      pack,
      stt: fakeStt(keys.map((k) => k.question)),
      pcm: speech([0, 4000, 7500]),
      timeline: tl,
      frameMs: 20,
      warmMs: 0,
      tailMs: 1000,
      idleMs: 300,
    });
    expect(duplicateCues).toBe(1);
    expect(extraCues).toBe(1);
    expect(results[1]?.cue?.sources).toEqual([keys[2]?.anchor]);
    expect(results[1]?.timings.total).toBeGreaterThanOrEqual(0);
  }, 20_000);

  it('a question STT never finalises gets no cue (null, total 0)', async () => {
    const pack = await buildFixturePack(`${fx}synthetic-deal/pack`);
    const { results } = await runAudio({
      llm: fakeLlm(),
      config,
      pack,
      stt: fakeStt([keys[0]?.question ?? '']),
      pcm: speech([0]),
      timeline: { ...timeline, questions: timeline.questions.slice(0, 2) },
      frameMs: 20,
      warmMs: 0,
      tailMs: 1000,
      idleMs: 300,
    });
    expect(results[0]?.cue).not.toBeNull();
    expect(results[1]?.cue).toBeNull();
    expect(results[1]?.timings.total).toBe(0);
  }, 20_000);
});

describe('trace / text dump (BE-124)', () => {
  it('trace returns STT finals, detected question and cue per timeline question', async () => {
    const pack = await buildFixturePack(`${fx}synthetic-deal/pack`);
    const { trace } = await runAudio({
      llm: fakeLlm(),
      config,
      pack,
      stt: fakeStt(keys.map((k) => k.question)),
      pcm: speech([0, 4000, 8000]),
      timeline,
      frameMs: 20,
      warmMs: 0,
      tailMs: 1000,
      idleMs: 300,
      trace: true,
    });
    expect(trace?.finals.map((f) => f.text)).toEqual(keys.map((k) => k.question));
    expect(trace?.perQuestion.map((q) => q.cueQuestion)).toEqual(keys.map((k) => k.question));
    expect(trace?.perQuestion[0]?.detected).toHaveLength(1);
    expect(trace?.perQuestion[2]?.cue?.notFound).toBe(false);
  }, 20_000);

  it('no trace unless asked', async () => {
    const pack = await buildFixturePack(`${fx}synthetic-deal/pack`);
    const r = await runAudio({
      llm: fakeLlm(),
      config,
      pack,
      stt: fakeStt([]),
      pcm: speech([]),
      timeline,
      frameMs: 20,
      warmMs: 0,
      tailMs: 500,
      idleMs: 100,
    });
    expect(r.trace).toBeUndefined();
  }, 20_000);

  it('--dump-text refuses unless timeline.synthetic === true', () => {
    expect(() => assertSyntheticDump({ ...timeline, synthetic: false }, '--dump-text')).toThrow(
      /D11/,
    );
    expect(() => assertSyntheticDump({ ...timeline, synthetic: undefined }, '--dump-text')).toThrow(
      /D11/,
    );
    expect(() => assertSyntheticDump(timeline, '--dump-text')).not.toThrow();
  });

  it('report shows STT quality; word list only for synthetic', () => {
    const q = { cer: 0.123, recall: 0.5, total: 4, missing: ['kitchen'] };
    const base = { base: 'B', ids: [], results: [], extraCues: 0 };
    expect(auditReport({ ...base, synthetic: true, sttQuality: q })).toContain('Missing: kitchen');
    const real = auditReport({ ...base, synthetic: false, sttQuality: q });
    expect(real).toContain('CER 12.3%');
    expect(real).not.toContain('kitchen');
  });
});

describe('wav / timeline parsing', () => {
  it('reads PCM16 mono 16k, rejects other formats', () => {
    const pcm = Int16Array.from([1, -2, 3]);
    expect([...parseWav(wav(pcm))]).toEqual([1, -2, 3]);
    expect(() => parseWav(wav(pcm, 44100))).toThrow(/16000/);
    expect(() => parseWav(wav(pcm, 16000, 2))).toThrow(/mono/);
    expect(() => parseWav(Buffer.from('nope'))).toThrow(/RIFF/);
  });
  it('validates the timeline contract', () => {
    expect(parseTimeline(JSON.stringify(timeline)).questions).toHaveLength(3);
    expect(() => parseTimeline(JSON.stringify({ ...timeline, sampleRate: 8000 }))).toThrow();
    const bad = { ...timeline, questions: [{ id: 'a', text: '', startMs: 5, endMs: 1 }] };
    expect(() => parseTimeline(JSON.stringify(bad))).toThrow(/ends before/);
  });
});
