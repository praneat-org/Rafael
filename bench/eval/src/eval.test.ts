import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { costPerHour, parsePrices } from './cost.js';
import { parseKey } from './key.js';
import { buildReport } from './report.js';
import { fakeRunner } from './runner.js';
import { scoreOne } from './score.js';
import { percentile } from './stats.js';
import type { Cue, KeyRow } from './types.js';

const pack = new Set(['[a › 1]', '[b › 2]']);
const key: KeyRow = { question: 'q', answer: 'a', anchor: '[a › 1]' };
const none: KeyRow = { question: 'q', answer: '', anchor: null };
const cue = (sources: string[], notFound = false): Cue => ({ notFound, bullets: ['x'], sources });

describe('parseKey', () => {
  it('handles quoted commas and "ไม่มีใน source"', () => {
    const k = parseKey(readFileSync(new URL('../fixtures/key.csv', import.meta.url), 'utf8'));
    expect(k).toHaveLength(4);
    expect(k[2]?.anchor).toBeNull();
    expect(k[3]?.question).toBe('ระยะสัญญา, ขั้นต่ำ');
  });
  it('rejects missing column / empty anchor', () => {
    expect(() => parseKey('question,answer\nq,a')).toThrow(/anchor/);
    expect(() => parseKey('question,answer,anchor\nq,a,')).toThrow(/empty anchor/);
  });
});

describe('scoreOne', () => {
  it('correct', () => expect(scoreOne(key, cue(['[a › 1]']), pack)).toBe('correct'));
  it('wrong anchor in pack', () => expect(scoreOne(key, cue(['[b › 2]']), pack)).toBe('wrong'));
  it('out-of-source is separate from wrong', () =>
    expect(scoreOne(key, cue(['[a › 1]', '[zzz › 9]']), pack)).toBe('out-of-source'));
  it('not-found-correct', () =>
    expect(scoreOne(none, cue([], true), pack)).toBe('not-found-correct'));
  it('answering when key says not in source = wrong', () =>
    expect(scoreOne(none, cue(['[a › 1]']), pack)).toBe('wrong'));
  it('notFound when key has anchor = wrong', () =>
    expect(scoreOne(key, cue([], true), pack)).toBe('wrong'));
  it('missed', () => expect(scoreOne(key, null, pack)).toBe('missed'));
  it('grader can veto', () =>
    expect(scoreOne(key, cue(['[a › 1]']), pack, () => false)).toBe('wrong'));
});

describe('percentile', () => {
  it('nearest rank', () => {
    const v = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(percentile(v, 50)).toBe(1000);
    expect(percentile(v, 95)).toBe(1900);
  });
});

describe('costPerHour', () => {
  const p = parsePrices(
    '{"sttPerMinute":1,"perMillionTokens":{"input":2,"cacheRead":3,"cacheWrite":4,"output":5}}',
  );
  it('sums stt + each token class, scaled to an hour', () => {
    const u = { inputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6, outputTokens: 1e6 };
    // 60 s audio: 1 stt + 14 tokens = 15 per minute -> 900 per hour
    expect(costPerHour([u], 60, p)).toBeCloseTo(900);
  });
  it('rejects bad config', () => expect(() => parsePrices('{"sttPerMinute":-1}')).toThrow());
});

describe('buildReport', () => {
  const keys = parseKey(readFileSync(new URL('../fixtures/key.csv', import.meta.url), 'utf8'));
  const prices = parsePrices(
    readFileSync(new URL('../fixtures/prices.json', import.meta.url), 'utf8'),
  );
  const anchors = new Set(keys.flatMap((k) => (k.anchor ? [k.anchor] : [])));
  const inputs = keys.map((k) => ({ question: k.question }));
  it('fake runner passes gates thresholds that are met, no text leaks', async () => {
    const md = buildReport(keys, await fakeRunner(keys)(inputs), anchors, 120, prices);
    expect(md).toContain('| out-of-source | 0 | 0 | PASS |');
    expect(md).not.toContain('SSO');
  });
  it('slow run and out-of-source flip gates to FAIL', async () => {
    const r = await fakeRunner(keys, (i) =>
      i === 0
        ? {
            timings: { stt: 1, detector: 1, answererFirstToken: 1, total: 9000 },
            cue: { notFound: false, bullets: ['x'], sources: ['[fake › 1]'] },
          }
        : undefined,
    )(inputs);
    const md = buildReport(keys, r, anchors, 120, prices);
    expect(md).toContain('| out-of-source | 1 | 0 | FAIL |');
    expect(md).toContain('FAIL');
    expect(md).toMatch(/total p95 \| 9000 ms .* FAIL/);
  });
});
