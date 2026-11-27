import type { RunResult } from './types.js';

/** Re-score a saved run (`eval:text --dump`) offline: JSON array of RunResult, one per key. */
export function parseCues(json: string, n: number): RunResult[] {
  const r: unknown = JSON.parse(json);
  if (!Array.isArray(r) || r.length !== n)
    throw new Error(`cues: expected an array of ${n} results`);
  for (const x of r as RunResult[])
    if (!x || typeof x !== 'object' || !('timings' in x) || !('usage' in x) || !('cue' in x))
      throw new Error('cues: each result needs cue, timings, usage');
  return r as RunResult[];
}
