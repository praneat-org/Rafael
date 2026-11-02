import type { Cue, KeyRow, Outcome } from './types.js';

const ANCHOR = /\[[^\]]*›[^\]]*\]/g;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/\s+/g, '');

/** Checkable facts of a key answer: numbers and capitalized / acronym latin tokens (normalized). */
export function factsOf(key: KeyRow): string[] {
  const m = key.answer.match(/\d+(?:[.,]\d+)*|[A-Z][A-Za-z0-9]+/g) ?? [];
  return [...new Set(m.map(norm))];
}

/**
 * D10: citing an anchor that is not in the pack is "out-of-source" and counted
 * apart from "wrong". `agrees` = optional bullet-vs-answer grader (Gemini grader comes later, D20);
 * default trusts the anchor match only.
 */
export function scoreOne(
  key: KeyRow,
  cue: Cue | null,
  packAnchors: ReadonlySet<string>,
  agrees: (cue: Cue, key: KeyRow) => boolean = () => true,
): Outcome {
  if (!cue) return 'missed';
  if (cue.sources.some((s) => !packAnchors.has(s))) return 'out-of-source';
  if (key.anchor === null) return cue.notFound ? 'not-found-correct' : 'wrong';
  if (cue.notFound) return 'wrong';
  if (!cue.sources.includes(key.anchor)) return 'wrong';
  // anchor alone proves nothing about the answer: its facts must appear in the bullets (anchors stripped)
  const text = norm(cue.bullets.join(' ').replace(ANCHOR, ''));
  if (!factsOf(key).every((f) => text.includes(f))) return 'wrong-fact';
  return agrees(cue, key) ? 'correct' : 'wrong';
}

export function tally(outcomes: Outcome[]): Record<Outcome, number> {
  const t: Record<Outcome, number> = {
    correct: 0,
    wrong: 0,
    'out-of-source': 0,
    'wrong-fact': 0,
    'not-found-correct': 0,
    missed: 0,
  };
  for (const o of outcomes) t[o]++;
  return t;
}
