import { describe, expect, test, vi } from 'vitest';
import { createSessionStats, percentile, summarizeCues } from './sessionStats.js';

describe('percentile (nearest rank)', () => {
  test('empty', () => expect(percentile([], 50)).toBeUndefined());
  test('single value', () => expect(percentile([7], 95)).toBe(7));
  test('p50 / p95 of 1..10', () => {
    const v = [10, 3, 1, 9, 2, 8, 4, 7, 5, 6]; // unsorted on purpose
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile(v, 0)).toBe(1);
  });
  test('p95 of 20 values is the 19th, input not mutated', () => {
    const v = Array.from({ length: 20 }, (_, i) => (20 - i) * 100);
    expect(percentile(v, 95)).toBe(1900);
    expect(v[0]).toBe(2000);
  });
});

test('summarizeCues: rate and zero case', () => {
  expect(summarizeCues([1000, 2000, 3000, 4000], 1)).toEqual({
    cueCount: 4,
    cueP50Ms: 2000,
    cueP95Ms: 4000,
    errorCount: 1,
    errorRate: 0.25,
  });
  expect(summarizeCues([], 0)).toEqual({
    cueCount: 0,
    cueP50Ms: null,
    cueP95Ms: null,
    errorCount: 0,
    errorRate: 0,
  });
});

test('cues without a latency count as cues but never as 0 ms; zero-cue session still logs', () => {
  const out = vi.spyOn(console, 'log').mockImplementation(() => {});
  const s = createSessionStats();
  s.record('m', undefined, true);
  s.record('m', 2000, false);
  s.end('m');
  s.end('empty');
  const [m, e] = out.mock.calls.map((c) => JSON.parse(c[0] as string));
  expect(m).toMatchObject({
    cueCount: 2,
    cueP50Ms: 2000,
    cueP95Ms: 2000,
    errorCount: 1,
    errorRate: 0.5,
  });
  expect(e).toMatchObject({
    msg: 'session.stats',
    sessionId: 'empty',
    cueCount: 0,
    cueP50Ms: null,
    cueP95Ms: null,
    errorRate: 0,
  });
  out.mockRestore();
});

test('end logs one content-free line, then forgets the session', () => {
  const out = vi.spyOn(console, 'log').mockImplementation(() => {});
  const s = createSessionStats();
  s.record('a', 1200, false);
  s.record('a', 3400, true);
  s.end('a');
  expect(out).toHaveBeenCalledTimes(1);
  expect(JSON.parse(out.mock.calls[0]![0] as string)).toEqual({
    msg: 'session.stats',
    sessionId: 'a',
    cueCount: 2,
    cueP50Ms: 1200,
    cueP95Ms: 3400,
    errorCount: 1,
    errorRate: 0.5,
  });
  out.mockRestore();
});
