// Per-session cue latency + error rate, logged once at session end (counts and ms only, D11).
import { log } from './log.js';

/** Nearest-rank percentile (p in 0..100) of an unsorted list; undefined when empty. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function summarizeCues(latenciesMs: number[], errorCount: number) {
  const cueCount = latenciesMs.length;
  return {
    cueCount,
    cueP50Ms: percentile(latenciesMs, 50) ?? 0,
    cueP95Ms: percentile(latenciesMs, 95) ?? 0,
    errorCount,
    errorRate: cueCount ? Math.round((errorCount / cueCount) * 1000) / 1000 : 0,
  };
}

/** In-memory tally per session; `end` logs the line and forgets the session. */
export function createSessionStats() {
  const bySession = new Map<string, { ms: number[]; errors: number }>();
  return {
    /** one final cue; `failed` = the model errored (not a plain "not in the pack") */
    record(sessionId: string, latencyMs: number, failed: boolean) {
      const t = bySession.get(sessionId) ?? { ms: [], errors: 0 };
      bySession.set(sessionId, t);
      t.ms.push(latencyMs);
      if (failed) t.errors++;
    },
    end(sessionId: string) {
      const t = bySession.get(sessionId);
      bySession.delete(sessionId);
      if (t) log('session.stats', { sessionId, ...summarizeCues(t.ms, t.errors) });
    },
  };
}
