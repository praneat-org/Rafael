import { type RunResult, STAGES, type Stage } from './types.js';

/** Nearest-rank percentile, p in (0,100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)] as number;
}

/** Missed questions (cue null) have no latency: counting their 0 would let p50 pass while most are missed. */
export function latencyStats(all: RunResult[]) {
  const results = all.filter((r) => r.cue !== null);
  const out = {} as Record<Stage, { p50: number; p95: number }>;
  for (const st of STAGES) {
    const v = results.map((r) => r.timings[st]);
    out[st] = { p50: percentile(v, 50), p95: percentile(v, 95) };
  }
  return out;
}

/** Cross-check of the wall-clock `total` (BE-126): server-side serverTotalMs p50 / p95 over the cues that have it. */
export function serverTotalStats(all: RunResult[]) {
  const v = all.flatMap((r) =>
    r.cue !== null && r.timings.serverTotal !== undefined ? [r.timings.serverTotal] : [],
  );
  return v.length ? { p50: percentile(v, 50), p95: percentile(v, 95) } : undefined;
}

/** wall-clock vs server total differ by more than this -> warn (network / endpointing / clock problem) */
export const SERVER_TOTAL_WARN_MS = 500;
