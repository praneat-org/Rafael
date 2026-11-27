// Real-provider check: pnpm --filter server smoke:stt (needs STT_MODEL, GOOGLE_CLOUD_PROJECT, ADC, STT_AUDIO_DIR from gen:stt-audio).
// Streams each clip in real time (100 ms frames, then 3 s of silence) and prints NUMBERS ONLY (D11: no transcript text).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGeminiStt } from '../src/stt/gemini.js';

const dir = process.env.STT_AUDIO_DIR ?? '.stt-audio';
const provider = createGeminiStt(process.env);
if (!provider) {
  console.log('smoke:stt skipped (set STT_MODEL + GOOGLE_CLOUD_PROJECT)');
  process.exit(0);
}
const hints = (process.env.STT_HINTS ?? '').split(',').filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
function lev(a: string[], b: string[]) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length]!;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VOICED = 800;

for (const f of readdirSync(dir)
  .filter((x) => x.endsWith('.pcm'))
  .sort()) {
  const name = f.replace('.pcm', '');
  const ref = [...norm(readFileSync(join(dir, `${name}.txt`), 'utf8'))];
  const b = readFileSync(join(dir, f));
  const pcm = new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
  const finals: string[] = [];
  let partials = 0;
  let errors = 0;
  const firstFinalAfterVoiceMs: number[] = []; // per final: ms since last voiced frame was sent
  let lastVoiced = 0;
  const stream = provider.start(hints, {
    onPartial: () => partials++,
    onFinal: (t) => {
      finals.push(t);
      firstFinalAfterVoiceMs.push(Math.round(performance.now() - lastVoiced));
    },
    onError: () => errors++,
  });
  const t0 = performance.now();
  for (let o = 0; o < pcm.length + 30 * 1600; o += 1600) {
    const fr = new Int16Array(1600);
    fr.set(pcm.subarray(o, o + 1600));
    if (fr.some((x) => x > VOICED || x < -VOICED)) lastVoiced = performance.now();
    stream.push(fr);
    await sleep(100 - ((performance.now() - t0) % 100)); // keep real-time pacing without drift
  }
  const closeStart = performance.now();
  await stream.close();
  const hyp = [...norm(finals.join(''))];
  console.log({
    clip: name,
    seconds: +(pcm.length / 16000).toFixed(1),
    cer: +(lev(hyp, ref) / ref.length).toFixed(3),
    refChars: ref.length,
    hypChars: hyp.length,
    finals: finals.length,
    partials,
    errors,
    finalAfterLastVoicedMs: firstFinalAfterVoiceMs.at(-1),
    closeMs: Math.round(performance.now() - closeStart),
  });
}
