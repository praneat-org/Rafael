import type { Cue, KeyRow, Outcome } from './types.js';

/**
 * D10: citing an anchor that is not in the pack is "out-of-source" and counted
 * apart from "wrong". `agrees` = optional bullet-vs-answer grader (Claude grader comes later);
 * default trusts the anchor match only.
 */
export function scoreOne(
  key: KeyRow,
  cue: Cue | null,
  packAnchors: ReadonlySet<string>,
  agrees: (cue: Cue, key: KeyRow) => boolean = () => true,
): Outcome {
  if (!cue) return 'missed';
  if (!cue.notFound && cue.sources.some((s) => !packAnchors.has(s))) return 'out-of-source';
  if (key.anchor === null) return cue.notFound ? 'not-found-correct' : 'wrong';
  if (cue.notFound) return 'wrong';
  return cue.sources.includes(key.anchor) && agrees(cue, key) ? 'correct' : 'wrong';
}

export function tally(outcomes: Outcome[]): Record<Outcome, number> {
  const t: Record<Outcome, number> = {
    correct: 0,
    wrong: 0,
    'out-of-source': 0,
    'not-found-correct': 0,
    missed: 0,
  };
  for (const o of outcomes) t[o]++;
  return t;
}
