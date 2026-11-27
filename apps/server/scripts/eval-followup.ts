// REAL provider run (Vertex): follow-up golden (BE-123 + session history). One cheap call per segment.
// Each detected question becomes a history turn (with the case's synthetic `answer`), like Session.cues.
// `ask: true` segments go through resolveQuestion (typed ask). --answer also runs the Answerer on every
// follow-up with its history, to check the pack CachedContent still hits (cacheReadTokens) and latency.
// pnpm --filter server eval:followup [--file followups.json] [--answer]. Env as eval:text.
// Prints pass/fail, counts and ms only (D11).
import { readFileSync } from 'node:fs';
import { optArg } from '../../../bench/eval/src/args.js';
import { createAnswerer } from '../src/brain/answerer.js';
import { loadBrainConfig } from '../src/brain/config.js';
import { createDetector, resolveQuestion } from '../src/brain/detector.js';
import { createGeminiClient } from '../src/brain/gemini.js';
import { renderHistory, type Turn } from '../src/brain/history.js';
import { buildFixturePack } from './text-runner.js';

type Case = {
  id: string;
  /** answer: synthetic short answer that goes into history ("NOT_FOUND" = not in pack); ask = typed */
  segments: { atMs: number; text: string; answer?: string; ask?: boolean }[];
  expect: {
    segment: number;
    kind: 'question' | 'none';
    mustMatch?: string | string[];
    mustNotMatch?: string;
  }[];
};
const file = optArg(
  process.argv,
  'file',
  new URL('../../../bench/eval/fixtures/synthetic-deal/followups.json', import.meta.url).pathname,
);
const cases = JSON.parse(readFileSync(file, 'utf8')) as Case[];
const config = loadBrainConfig(process.env);
const llm = createGeminiClient(process.env, { required: true });
if (!llm) throw new Error('no LLM backend');

const withAnswer = process.argv.includes('--answer');
type AnswererLogLite = { cacheReadTokens?: number; firstTokenMs?: number; firstCueMs?: number };
const box: { last?: AnswererLogLite } = {}; // set by the Answerer log callback
const answerer = withAnswer
  ? createAnswerer({
      llm,
      config,
      pack: (
        await buildFixturePack(
          new URL('../../../bench/eval/fixtures/synthetic-deal/pack', import.meta.url).pathname,
        )
      ).chunks,
      log: (e) => {
        box.last = e;
      },
    })
  : undefined;
await answerer?.ready();

let failed = 0;
const answerStats: string[] = [];
try {
  for (const c of cases) {
    let t = 0;
    const d = createDetector({ llm, config, now: () => t });
    const turns: Turn[] = [];
    const got: string[] = [];
    for (const [i, s] of c.segments.entries()) {
      t = s.atMs;
      const history = renderHistory(turns, config.history);
      const t0 = performance.now();
      const r = s.ask
        ? {
            kind: 'question' as const,
            question: history.turns
              ? (await resolveQuestion({ llm, config }, s.text, history.text)).question
              : s.text,
          }
        : await d.onFinalSegment({ text: s.text }, history.text);
      const ms = Math.round(performance.now() - t0);
      const e = c.expect.find((x) => x.segment === i);
      const q = r.kind === 'question' ? r.question : '';
      const ok =
        !e ||
        (r.kind === e.kind &&
          [e.mustMatch ?? []].flat().every((m) => new RegExp(m, 'i').test(q)) &&
          !(e.mustNotMatch && new RegExp(e.mustNotMatch, 'i').test(q)));
      got.push(`${i}:${r.kind}:${ms}ms:h${history.turns}${ok ? '' : ':FAIL'}`);
      if (!ok) failed++;
      if (r.kind !== 'question') continue;
      if (answerer && history.turns) {
        box.last = undefined;
        await answerer.answer(`${c.id}-${i}`, q, () => {}, history);
        const l = (box as { last?: AnswererLogLite }).last; // set by the log callback (TS can't see it)
        answerStats.push(
          `${c.id}:${i} h${history.turns} cacheRead=${l?.cacheReadTokens ?? 0} firstToken=${l?.firstTokenMs}ms firstCue=${l?.firstCueMs ?? '-'}ms`,
        );
      }
      turns.push({
        question: q,
        bullets: s.answer && s.answer !== 'NOT_FOUND' ? [s.answer] : [],
        notFound: s.answer === 'NOT_FOUND',
      });
    }
    console.log(`${c.id} ${got.join(' ')}`);
  }
} finally {
  await answerer?.dispose(); // D21: delete the CachedContent
}
for (const l of answerStats) console.log(`answer ${l}`);
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
