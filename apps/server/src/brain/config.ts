import { z } from 'zod';

// One place for tunables (skill cue-brain). Model ids come from env, never hard-coded.
const Env = z.object({
  DETECTOR_MODEL: z.string().min(1),
  ANSWERER_MODEL: z.string().min(1).optional(),
  /** meeting summary model; default = answerer, else detector */
  SUMMARY_MODEL: z.string().min(1).optional(),
});

export type BrainConfig = {
  detectorModel: string;
  answererModel?: string;
  summaryModel: string;
  detector: {
    windowMs: number;
    dedupeMs: number;
    /** stage budget (skill cue-brain); exceeding it logs a warn */
    budgetMs: number;
    /** per-attempt timeout; worst case = 2 x timeoutMs (one retry) */
    timeoutMs: number;
    maxTokens: number;
    /** char-bigram Dice similarity at/above which two questions count as the same */
    dedupeSimilarity: number;
  };
  /** end-to-end budgets (skill cue-brain latency table); exceeding one logs budget.exceeded */
  pipeline: {
    /** last voiced frame -> final segment */
    sttFinalBudgetMs: number;
    /** speech end -> first cue: the p95 ceiling (p50 target is 3 s) */
    firstCueBudgetMs: number;
  };
  /** follow-up context: last Q/A turns given to Detector + Answerer (context only, never a source) */
  history: { maxTurns: number; maxChars: number };
  answerer: {
    maxBullets: number;
    maxWordsPerBullet: number;
    maxTokens: number;
    timeoutMs: number;
    /** first-token budget (skill cue-brain); exceeding it logs a warn */
    firstTokenBudgetMs: number;
    /** D21: <= 1 h */
    cacheTtlSeconds: number;
  };
};

export function loadBrainConfig(env: Record<string, string | undefined>): BrainConfig {
  // Cloud Build passes unset substitutions as '': treat them as unset
  const e = Env.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  return {
    detectorModel: e.DETECTOR_MODEL,
    answererModel: e.ANSWERER_MODEL,
    summaryModel: e.SUMMARY_MODEL ?? e.ANSWERER_MODEL ?? e.DETECTOR_MODEL,
    detector: {
      windowMs: 30_000,
      dedupeMs: 60_000,
      // measured gemini-3.5-flash, asia-southeast1, thinking MINIMAL: ~0.8 s from TH (2026-10-29)
      budgetMs: 1200,
      timeoutMs: 1500,
      maxTokens: 200,
      dedupeSimilarity: 0.85,
    },
    pipeline: { sttFinalBudgetMs: 800, firstCueBudgetMs: 5000 },
    history: { maxTurns: 6, maxChars: 2000 },
    answerer: {
      maxBullets: 5,
      // Intl.Segmenter splits Thai finely: a plain 15-word sentence counts ~20. The prompt asks for 30;
      // this is the hard drop line (a bullet is never cut: cutting could change the claim)
      maxWordsPerBullet: 50,
      maxTokens: 1000,
      timeoutMs: 8000,
      firstTokenBudgetMs: 1200,
      cacheTtlSeconds: 3600,
    },
  };
}
