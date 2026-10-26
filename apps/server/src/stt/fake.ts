import type { SttHandlers, SttProvider, SttStream } from './provider.js';

/**
 * Test / dev provider. A frame "says" the word `word(pcm[0])`; pcm[0] === 0 is silence.
 * Emits a partial per word and a final every `finalEvery` words (and on close).
 */
export class FakeSttProvider implements SttProvider {
  readonly starts: string[][] = []; // hints of every start(), for assertions
  readonly handlers: SttHandlers[] = [];
  closes = 0; // close() calls, for leak assertions
  /** the next N start() calls throw (provider down) */
  failStarts = 0;
  constructor(
    private readonly o: { finalEvery?: number; word?: (id: number) => string | undefined } = {},
  ) {}

  start(hints: readonly string[], h: SttHandlers): SttStream {
    if (this.failStarts > 0) {
      this.failStarts--;
      throw new Error('fake provider down');
    }
    this.starts.push([...hints]);
    this.handlers.push(h);
    const every = this.o.finalEvery ?? 3;
    const word = this.o.word ?? ((id: number) => (id > 0 ? `w${id}` : undefined));
    let pending: string[] = [];
    const flush = () => {
      if (pending.length) h.onFinal(pending.join(' '));
      pending = [];
    };
    return {
      push(pcm) {
        const w = word(pcm[0] ?? 0);
        if (!w) return;
        pending.push(w);
        h.onPartial(pending.join(' '));
        if (pending.length >= every) flush();
      },
      close: async () => {
        this.closes++;
        flush();
      },
    };
  }

  /** simulate the newest stream dying */
  failLast() {
    this.handlers.at(-1)?.onError();
  }
}
