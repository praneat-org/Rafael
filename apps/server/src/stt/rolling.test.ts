import { expect, test, vi } from 'vitest';
import { FakeSttProvider } from './fake.js';
import { createRollingStt } from './rolling.js';

const frame = (id: number) => {
  const f = new Int16Array(1600);
  f[0] = id;
  return f;
};
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`);

function run(provider: FakeSttProvider, extra: object = {}) {
  const finals: { segId: string; text: string; speaker?: string }[] = [];
  const partials: string[] = [];
  const errors: boolean[] = [];
  const r = createRollingStt(provider, {
    hints: ['Praneat', 'SSO'],
    rolloverMs: 2000, // 20 frames
    overlapMs: 500, // 5 frames
    onPartial: (m) => partials.push(m.text),
    onFinal: (m) => finals.push(m),
    onError: (g) => errors.push(g),
    ...extra,
  });
  return { r, finals, partials, errors };
}

test.each([1, 2, 3, 4, 7])(
  'rollover (finalEvery=%i): every word once, in order, no gaps',
  async (finalEvery) => {
    const p = new FakeSttProvider({ finalEvery });
    const { r, finals } = run(p);
    for (let i = 1; i <= 100; i++) r.push(frame(i));
    await r.close();
    expect(p.starts.length).toBeGreaterThan(4); // 100 frames / 20 -> several rollovers
    expect(finals.map((f) => f.text).join(' ')).toBe(words(100).join(' '));
    expect(new Set(finals.map((f) => f.segId)).size).toBe(finals.length);
  },
);

test('silence between words does not break rollover', async () => {
  const p = new FakeSttProvider();
  const { r, finals } = run(p);
  let id = 0;
  for (let i = 0; i < 80; i++) r.push(frame(i % 4 === 0 ? 0 : ++id));
  await r.close();
  expect(finals.map((f) => f.text).join(' ')).toBe(words(id).join(' '));
});

test('hints are passed to every stream (also after rollover)', async () => {
  const p = new FakeSttProvider();
  const { r } = run(p);
  for (let i = 1; i <= 45; i++) r.push(frame(i));
  await r.close();
  expect(p.starts.length).toBeGreaterThanOrEqual(3);
  for (const h of p.starts) expect(h).toEqual(['Praneat', 'SSO']);
});

test('partials come from the live stream and share the segId of the open segment', async () => {
  const p = new FakeSttProvider({ finalEvery: 3 });
  const { r, partials } = run(p);
  r.push(frame(1));
  r.push(frame(2));
  expect(partials).toEqual(['w1', 'w1 w2']);
  await r.close();
});

test('provider error -> onError, reopens with buffered audio, words keep flowing', async () => {
  vi.useFakeTimers();
  try {
    const p = new FakeSttProvider({ finalEvery: 3 });
    const { r, finals, errors } = run(p, { retryDelayMs: 10 });
    for (let i = 1; i <= 7; i++) r.push(frame(i));
    p.failLast();
    expect(errors).toEqual([false]);
    r.push(frame(8)); // between retries: kept only in the overlap buffer
    await vi.advanceTimersByTimeAsync(10);
    for (let i = 9; i <= 14; i++) r.push(frame(i));
    await r.close();
    const text = finals.map((f) => f.text).join(' ');
    // nothing before the failure is lost; replay may repeat at most the overlap window
    for (const w of words(14)) expect(text).toContain(w);
  } finally {
    vi.useRealTimers();
  }
});

test('provider stays down -> gives up after maxRetries, never throws', async () => {
  vi.useFakeTimers();
  try {
    const p = new FakeSttProvider();
    p.failStarts = 99;
    const { r, errors } = run(p, { retryDelayMs: 10, maxRetries: 2 });
    r.push(frame(1)); // start() throws
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toEqual([false, false, true]);
    r.push(frame(2));
    await r.close();
  } finally {
    vi.useRealTimers();
  }
});

test('provider errors while close() is flushing -> no retry timer, no stream reopened after end', async () => {
  vi.useFakeTimers();
  try {
    let starts = 0;
    const provider = {
      start(_hints: readonly string[], h: { onError(): void; onFinal(t: string): void }) {
        starts++;
        return {
          push() {},
          close: async () => {
            h.onFinal('last words');
            h.onError(); // dies while flushing
          },
        };
      },
    };
    const { r, errors, finals } = run(provider as never, { retryDelayMs: 10 });
    r.push(frame(1));
    await r.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toBe(1);
    expect(errors).toEqual([]); // nothing to report: the session is over
    expect(finals.map((f) => f.text)).toEqual(['last words']);
    expect(vi.getTimerCount()).toBe(0);
    r.push(frame(2)); // closed: ignored
    expect(starts).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test('error just before close with a retry pending -> close cancels the retry', async () => {
  vi.useFakeTimers();
  try {
    const p = new FakeSttProvider();
    const { r } = run(p, { retryDelayMs: 10 });
    r.push(frame(1));
    p.failLast(); // retry armed
    await r.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.starts.length).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
