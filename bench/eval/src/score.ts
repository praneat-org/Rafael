import type { Cue, KeyRow, Outcome } from './types.js';

const ANCHOR = /\[[^\]]*›[^\]]*\]/g;
const HYPHEN = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+/g; // ap-southeast-7
const dropCommas = (s: string) => s.replace(/(\d),(?=\d)/g, '$1'); // 2,900 -> 2900
const NUM = /\d+(?:\.\d+)*/g;
const WORD = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/g;

/**
 * Checkable facts of a key answer: whole numbers, hyphenated latin ids, capitalized / acronym latin
 * words. Facts that match by accident (single digit, latin <= 2 chars) are dropped unless nothing else is left.
 */
export function factsOf(key: KeyRow): string[] {
  const a = dropCommas(key.answer);
  const rest = a.replace(HYPHEN, ' ');
  const all = [
    ...new Set([
      ...(a.match(HYPHEN) ?? []).map((x) => x.toLowerCase()),
      ...(rest.match(NUM) ?? []),
      ...(rest.match(/[A-Z][A-Za-z0-9]+/g) ?? []).map((x) => x.toLowerCase()),
    ]),
  ];
  const strong = all.filter((f) => (/^\d/.test(f) ? f.length > 1 : f.length > 2));
  return strong.length ? strong : all;
}

/** Facts of the key answer that are missing from the cue bullets (anchors stripped), compared as whole tokens. */
export function missingFacts(key: KeyRow, cue: Cue): string[] {
  const text = dropCommas(cue.bullets.join(' ').replace(ANCHOR, ''));
  const have = new Set([
    ...(text.match(NUM) ?? []),
    ...(text.match(WORD) ?? []).map((w) => w.toLowerCase()),
  ]);
  return factsOf(key).filter((f) => !have.has(f));
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
  if (missingFacts(key, cue).length) return 'wrong-fact';
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
