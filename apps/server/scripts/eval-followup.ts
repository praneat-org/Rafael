// REAL provider run (Vertex): Detector-only pronoun follow-up golden (BE-123). One cheap call per segment.
// pnpm --filter server eval:followup [--file followups.json]. Env as eval:text. Prints pass/fail only (D11).
import { readFileSync } from 'node:fs';
import { optArg } from '../../../bench/eval/src/args.js';
import { loadBrainConfig } from '../src/brain/config.js';
import { createDetector } from '../src/brain/detector.js';
import { createGeminiClient } from '../src/brain/gemini.js';

type Case = {
  id: string;
  segments: { atMs: number; text: string }[];
  expect: { segment: number; kind: 'question' | 'none'; mustMatch?: string }[];
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

let failed = 0;
for (const c of cases) {
  let t = 0;
  const d = createDetector({ llm, config, now: () => t });
  const got: string[] = [];
  for (const [i, s] of c.segments.entries()) {
    t = s.atMs;
    const r = await d.onFinalSegment({ text: s.text });
    const e = c.expect.find((x) => x.segment === i);
    const ok =
      !e ||
      (r.kind === e.kind &&
        (!e.mustMatch || (r.kind === 'question' && new RegExp(e.mustMatch, 'i').test(r.question))));
    got.push(`${i}:${r.kind}${ok ? '' : ':FAIL'}`);
    if (!ok) failed++;
  }
  console.log(`${c.id} ${got.join(' ')}`);
}
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
