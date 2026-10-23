import { z } from 'zod';

// One place for tunables (skill cue-brain). Model ids come from env, never hard-coded.
const Env = z.object({
  DETECTOR_MODEL: z.string().min(1),
  ANSWERER_MODEL: z.string().min(1).optional(),
});

export type BrainConfig = {
  detectorModel: string;
  answererModel?: string;
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
};

export function loadBrainConfig(env: Record<string, string | undefined>): BrainConfig {
  const e = Env.parse(env);
  return {
    detectorModel: e.DETECTOR_MODEL,
    answererModel: e.ANSWERER_MODEL,
    detector: {
      windowMs: 30_000,
      dedupeMs: 60_000,
      budgetMs: 600,
      timeoutMs: 400,
      maxTokens: 200,
      dedupeSimilarity: 0.85,
    },
  };
}
