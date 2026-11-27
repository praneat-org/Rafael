import type { Cue, KeyRow, Runner, RunResult } from './types.js';

/** Fake runner: answers every question with the key's own anchor. Only for wiring/fixture runs. */
export function fakeRunner(
  keys: KeyRow[],
  override: (i: number) => Partial<RunResult> | undefined = () => undefined,
): Runner {
  return async (inputs) =>
    inputs.map((_, i) => {
      const k = keys[i] as KeyRow;
      const cue: Cue = k.anchor
        ? { notFound: false, bullets: [`${k.answer} ${k.anchor}`], sources: [k.anchor] }
        : { notFound: true, bullets: [], sources: [] };
      return {
        cue,
        timings: { stt: 500, detector: 300, answererFirstToken: 900, total: 1700 + i * 10 },
        usage: { inputTokens: 200, cacheReadTokens: 4000, cacheWriteTokens: 0, outputTokens: 60 },
        ...override(i),
      };
    });
}
