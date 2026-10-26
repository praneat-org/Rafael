// Provider-agnostic STT seam (BE-89). Real adapters (Deepgram / Chirp) wait on BE-79.
// D11: nothing here persists audio or text; implementations must not log either.

export type SttHandlers = {
  /** interim text of the current segment (replaces the previous partial) */
  onPartial(text: string, speaker?: string): void;
  /** a finished segment */
  onFinal(text: string, speaker?: string): void;
  /** stream died; the caller closes it and opens a new one */
  onError(): void;
};

export interface SttStream {
  /** one 100 ms frame, PCM16 LE 16 kHz mono */
  push(pcm: Int16Array): void;
  /** flush pending text as onFinal calls, THEN resolve (rollover relies on this order) */
  close(): Promise<void>;
}

export interface SttProvider {
  /** `hints` = phrase list (product / customer names, acronyms) for providers that support boosting */
  start(hints: readonly string[], h: SttHandlers): SttStream;
}
