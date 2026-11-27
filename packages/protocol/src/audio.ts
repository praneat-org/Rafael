// Binary audio frame: uint32 LE seq + PCM16 LE, 16 kHz mono, 100 ms (1600 samples).
export const SAMPLES_PER_FRAME = 1600;
export const AUDIO_HEADER_BYTES = 4;
export const AUDIO_FRAME_BYTES = AUDIO_HEADER_BYTES + SAMPLES_PER_FRAME * 2;

export type AudioFrame = { seq: number; pcm: Int16Array };

export function encodeAudioFrame(seq: number, pcm: Int16Array): Uint8Array {
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) {
    throw new RangeError('seq must be uint32');
  }
  if (pcm.length !== SAMPLES_PER_FRAME) {
    throw new RangeError(`pcm must be ${SAMPLES_PER_FRAME} samples`);
  }
  const out = new Uint8Array(AUDIO_FRAME_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, seq, true);
  for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
    view.setInt16(AUDIO_HEADER_BYTES + i * 2, pcm[i] ?? 0, true);
  }
  return out;
}

/** Returns null when the frame has the wrong size (never throws). */
export function decodeAudioFrame(data: Uint8Array | ArrayBuffer): AudioFrame | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength !== AUDIO_FRAME_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcm = new Int16Array(SAMPLES_PER_FRAME);
  for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
    pcm[i] = view.getInt16(AUDIO_HEADER_BYTES + i * 2, true);
  }
  return { seq: view.getUint32(0, true), pcm };
}
