import { encodeAudioFrame, SAMPLES_PER_FRAME } from '@rafael/protocol';
import type { Transport } from '../transport';

export const TARGET_RATE = 16000;

/**
 * Streaming box-filter decimator (average of each input window = cheap low-pass).
 * ponytail: downsampling only (from >= to); Chrome gives us 16 kHz directly via
 * AudioContext({ sampleRate }), this is the fallback if the context ignores it.
 */
export class Resampler {
  private step: number;
  private acc = 0;
  private filled = 0;

  constructor(from: number, to: number = TARGET_RATE) {
    if (from < to) throw new RangeError('upsampling not supported');
    this.step = from / to;
  }

  process(input: Float32Array): Float32Array {
    const out: number[] = [];
    for (const x of input) {
      const w = Math.min(1, this.step - this.filled);
      this.acc += x * w;
      this.filled += w;
      if (this.filled >= this.step - 1e-9) {
        out.push(this.acc / this.step);
        this.acc = x * (1 - w);
        this.filled = 1 - w;
      }
    }
    return Float32Array.from(out);
  }
}

/** Float [-1, 1] -> int16, clamped (mixing tab + mic can exceed full scale). */
export function floatToPcm16(x: number): number {
  const c = Math.max(-1, Math.min(1, x));
  return Math.round(c < 0 ? c * 0x8000 : c * 0x7fff);
}

/** RMS of a PCM16 frame, 0..1. */
export function rmsPcm16(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let s = 0;
  for (const v of pcm) s += (v / 0x8000) ** 2;
  return Math.sqrt(s / pcm.length);
}

/**
 * Mono float chunks (any size, e.g. 128 from the worklet) -> encoded 100 ms frames -> transport.
 * Memory only (D11). Paused = chunks are dropped and the partial frame is discarded, nothing queued.
 */
export class AudioPipeline {
  private buf = new Int16Array(SAMPLES_PER_FRAME);
  private n = 0;
  private seq = 0;
  private paused = false;
  private resampler: Resampler | null;

  constructor(
    private transport: Pick<Transport, 'sendAudio'>,
    private onLevel: (rms: number) => void,
    inputRate: number = TARGET_RATE,
  ) {
    this.resampler = inputRate === TARGET_RATE ? null : new Resampler(inputRate);
  }

  push(chunk: Float32Array): void {
    if (this.paused) return;
    const x = this.resampler ? this.resampler.process(chunk) : chunk;
    for (const v of x) {
      this.buf[this.n++] = floatToPcm16(v);
      if (this.n === SAMPLES_PER_FRAME) {
        this.onLevel(rmsPcm16(this.buf));
        this.transport.sendAudio(encodeAudioFrame(this.seq++, this.buf));
        this.n = 0; // encodeAudioFrame copies, so the buffer is reused
      }
    }
  }

  pause(): void {
    this.paused = true;
    this.n = 0;
    this.onLevel(0);
  }

  resume(): void {
    this.paused = false;
  }
}
