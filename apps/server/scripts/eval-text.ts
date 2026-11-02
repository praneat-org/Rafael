// REAL provider run (Vertex), text mode, no audio: pnpm --filter server eval:text [--key k.csv] [--pack dir] [--prices p.json] [--out report.md]
// Env: GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT GOOGLE_CLOUD_LOCATION DETECTOR_MODEL ANSWERER_MODEL (+ ADC).
// Prints scores and numbers only (D11). Results on the synthetic fixture must not drive Go/No-go.
import { readFileSync, writeFileSync } from 'node:fs';
import { optArg } from '../../../bench/eval/src/args.js';
import { parsePrices } from '../../../bench/eval/src/cost.js';
import { parseKey } from '../../../bench/eval/src/key.js';
import { buildReport } from '../../../bench/eval/src/report.js';
import { loadBrainConfig } from '../src/brain/config.js';
import { createGeminiClient } from '../src/brain/gemini.js';
import { buildFixturePack, textRunner } from './text-runner.js';

const fx = new URL('../../../bench/eval/fixtures/', import.meta.url).pathname;
const arg = (n: string, d: string) => optArg(process.argv, n, d);
const config = loadBrainConfig(process.env);
const llm = createGeminiClient(process.env, { required: true });
if (!llm) throw new Error('no LLM backend');
const keys = parseKey(readFileSync(arg('key', `${fx}synthetic-deal/key.csv`), 'utf8'));
const prices = parsePrices(readFileSync(arg('prices', `${fx}prices.json`), 'utf8'));
const pack = await buildFixturePack(arg('pack', `${fx}synthetic-deal/pack`));
const results = await (await textRunner({ llm, config, pack }))(
  keys.map((k) => ({ question: k.question })),
);
// no audio in text mode: cost/h extrapolates these questions as one 600 s pitch, STT price zeroed
const md = buildReport(
  keys,
  results,
  new Set(pack.anchors),
  600,
  { ...prices, sttPerMinute: 0 },
  `Eval run (TEXT runner, real Vertex, ${config.answererModel}; cost = tokens only, ${keys.length} Q as a 600 s pitch)`,
);
const out = arg('out', '');
if (out) writeFileSync(out, md);
else process.stdout.write(md);
