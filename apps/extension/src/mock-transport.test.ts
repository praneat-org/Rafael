import type { ServerMessage } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MockTransport } from './mock-transport';
import { dispatchRaw } from './transport';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function started(latency = 100) {
  const t = new MockTransport(latency);
  const got: ServerMessage[] = [];
  t.onMessage((m) => got.push(m));
  t.connect();
  t.send({ v: 1, t: 'hello', accessToken: 'x' });
  t.send({ v: 1, t: 'session.start', packId: 'p' });
  return { t, got };
}

test('plays messages in order: transcript partial -> final -> cue partial -> final -> notFound', () => {
  const { got } = started();
  vi.advanceTimersByTime(10_000);
  const seq = got.map((m) =>
    m.t === 'transcript'
      ? `transcript:${m.final}`
      : m.t === 'cue'
        ? `cue:${m.partial}:${m.notFound}`
        : m.t,
  );
  expect(seq).toEqual([
    'session.ready',
    'pack.status',
    'transcript:false',
    'transcript:true',
    'cue:true:false',
    'cue:false:false',
    'cue:false:true',
  ]);
});

test('close() stops further messages', () => {
  const { t, got } = started();
  vi.advanceTimersByTime(250); // 2 messages out
  const before = got.length;
  expect(before).toBe(2);
  t.close();
  vi.advanceTimersByTime(10_000);
  expect(got.length).toBe(before);
});

test('latency setting delays the first message', () => {
  const { got } = started(500);
  vi.advanceTimersByTime(499);
  expect(got.length).toBe(0);
  vi.advanceTimersByTime(1);
  expect(got.length).toBe(1);
});

test('first message other than hello -> UNAUTHORIZED and closed (D19)', () => {
  const t = new MockTransport(100);
  const got: ServerMessage[] = [];
  const status: string[] = [];
  t.onMessage((m) => got.push(m));
  t.onStatus((s) => status.push(s));
  t.send({ v: 1, t: 'session.start', packId: 'p' });
  vi.advanceTimersByTime(10_000);
  expect(got).toEqual([{ v: 1, t: 'error', code: 'UNAUTHORIZED' }]);
  expect(status.at(-1)).toBe('closed');
});

test('dispatchRaw drops invalid messages without throwing or logging the payload', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const emit = vi.fn();
  dispatchRaw('{"v":1,"t":"cue","secret":"deal text"}', emit);
  dispatchRaw('not json', emit);
  expect(emit).not.toHaveBeenCalled();
  expect(JSON.stringify(warn.mock.calls)).not.toContain('deal text');
  warn.mockRestore();
});

test('ask -> streamed cue with one id, partial then final, <= 3 bullets, with source', () => {
  const { t, got } = started();
  vi.advanceTimersByTime(10_000);
  const before = got.length;
  t.send({ v: 1, t: 'ask', text: 'ราคาเท่าไหร่' });
  vi.advanceTimersByTime(10_000);
  const cues = got.slice(before).filter((m) => m.t === 'cue');
  expect(cues.map((c) => c.partial)).toEqual([true, true, true, false]);
  expect(new Set(cues.map((c) => c.cueId)).size).toBe(1);
  expect(cues.at(-1)?.bullets.length).toBeLessThanOrEqual(3);
  expect(cues.map((c) => c.sources.length)).toEqual([1, 2, 3, 3]);
  expect(cues[0]?.question).toBe('ราคาเท่าไหร่');
});
