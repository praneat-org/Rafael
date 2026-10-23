import { AUDIO_FRAME_BYTES, decodeAudioFrame, SAMPLES_PER_FRAME } from '@rafael/protocol';
import { expect, test } from 'vitest';
import { AudioPipeline, floatToPcm16, Resampler, rmsPcm16 } from './pcm';

const sine = (n: number, rate: number, hz: number) =>
  Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
const feed = (p: AudioPipeline, x: Float32Array) => {
  for (let i = 0; i < x.length; i += 128) p.push(x.subarray(i, i + 128));
};
const seqOf = (f: Uint8Array | undefined) => decodeAudioFrame(f as Uint8Array)?.seq;

function pipeline(rate = 16000) {
  const frames: Uint8Array[] = [];
  const levels: number[] = [];
  const p = new AudioPipeline({ sendAudio: (f) => frames.push(f) }, (l) => levels.push(l), rate);
  return { p, frames, levels };
}

test('Resampler 48k -> 16k: 1 s in gives 16000 samples out, any chunking', () => {
  const r = new Resampler(48000);
  const x = sine(48000, 48000, 440);
  let n = 0;
  for (let i = 0; i < x.length; i += 128) n += r.process(x.subarray(i, i + 128)).length;
  expect(n).toBe(16000);
});

test('Resampler 44.1k -> 16k stays within 1 sample of the ratio', () => {
  const n = new Resampler(44100).process(sine(44100, 44100, 440)).length;
  expect(Math.abs(n - 16000)).toBeLessThanOrEqual(1);
});

test('Resampler keeps a low tone and attenuates a tone that would alias to DC', () => {
  const peak = (a: Float32Array) => Math.max(...a.subarray(10).map(Math.abs));
  // 16 kHz tone at 48 kHz in: plain decimation (every 3rd sample) would give a constant ~1.0
  const alias = Float32Array.from({ length: 4800 }, (_, i) =>
    Math.cos((2 * Math.PI * 16000 * i) / 48000),
  );
  expect(peak(new Resampler(48000).process(sine(4800, 48000, 440)))).toBeGreaterThan(0.9);
  expect(peak(new Resampler(48000).process(alias))).toBeLessThan(0.1);
});

test('Resampler rejects upsampling', () => {
  expect(() => new Resampler(8000)).toThrow(RangeError);
});

test('floatToPcm16 hits the edges and clamps overload', () => {
  expect(floatToPcm16(0)).toBe(0);
  expect(floatToPcm16(1)).toBe(32767);
  expect(floatToPcm16(-1)).toBe(-32768);
  expect(floatToPcm16(2.5)).toBe(32767);
  expect(floatToPcm16(-9)).toBe(-32768);
});

test('rmsPcm16: silence 0, full-scale square 1', () => {
  expect(rmsPcm16(new Int16Array(100))).toBe(0);
  expect(rmsPcm16(new Int16Array(100).fill(-32768))).toBeCloseTo(1, 5);
});

test('pipeline emits fixed-size contiguous frames from 128-sample blocks', () => {
  const { p, frames } = pipeline();
  feed(p, sine(SAMPLES_PER_FRAME * 3 + 64, 16000, 440));
  expect(frames).toHaveLength(3); // the 64-sample tail is not sent as a short frame
  frames.forEach((f, i) => {
    expect(f.byteLength).toBe(AUDIO_FRAME_BYTES);
    expect(seqOf(f)).toBe(i);
  });
  // content is the tone, not zeros
  expect(Math.max(...(decodeAudioFrame(frames[1] as Uint8Array)?.pcm ?? [0]))).toBeGreaterThan(
    30000,
  );
});

test('pipeline at 48 kHz input still produces ~10 frames per second', () => {
  const { p, frames } = pipeline(48000);
  feed(p, sine(48000, 48000, 440));
  expect(frames).toHaveLength(10); // 48000 in -> exactly 16000 out (see Resampler test) = 10 frames
});

test('pause stops frames at once, drops the partial frame, resume continues the sequence', () => {
  const { p, frames, levels } = pipeline();
  const tone = sine(SAMPLES_PER_FRAME, 16000, 440);
  p.push(tone.subarray(0, 800)); // half a frame buffered
  p.pause();
  feed(p, tone);
  feed(p, tone);
  expect(frames).toHaveLength(0);
  expect(levels.at(-1)).toBe(0);
  p.resume();
  p.push(tone.subarray(0, 800));
  expect(frames).toHaveLength(0); // had the old 800 been kept, these 800 would complete a frame
  p.push(tone.subarray(800));
  expect(frames).toHaveLength(1);
  expect(seqOf(frames[0])).toBe(0);
  feed(p, tone);
  expect(seqOf(frames[1])).toBe(1);
});

test('level is reported per frame', () => {
  const { p, levels } = pipeline();
  feed(p, sine(SAMPLES_PER_FRAME, 16000, 440));
  expect(levels).toHaveLength(1);
  expect(levels[0]).toBeGreaterThan(0.6); // sine RMS ~0.707
});
