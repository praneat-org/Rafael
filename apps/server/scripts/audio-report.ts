import type { RunResult } from '../../../bench/eval/src/types.js';

/** Wraps the bench/eval report: SYNTHETIC banner + per-question latency (question endMs -> first cue). Numbers only (D11). */
export function auditReport(o: {
  base: string;
  ids: string[];
  results: RunResult[];
  extraCues: number;
  duplicateCues?: number;
  synthetic: boolean;
}): string {
  const banner = o.synthetic
    ? ['> **SYNTHETIC audio / timeline: NOT FOR GO/NO-GO.** Numbers only validate the harness.', '']
    : [];
  const rows = o.results.map(
    (r, i) => `| ${o.ids[i]} | ${r.cue ? `${r.timings.total} ms` : 'no cue'} |`,
  );
  return [
    ...banner,
    o.base,
    '## Latency per question (question endMs -> first cue)',
    '| id | latency |',
    '| -- | -- |',
    ...rows,
    '',
    `Cues not matched to a question window: ${o.extraCues}`,
    `Duplicate cues (emitted before the endMs of the question whose window they fall in, i.e. stale cue of an earlier question): ${o.duplicateCues ?? 0}`,
    '',
  ].join('\n');
}
