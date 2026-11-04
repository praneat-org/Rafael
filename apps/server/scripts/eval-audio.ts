// REAL provider run (Vertex STT + LLM), audio mode, real-time replay:
//   pnpm --filter server eval:audio --audio <wav> --timeline <timeline.json> --pack <dir> --key <key.csv> --out <outside-repo report.md> [--dump <outside-repo cues.json>] [--prices p.json]
// Env: GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT GOOGLE_CLOUD_LOCATION DETECTOR_MODEL ANSWERER_MODEL STT_MODEL (+ ADC).
// Prints scores and numbers only (D11). timeline.synthetic=true -> banner + report is not for Go/No-go.
import { readFileSync, writeFileSync } from 'node:fs';
import { optArg } from '../../../bench/eval/src/args.js';
import { parsePrices } from '../../../bench/eval/src/cost.js';
import { parseKey } from '../../../bench/eval/src/key.js';
import { assertOutsideRepo } from '../../../bench/eval/src/outside.js';
import { buildReport } from '../../../bench/eval/src/report.js';
import { loadBrainConfig } from '../src/brain/config.js';
import { createGeminiClient } from '../src/brain/gemini.js';
import { createGeminiStt } from '../src/stt/gemini.js';
import { auditReport } from './audio-report.js';
import { parseTimeline, parseWav, runAudio } from './audio-runner.js';
import { buildFixturePack, dumpResults } from './text-runner.js';

const need = (n: string) => {
  const v = optArg(process.argv, n, '');
  if (!v) throw new Error(`--${n} is required`);
  return v;
};
const fx = new URL('../../../bench/eval/fixtures/', import.meta.url).pathname;
const out = optArg(process.argv, 'out', '');
const dump = optArg(process.argv, 'dump', '');
// fail before the (paid) run, not after it
if (out) assertOutsideRepo(out, '--out');
if (dump) assertOutsideRepo(dump, '--dump');

const pcm = parseWav(readFileSync(need('audio')));
const timeline = parseTimeline(readFileSync(need('timeline'), 'utf8'));
const keys = parseKey(readFileSync(need('key'), 'utf8'));
if (keys.length !== timeline.questions.length)
  throw new Error(`timeline has ${timeline.questions.length} questions, key has ${keys.length}`);
const prices = parsePrices(
  readFileSync(optArg(process.argv, 'prices', `${fx}prices.json`), 'utf8'),
);
const config = loadBrainConfig(process.env);
const llm = createGeminiClient(process.env, { required: true });
const stt = createGeminiStt(process.env);
if (!llm || !stt) throw new Error('need LLM backend + STT_MODEL / GOOGLE_CLOUD_PROJECT');
const pack = await buildFixturePack(need('pack'));

const synthetic = timeline.synthetic === true;
if (synthetic) console.error('*** SYNTHETIC audio/timeline: result is NOT for Go/No-go ***');
const { results, extraCues, duplicateCues } = await runAudio({
  llm,
  config,
  pack,
  stt,
  pcm,
  timeline,
});
if (dump) dumpResults(dump, results);

const seconds = Math.round(pcm.length / 16000);
const md = auditReport({
  base: buildReport(
    keys,
    results,
    new Set(pack.anchors),
    seconds,
    prices,
    `Eval run (AUDIO replay real-time, ${config.answererModel}, STT ${process.env.STT_MODEL})`,
  ),
  ids: timeline.questions.map((q) => q.id),
  results,
  extraCues,
  duplicateCues,
  synthetic,
});
if (out) writeFileSync(assertOutsideRepo(out, '--out'), md);
else process.stdout.write(md);
