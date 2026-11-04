import { describe, expect, it } from 'vitest';
import {
  assemble,
  bandLimit,
  encodeWav,
  fromPcm16,
  makeNoise,
  minQuestionGap,
  mixAtSnr,
  resample,
  rms,
  silence,
  toPcm16,
} from './audio.js';

const sine = (hz: number, fs: number, secs: number) =>
  Float32Array.from(
    { length: Math.round(fs * secs) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / fs),
  );

describe('encodeWav', () => {
  it('writes RIFF PCM16 mono 16 kHz header + samples', () => {
    const w = encodeWav(Int16Array.from([0, 1000, -1000]));
    expect(w.toString('ascii', 0, 4)).toBe('RIFF');
    expect(w.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(w.readUInt16LE(20)).toBe(1);
    expect(w.readUInt16LE(22)).toBe(1);
    expect(w.readUInt32LE(24)).toBe(16000);
    expect(w.readUInt16LE(34)).toBe(16);
    expect(w.readUInt32LE(40)).toBe(6);
    expect(w.readUInt32LE(4)).toBe(w.length - 8);
    expect(w.readInt16LE(46)).toBe(1000);
    expect(w.readInt16LE(48)).toBe(-1000);
  });
  it('pcm16 round trip clips', () => {
    expect(Array.from(toPcm16(Float32Array.from([2, -2, 0])))).toEqual([32767, -32767, 0]);
    expect(fromPcm16(Int16Array.from([16384]))[0]).toBeCloseTo(0.5);
  });
});

describe('resample', () => {
  it('24k -> 16k scales length and keeps a 440 Hz tone level', () => {
    const y = resample(sine(440, 24000, 1), 24000, 16000);
    expect(y.length).toBe(16000);
    expect(rms(y.subarray(1000, 15000))).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });
  it('same rate is identity', () => {
    const x = sine(100, 16000, 0.1);
    expect(resample(x, 16000, 16000)).toBe(x);
  });
});

describe('mix / band-limit', () => {
  it('mixAtSnr hits the requested SNR', () => {
    const s = sine(300, 16000, 1);
    const n = makeNoise(16000);
    const mixed = mixAtSnr(s, n, 10);
    const resid = Float32Array.from(mixed, (v, i) => v - s[i]!);
    expect(20 * Math.log10(rms(s) / rms(resid))).toBeCloseTo(10, 1);
  });
  it('makeNoise is deterministic per seed', () => {
    expect(makeNoise(100, 16000, 3)).toEqual(makeNoise(100, 16000, 3));
    expect(makeNoise(100, 16000, 3)).not.toEqual(makeNoise(100, 16000, 4));
  });
  it('bandLimit keeps 1 kHz, kills 6 kHz and 50 Hz', () => {
    const mid = rms(bandLimit(sine(1000, 16000, 1)).subarray(2000));
    expect(mid).toBeGreaterThan(0.25);
    expect(rms(bandLimit(sine(6000, 16000, 1)).subarray(2000))).toBeLessThan(mid / 10);
    expect(rms(bandLimit(sine(50, 16000, 1)).subarray(2000))).toBeLessThan(mid / 10);
  });
});

describe('assemble timeline', () => {
  it('offsets questions after gaps and preceding audio', () => {
    const q = (id: string, secs: number) => ({
      kind: 'question' as const,
      id,
      text: id,
      audio: silence(secs * 1000),
    });
    const nar = { kind: 'narration' as const, text: 'n', audio: silence(2000) };
    const { audio, timeline } = assemble([nar, q('q01', 1), q('q02', 0.5)], 500, 16000, 0);
    expect(timeline.synthetic).toBe(true);
    expect(timeline.sampleRate).toBe(16000);
    // gap .5 + nar 2 + gap .5 -> q01 starts 3.0 ends 4.0; gap .5 -> q02 4.5..5.0
    expect(timeline.questions).toEqual([
      { id: 'q01', text: 'q01', startMs: 3000, endMs: 4000 },
      { id: 'q02', text: 'q02', startMs: 4500, endMs: 5000 },
    ]);
    expect(audio.length).toBe(Math.round(5.5 * 16000)); // trailing gap
  });

  it('keeps >= 8000 ms between adjacent questions by default', () => {
    const q = (id: string) => ({ kind: 'question' as const, id, text: id, audio: silence(1000) });
    const { timeline } = assemble([q('a'), q('b'), q('c')]);
    expect(minQuestionGap(timeline)).toBeGreaterThanOrEqual(8000);
  });
});
