// Pure PCM helpers for the synthetic audio stand-in (BE-121). Float32 in [-1,1] internally, PCM16 LE at the edges.
export const SAMPLE_RATE = 16000;

export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataLen = pcm.length * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + dataLen, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28); // byte rate
  b.writeUInt16LE(2, 32); // block align
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i]!, 44 + i * 2);
  return b;
}

export const toPcm16 = (f: Float32Array): Int16Array =>
  Int16Array.from(f, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
export const fromPcm16 = (p: Int16Array): Float32Array => Float32Array.from(p, (x) => x / 32768);

/** RBJ biquad (Direct Form I). */
function biquad(x: Float32Array, kind: 'lp' | 'hp', fc: number, fs: number): Float32Array {
  const w = (2 * Math.PI * fc) / fs;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const [b0, b1, b2] =
    kind === 'lp'
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  const [a1, a2] = [(-2 * cos) / a0, (1 - alpha) / a0];
  const y = new Float32Array(x.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < x.length; i++) {
    const v = (b0 / a0) * x[i]! + (b1 / a0) * x1 + (b2 / a0) * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x[i]!, y1, v];
    y[i] = v;
  }
  return y;
}

/** Linear-interpolation resample; low-passes first when downsampling to limit aliasing. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const src = to < from ? biquad(x, 'lp', 0.45 * to, from) : x;
  const out = new Float32Array(Math.floor((x.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from) / to;
    const k = Math.floor(p);
    out[i] = src[k]! + ((src[k + 1] ?? src[k]!) - src[k]!) * (p - k);
  }
  return out;
}

export const rms = (x: Float32Array): number =>
  Math.sqrt(x.reduce((s, v) => s + v * v, 0) / (x.length || 1));

/** Deterministic PRNG so noisy variants are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Room-ish noise: low-passed white noise + 50 Hz hum. Unit-less; scale via mixAtSnr. */
export function makeNoise(len: number, fs = SAMPLE_RATE, seed = 1): Float32Array {
  const r = mulberry32(seed);
  const white = Float32Array.from({ length: len }, () => r() * 2 - 1);
  const n = biquad(white, 'lp', 3000, fs);
  for (let i = 0; i < len; i++) n[i]! += 0.15 * Math.sin((2 * Math.PI * 50 * i) / fs);
  return n;
}

/** signal + noise scaled so that rms(signal)/rms(noise) = snrDb. Clips to [-1,1]. */
export function mixAtSnr(sig: Float32Array, noise: Float32Array, snrDb: number): Float32Array {
  const g = rms(sig) / (rms(noise) || 1) / 10 ** (snrDb / 20);
  return Float32Array.from(sig, (v, i) =>
    Math.max(-1, Math.min(1, v + g * (noise[i % noise.length] ?? 0))),
  );
}

/** Meet/telephony-like: 300-3400 Hz band-pass (2 cascaded stages each side). */
export function bandLimit(x: Float32Array, fs = SAMPLE_RATE, lo = 300, hi = 3400): Float32Array {
  return biquad(biquad(biquad(biquad(x, 'hp', lo, fs), 'hp', lo, fs), 'lp', hi, fs), 'lp', hi, fs);
}

export const silence = (ms: number, fs = SAMPLE_RATE): Float32Array =>
  new Float32Array(Math.round((ms * fs) / 1000));

export interface Segment {
  kind: 'narration' | 'question';
  id?: string;
  text: string;
  audio: Float32Array;
}

export interface Timeline {
  synthetic: true;
  sampleRate: number;
  questions: { id: string; text: string; startMs: number; endMs: number }[];
}

/** Concatenate segments with `gapMs` of silence around each; question start/end = speech only (no padding). */
export function assemble(
  segs: Segment[],
  gapMs = 600,
  fs = SAMPLE_RATE,
): { audio: Float32Array; timeline: Timeline } {
  const gap = silence(gapMs, fs);
  const parts: Float32Array[] = [];
  const questions: Timeline['questions'] = [];
  let n = 0;
  for (const s of segs) {
    parts.push(gap);
    n += gap.length;
    if (s.kind === 'question')
      questions.push({
        id: s.id!,
        text: s.text,
        startMs: Math.round((n / fs) * 1000),
        endMs: Math.round(((n + s.audio.length) / fs) * 1000),
      });
    parts.push(s.audio);
    n += s.audio.length;
  }
  parts.push(gap);
  const audio = new Float32Array(n + gap.length);
  let o = 0;
  for (const p of parts) {
    audio.set(p, o);
    o += p.length;
  }
  return { audio, timeline: { synthetic: true, sampleRate: fs, questions } };
}
