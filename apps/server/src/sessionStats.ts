// Per-session cue latency + error rate, logged once at session end (counts and ms only, D11).
import { log } from './log.js';

/** Nearest-rank percentile (p in 0..100) of an unsorted list; undefined when empty. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** `latenciesMs` holds only the cues that have a latency; `cueCount` counts every cue. Percentiles are null without data. */
export function summarizeCues(
  latenciesMs: number[],
  errorCount: number,
  cueCount = latenciesMs.length,
) {
  return {
    cueCount,
    cueP50Ms: percentile(latenciesMs, 50) ?? null,
    cueP95Ms: percentile(latenciesMs, 95) ?? null,
    errorCount,
    errorRate: cueCount ? Math.round((errorCount / cueCount) * 1000) / 1000 : 0,
  };
}

/** In-memory tally per session; `end` logs the line and forgets the session. */
export function createSessionStats() {
  const bySession = new Map<string, { ms: number[]; cues: number; errors: number }>();
  return {
    /** one final cue; `failed` = the model errored (not a plain "not in the pack") */
    record(sessionId: string, latencyMs: number | undefined, failed: boolean) {
      const t = bySession.get(sessionId) ?? { ms: [], cues: 0, errors: 0 };
      bySession.set(sessionId, t);
      t.cues++;
      if (latencyMs !== undefined) t.ms.push(latencyMs); // a missing latency is not 0 ms
      if (failed) t.errors++;
    },
    end(sessionId: string) {
      // a session with no cues still logs a line, so error rate covers every session
      const t = bySession.get(sessionId) ?? { ms: [], cues: 0, errors: 0 };
      bySession.delete(sessionId);
      log('session.stats', { sessionId, ...summarizeCues(t.ms, t.errors, t.cues) });
    },
  };
}
