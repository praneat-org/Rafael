import { encodeAudioFrame, SAMPLES_PER_FRAME } from '@rafael/protocol';
import type { Transport } from './transport';

/**
 * Dev only: plays a recorded .wav instead of the mic. The file is read into memory,
 * never stored or committed (D11). ponytail: accepts 16 kHz PCM16 only — convert with
 * `ffmpeg -i in.wav -ar 16000 -ac 1 out.wav`; add resampling if that becomes a chore.
 */
export function parseWav(buf: ArrayBuffer): Int16Array | null {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
  if (buf.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let ok = false;
  for (let o = 12; o + 8 <= buf.byteLength; ) {
    const size = v.getUint32(o + 4, true);
    if (tag(o) === 'fmt ' && o + 8 + 16 <= buf.byteLength) {
      // PCM, mono, 16 kHz, 16 bit
      ok =
        v.getUint16(o + 8, true) === 1 &&
        v.getUint16(o + 10, true) === 1 &&
        v.getUint32(o + 12, true) === 16000 &&
        v.getUint16(o + 22, true) === 16;
    } else if (tag(o) === 'data') {
      if (!ok) return null;
      const n = Math.floor(Math.min(size, buf.byteLength - o - 8) / 2);
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) pcm[i] = v.getInt16(o + 8 + i * 2, true);
      return pcm;
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** Splits PCM into 100 ms frames; the tail is zero-padded to a full frame. */
export function toFrames(pcm: Int16Array): Int16Array[] {
  const frames: Int16Array[] = [];
  for (let i = 0; i < pcm.length; i += SAMPLES_PER_FRAME) {
    const f = new Int16Array(SAMPLES_PER_FRAME);
    f.set(pcm.subarray(i, i + SAMPLES_PER_FRAME));
    frames.push(f);
  }
  return frames;
}

/** Sends one frame every 100 ms through the transport. Returns a stop function. */
export function playMockAudio(pcm: Int16Array, transport: Transport, onEnd?: () => void) {
  const frames = toFrames(pcm);
  let seq = 0;
  const timer = setInterval(() => {
    const f = frames[seq];
    if (!f) {
      clearInterval(timer);
      onEnd?.();
      return;
    }
    transport.sendAudio(encodeAudioFrame(seq++, f));
  }, 100);
  return () => clearInterval(timer);
}
