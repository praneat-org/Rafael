import { type RunResult, STAGES, type Stage } from './types.js';

/** Nearest-rank percentile, p in (0,100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)] as number;
}

export function latencyStats(results: RunResult[]) {
  const out = {} as Record<Stage, { p50: number; p95: number }>;
  for (const st of STAGES) {
    const v = results.map((r) => r.timings[st]);
    out[st] = { p50: percentile(v, 50), p95: percentile(v, 95) };
  }
  return out;
}
