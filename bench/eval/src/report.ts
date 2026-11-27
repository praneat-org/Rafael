import type { Prices } from './cost.js';
import { costPerHour } from './cost.js';
import { factsOf, missingFacts, scoreOne, tally } from './score.js';
import { latencyStats, SERVER_TOTAL_WARN_MS, serverTotalStats } from './stats.js';
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
  if (results.length !== keys.length)
    throw new Error(`eval: ${results.length} results for ${keys.length} keys`);
  const outcomes = keys.map((k, i) => scoreOne(k, results[i]?.cue ?? null, packAnchors));
  const t = tally(outcomes);
  // anchor-only keys (no checkable fact) are shown apart and never count toward the gate
  const anchorOnly = keys.map((k) => !!k.anchor && !factsOf(k).length);
  const anchorOnlyCorrect = outcomes.filter((o, i) => o === 'correct' && anchorOnly[i]).length;
  const good = t.correct - anchorOnlyCorrect + t['not-found-correct'];
  const lat = latencyStats(results);
  const srv = serverTotalStats(results);
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
    `| correct (fact-checked + not-found-correct) | ${good}/${keys.length} | >= ${GATES.minCorrect}/${keys.length} | ${mark(good >= GATES.minCorrect)} |`,
    `| out-of-source | ${t['out-of-source']} | ${GATES.maxOutOfSource} | ${mark(t['out-of-source'] <= GATES.maxOutOfSource)} |`,
    `| total p50 | ${lat.total.p50} ms | <= ${GATES.p50Ms} ms | ${mark(lat.total.p50 <= GATES.p50Ms)} |`,
    `| total p95 | ${lat.total.p95} ms | <= ${GATES.p95Ms} ms | ${mark(lat.total.p95 <= GATES.p95Ms)} |`,
    '',
    '## Outcomes',
    '| outcome | count |',
    '| -- | -- |',
    ...Object.entries(t).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `Fact-checked: ${keys.filter((k) => k.anchor && factsOf(k).length).length} · anchor-only: ${anchorOnly.filter(Boolean).length} (correct, not in gate: ${anchorOnlyCorrect}) · not-found keys: ${keys.filter((k) => !k.anchor).length}`,
    '',
    '## Latency (ms)',
    '| stage | p50 | p95 |',
    '| -- | -- | -- |',
    ...STAGES.map((s) => `| ${s} | ${lat[s].p50} | ${lat[s].p95} |`),
    ...(srv
      ? [
          `| serverTotal (cross-check) | ${srv.p50} | ${srv.p95} |`,
          '',
          'Gate = wall-clock `total` (includes endpointing + network). `serverTotal` = pipeline `serverTotalMs` = `cue.latencyMs` (D26), cross-check only.',
          ...(Math.abs(srv.p50 - lat.total.p50) > SERVER_TOTAL_WARN_MS ||
          Math.abs(srv.p95 - lat.total.p95) > SERVER_TOTAL_WARN_MS
            ? [
                '',
                `WARN: wall-clock total and serverTotal differ by > ${SERVER_TOTAL_WARN_MS} ms at p50 or p95`,
              ]
            : []),
        ]
      : []),
    '',
    `## Cost\n${cost.toFixed(4)} USD per hour of pitch (${audioSeconds} s audio, prices from config)`,
    '',
    '## Per question',
    srv
      ? '| # | outcome | total ms | serverTotal ms | missing facts |'
      : '| # | outcome | missing facts |',
    srv ? '| -- | -- | -- | -- | -- |' : '| -- | -- | -- |',
    ...outcomes.map((o, i) => {
      const c = results[i]?.cue;
      const miss = o === 'wrong-fact' && c ? missingFacts(keys[i] as KeyRow, c).join(', ') : '';
      if (!srv) return `| ${i + 1} | ${o} | ${miss} |`;
      const tm = results[i]?.timings;
      const gap =
        c &&
        tm?.serverTotal !== undefined &&
        Math.abs(tm.serverTotal - tm.total) > SERVER_TOTAL_WARN_MS;
      return `| ${i + 1} | ${o} | ${c ? tm?.total : ''} | ${c ? (tm?.serverTotal ?? '') : ''}${gap ? ' WARN' : ''} | ${miss} |`;
    }),
    '',
  ];
  return L.join('\n');
}
