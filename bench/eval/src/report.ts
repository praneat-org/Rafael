import type { Prices } from './cost.js';
import { costPerHour } from './cost.js';
import { scoreOne, tally } from './score.js';
import { latencyStats } from './stats.js';
import { type KeyRow, type RunResult, STAGES } from './types.js';

/** BE-67 / CAR-3825 gates. */
export const GATES = { minCorrect: 16, maxOutOfSource: 0, p50Ms: 3000, p95Ms: 5000 };

const mark = (ok: boolean) => (ok ? 'PASS' : 'FAIL');

/** Markdown with scores and numbers only: no question/answer/cue text (D11). */
export function buildReport(
  keys: KeyRow[],
  results: RunResult[],
  packAnchors: ReadonlySet<string>,
  audioSeconds: number,
  prices: Prices,
  title = 'Eval run',
): string {
  const outcomes = keys.map((k, i) => scoreOne(k, results[i]?.cue ?? null, packAnchors));
  const t = tally(outcomes);
  const good = t.correct + t['not-found-correct'];
  const lat = latencyStats(results);
  const cost = costPerHour(
    results.map((r) => r.usage),
    audioSeconds,
    prices,
  );
  const L = [
    `# ${title}`,
    '',
    '## Gates',
    '| gate | value | target | |',
    '| -- | -- | -- | -- |',
    `| correct (incl. not-found-correct) | ${good}/${keys.length} | >= ${GATES.minCorrect}/${keys.length} | ${mark(good >= GATES.minCorrect)} |`,
    `| out-of-source | ${t['out-of-source']} | ${GATES.maxOutOfSource} | ${mark(t['out-of-source'] <= GATES.maxOutOfSource)} |`,
    `| total p50 | ${lat.total.p50} ms | <= ${GATES.p50Ms} ms | ${mark(lat.total.p50 <= GATES.p50Ms)} |`,
    `| total p95 | ${lat.total.p95} ms | <= ${GATES.p95Ms} ms | ${mark(lat.total.p95 <= GATES.p95Ms)} |`,
    '',
    '## Outcomes',
    '| outcome | count |',
    '| -- | -- |',
    ...Object.entries(t).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Latency (ms)',
    '| stage | p50 | p95 |',
    '| -- | -- | -- |',
    ...STAGES.map((s) => `| ${s} | ${lat[s].p50} | ${lat[s].p95} |`),
    '',
    `## Cost\n${cost.toFixed(4)} USD per hour of pitch (${audioSeconds} s audio, prices from config)`,
    '',
    '## Per question',
    '| # | outcome |',
    '| -- | -- |',
    ...outcomes.map((o, i) => `| ${i + 1} | ${o} |`),
    '',
  ];
  return L.join('\n');
}
