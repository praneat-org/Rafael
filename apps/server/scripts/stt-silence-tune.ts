// BE-116 STT-only replay: real-time 100 ms frames of a wav through the REAL STT service, for one STT_SILENCE_MS.
// Usage: STT_MODEL=.. GOOGLE_CLOUD_PROJECT=.. tsx scripts/stt-silence-tune.ts <wav> <timeline.json> <silenceMs>
// Prints NUMBERS ONLY (D11: no transcript text). Per question (finals bucketed by arrival on the audio clock into
// [startMs_i, startMs_i+1)): finals count and latency of the first final at/after question endMs.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { MemorySessionStore } from '../src/session/store.js';
import { createGeminiStt } from '../src/stt/gemini.js';
import { createSttService } from '../src/stt/service.js';
import { parseTimeline, parseWav } from './audio-runner.js';

const [wav, tl, silence] = process.argv.slice(2);
if (!wav || !tl || !silence) throw new Error('usage: <wav> <timeline.json> <silenceMs>');
if (!(Number(silence) > 0))
  throw new Error(`silenceMs must be a positive finite number, got "${silence}"`);
const provider = createGeminiStt({ ...process.env, STT_SILENCE_MS: silence });
if (!provider) throw new Error('set STT_MODEL + GOOGLE_CLOUD_PROJECT');
const pcm = parseWav(readFileSync(wav));
const qs = parseTimeline(readFileSync(tl, 'utf8')).questions;

// counts only: stt.error = onError (watchdog fire or dead stream), stt.rollover = stream rolled
const ev = { sttError: 0, rollover: 0 };
const realLog = console.log;
console.log = (...a: unknown[]) => {
  const m = String(a[0]);
  if (m.includes('"stt.error"')) ev.sttError++;
  else if (m.includes('"stt.rollover"')) ev.rollover++;
  else realLog(...a);
};
const store = new MemorySessionStore();
const session = store.create('tune@local', 'tune');
const finalsAt: number[] = [];
let t0 = performance.now();
const stt = createSttService(
  { provider, onFinal: () => void finalsAt.push(performance.now() - t0) },
  store,
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
t0 = performance.now();
const total = pcm.length + 30 * 1600; // 3 s tail
for (let i = 0, f = 0; i < total; i += 1600, f++) {
  const fr = new Int16Array(1600);
  fr.set(pcm.subarray(i, i + 1600));
  await sleep(Math.max(0, t0 + (f + 1) * 100 - performance.now()));
  stt.push(session, fr, () => {});
}
await stt.end(session);

const lat: number[] = []; // first final at/after endMs
const latLast: number[] = []; // last final in the window (includes later narration; diagnostic only)
const frags: number[] = [];
qs.forEach((q, i) => {
  const end = qs[i + 1]?.startMs ?? Infinity;
  const w = finalsAt.filter((t) => t >= q.startMs && t < end);
  frags.push(w.length);
  const after = w.filter((t) => t >= q.endMs);
  const first = after[0];
  const last = after.at(-1);
  if (first !== undefined && last !== undefined) {
    lat.push(Math.round(first - q.endMs));
    latLast.push(Math.round(last - q.endMs));
  }
});
const pct = (p: number) =>
  [...lat].sort((a, b) => a - b)[Math.min(lat.length - 1, Math.floor(p * lat.length))];
console.log = realLog;
console.log(
  JSON.stringify({
    ...ev,
    silenceMs: Number(silence),
    questions: qs.length,
    answered: lat.length,
    p50: pct(0.5),
    p95: pct(0.95),
    max: lat.length ? Math.max(...lat) : undefined,
    lastInWindowMax: latLast.length ? Math.max(...latLast) : undefined,
    finalsPerQ: frags,
    split: frags.filter((n) => n > 1).length,
    missing: frags.filter((n) => n === 0).length,
    totalFinals: finalsAt.length,
  }),
);
process.exit(0);
