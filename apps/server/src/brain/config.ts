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
    /** per-attempt timeout; Detector budget is 600 ms, retry once on failure */
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
      timeoutMs: 1_500,
      maxTokens: 200,
      dedupeSimilarity: 0.8,
    },
  };
}
