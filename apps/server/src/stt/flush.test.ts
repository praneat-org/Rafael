import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiSttProvider } from './gemini.js';
import { createRollingStt } from './rolling.js';

describe('watchdog flush through rolling (BE-89 field bug)', () => {
  afterEach(() => vi.useRealTimers());
  it('partial then silence -> watchdog -> the partial is emitted as a final', async () => {
    vi.useFakeTimers();
    const cbs: any[] = [];
    const finals: string[] = [];
    const rolling = createRollingStt(
      createGeminiSttProvider({
        model: 'm',
        watchdogMs: 8000,
        connect: async (p) => {
          cbs.push(p.callbacks);
          return { sendRealtimeInput: () => {}, close: () => {} };
        },
      }),
      {
        hints: () => [],
        rolloverMs: 270_000,
        overlapMs: 2000,
        retryDelayMs: 1000,
        onPartial() {},
        onFinal: (m) => finals.push(m.text),
        onError() {},
      },
    );
    const speech = new Int16Array(1600).fill(5000);
    rolling.push(speech);
    await vi.advanceTimersByTimeAsync(0);
    cbs[0].onmessage({
      serverContent: { interimInputTranscription: { text: 'Premium ราคาเท่าไหร่' } },
    });
    rolling.push(speech); // trailing speech frame re-arms the watchdog
    await vi.advanceTimersByTimeAsync(9000);
    expect(finals).toEqual(['Premium ราคาเท่าไหร่']);
  });
});

describe('retry stream flush', () => {
  afterEach(() => vi.useRealTimers());
  const setup = (voiced?: (f: Int16Array) => boolean) => {
    vi.useFakeTimers();
    const cbs: any[] = [];
    const finals: string[] = [];
    const rolling = createRollingStt(
      createGeminiSttProvider({
        model: 'm',
        watchdogMs: 8000,
        connect: async (p) => {
          cbs.push(p.callbacks);
          return { sendRealtimeInput: () => {}, close: () => {} };
        },
      }),
      {
        hints: () => [],
        rolloverMs: 270_000,
        overlapMs: 2000,
        retryDelayMs: 1000,
        voiced,
        onPartial() {},
        onFinal: (m) => finals.push(m.text),
        onError() {},
      },
    );
    return { cbs, finals, rolling };
  };
  const speech = new Int16Array(1600).fill(5000);
  it('gen1 silent, gen2 (replay) gets a partial then goes quiet -> flushed', async () => {
    const { cbs, finals, rolling } = setup();
    for (let i = 0; i < 30; i++) rolling.push(speech);
    await vi.advanceTimersByTimeAsync(9000); // gen1 watchdog
    await vi.advanceTimersByTimeAsync(1000); // retry opens gen2
    expect(cbs.length).toBe(2);
    for (let i = 0; i < 5; i++) rolling.push(speech);
    cbs[1].onmessage({
      serverContent: { interimInputTranscription: { text: 'Premium ราคาเท่าไหร่' } },
    });
    rolling.push(speech);
    await vi.advanceTimersByTimeAsync(9000);
    expect(finals).toEqual(['Premium ราคาเท่าไหร่']);
  });
  it('whitespace-only final must not wipe the open partial', async () => {
    const { cbs, finals, rolling } = setup();
    rolling.push(speech);
    await vi.advanceTimersByTimeAsync(0);
    cbs[0].onmessage({
      serverContent: { interimInputTranscription: { text: 'Premium ราคาเท่าไหร่' } },
    });
    cbs[0].onmessage({ serverContent: { inputTranscription: { text: ' ' } } });
    rolling.push(speech);
    await vi.advanceTimersByTimeAsync(9000);
    expect(finals).toEqual(['Premium ราคาเท่าไหร่']);
  });
});
