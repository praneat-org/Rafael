import { AUDIO_FRAME_BYTES, decodeAudioFrame, SAMPLES_PER_FRAME } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseWav, playMockAudio, toFrames } from './mock-audio';
import type { Transport } from './transport';

function wav(samples: number[], rate = 16000, channels = 1): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2 * channels, true);
  v.setUint16(32, 2 * channels, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    v.setInt16(44 + i * 2, s, true);
  });
  return buf;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('parseWav reads PCM16 16 kHz mono and rejects other formats', () => {
  expect(Array.from(parseWav(wav([1, -2, 3])) ?? [])).toEqual([1, -2, 3]);
  expect(parseWav(wav([1], 44100))).toBeNull();
  expect(parseWav(wav([1], 16000, 2))).toBeNull();
  expect(parseWav(new ArrayBuffer(4))).toBeNull();
});

test('toFrames: 100 ms frames, tail zero-padded', () => {
  const f = toFrames(new Int16Array(SAMPLES_PER_FRAME + 10).fill(7));
  expect(f).toHaveLength(2);
  expect(f[1]?.[9]).toBe(7);
  expect(f[1]?.[10]).toBe(0);
});

test('playMockAudio sends one numbered frame per 100 ms then stops', () => {
  const sent: Uint8Array[] = [];
  const t = { sendAudio: (f: Uint8Array) => sent.push(f) } as unknown as Transport;
  const onEnd = vi.fn();
  playMockAudio(new Int16Array(SAMPLES_PER_FRAME * 3), t, onEnd);
  vi.advanceTimersByTime(1000);
  expect(sent).toHaveLength(3);
  expect(sent.every((f) => f.byteLength === AUDIO_FRAME_BYTES)).toBe(true);
  expect(sent.map((f) => decodeAudioFrame(f)?.seq)).toEqual([0, 1, 2]);
  expect(onEnd).toHaveBeenCalledOnce();
});
