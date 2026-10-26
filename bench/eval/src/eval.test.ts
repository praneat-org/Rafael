import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { optArg } from './args.js';
import { costPerHour, parsePrices } from './cost.js';
import { parseKey } from './key.js';
import { buildReport, GATES } from './report.js';
import { fakeRunner } from './runner.js';
import { scoreOne } from './score.js';
import { percentile } from './stats.js';
import { type Cue, type KeyRow, type RunResult, sourceAnchor } from './types.js';

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
  it('rejects unclosed quote', () =>
    expect(() => parseKey('question,answer,anchor\n"q,a,[a › 1]\nq2,a,[a › 1]')).toThrow(/quote/));
  it('rejects wrong cell count', () => {
    expect(() => parseKey('question,answer,anchor\nq,a')).toThrow(/cells/);
    expect(() => parseKey('question,answer,anchor\nq,a,[a › 1],extra')).toThrow(/cells/);
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
  it('out-of-source even when notFound=true', () =>
    expect(scoreOne(none, cue(['[zzz › 9]'], true), pack)).toBe('out-of-source'));
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
  it('rejects non-finite price', () =>
    expect(() =>
      parsePrices(
        '{"sttPerMinute":1e999,"perMillionTokens":{"input":2,"cacheRead":3,"cacheWrite":4,"output":5}}',
      ),
    ).toThrow(/invalid prices/));
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
    expect(md).toMatch(/total p95 \| 9000 ms .* FAIL/);
  });
});

describe('sourceAnchor', () => {
  it('maps protocol Source to pack anchor', () =>
    expect(sourceAnchor({ file: 'a', locator: '1' })).toBe('[a › 1]'));
});

describe('gates one by one (boundaries)', () => {
  const N = 20;
  const prices = parsePrices(
    readFileSync(new URL('../fixtures/prices.json', import.meta.url), 'utf8'),
  );
  const keys: KeyRow[] = Array.from({ length: N }, (_, i) => ({
    question: `q${i}`,
    answer: 'a',
    anchor: `[f › ${i}]`,
  }));
  const anchors = new Set(keys.map((k) => k.anchor as string));
  const usage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  type Opts = { correct?: number; oos?: number; totals?: number[] };
  const run = ({ correct = N, oos = 0, totals = [] }: Opts): string => {
    const results: RunResult[] = keys.map((k, i) => {
      const sources =
        i < correct ? [k.anchor as string] : i < correct + oos ? ['[zzz › 9]'] : ['[f › 0]'];
      const total = totals[i] ?? 1000;
      return {
        cue: { notFound: false, bullets: ['x'], sources },
        timings: { stt: 1, detector: 1, answererFirstToken: 1, total },
        usage,
      };
    });
    return buildReport(keys, results, anchors, 120, prices);
  };
  const gate = (md: string, label: string) =>
    new RegExp(`\\| ${label}[^\\n]*\\| (PASS|FAIL) \\|`).exec(md)?.[1];
  const correctGate = (o: Opts) => gate(run(o), 'correct');
  const ooS = (o: Opts) => gate(run(o), 'out-of-source');
  const p50 = (o: Opts) => gate(run(o), 'total p50');
  const p95 = (o: Opts) => gate(run(o), 'total p95');
  const fill = (n: number, v: number, rest = 1000) =>
    Array.from({ length: N }, (_, i) => (i < n ? v : rest));

  it('thresholds are the spec', () =>
    expect(GATES).toEqual({ minCorrect: 16, maxOutOfSource: 0, p50Ms: 3000, p95Ms: 5000 }));
  it('correct: 16/20 PASS, 15/20 FAIL', () => {
    expect(correctGate({ correct: 16 })).toBe('PASS');
    expect(correctGate({ correct: 15 })).toBe('FAIL');
  });
  it('out-of-source does not count as good', () =>
    expect(correctGate({ correct: 15, oos: 1 })).toBe('FAIL'));
  it('report denominator follows key length', () => expect(run({})).toContain(`>= 16/${N} `));
  it('report denominator is not hardcoded to 20; result count must match keys', () => {
    const ks: KeyRow[] = Array.from({ length: 5 }, () => key);
    const r = (n: number): RunResult[] =>
      Array.from({ length: n }, () => ({
        cue: cue(['[a › 1]']),
        timings: { stt: 1, detector: 1, answererFirstToken: 1, total: 1 },
        usage,
      }));
    expect(buildReport(ks, r(5), pack, 60, prices)).toContain('/5 ');
    expect(() => buildReport(ks, r(4), pack, 60, prices)).toThrow(/4 results for 5 keys/);
  });
  it('out-of-source: 0 PASS, 1 FAIL', () => {
    expect(ooS({ correct: 19, oos: 0 })).toBe('PASS');
    expect(ooS({ correct: 19, oos: 1 })).toBe('FAIL');
  });
  it('p50: 3000 PASS, 3001 FAIL (all other gates untouched)', () => {
    expect(p50({ totals: fill(N, 3000) })).toBe('PASS');
    expect(p50({ totals: fill(N, 3001) })).toBe('FAIL');
  });
  it('p95: 5000 PASS, 5001 FAIL (two slowest of 20)', () => {
    expect(p95({ totals: fill(2, 5000) })).toBe('PASS');
    expect(p95({ totals: fill(2, 5001) })).toBe('FAIL');
    expect(p50({ totals: fill(2, 5001) })).toBe('PASS');
  });
  it('each gate fails alone', () => {
    const bad = (o: Opts) => [correctGate(o), ooS(o), p50(o), p95(o)];
    expect(bad({})).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
    expect(bad({ correct: 15 })).toEqual(['FAIL', 'PASS', 'PASS', 'PASS']);
    expect(bad({ correct: 19, oos: 1 })).toEqual(['PASS', 'FAIL', 'PASS', 'PASS']);
    expect(bad({ totals: fill(N, 3001) })).toEqual(['PASS', 'PASS', 'FAIL', 'PASS']);
    expect(bad({ totals: fill(2, 5001) })).toEqual(['PASS', 'PASS', 'PASS', 'FAIL']);
  });
});

describe('optArg', () => {
  it('absent -> default; value -> value; no operand -> error', () => {
    expect(optArg(['x'], 'out', 'd')).toBe('d');
    expect(optArg(['--out', 'r.md'], 'out', 'd')).toBe('r.md');
    expect(() => optArg(['--out'], 'out', 'd')).toThrow(/needs a value/);
    expect(() => optArg(['--out', '--key', 'k'], 'out', 'd')).toThrow(/needs a value/);
    expect(optArg(['--out=--report.md'], 'out', 'd')).toBe('--report.md');
    expect(optArg(['--out=r.md', '--key', 'k'], 'out', 'd')).toBe('r.md');
    expect(() => optArg(['--out='], 'out', 'd')).toThrow(/needs a value/);
  });
});
