import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PROTOCOL_VERSION, type ServerMessage } from '@rafael/protocol';
import { log } from '../log.js';
import type { Session, SessionStore } from '../session/store.js';
import { type CueOut, createAnswerer, type PackIndex } from './answerer.js';
import type { BrainConfig } from './config.js';
import { createDetector, type Segment } from './detector.js';
import type { LlmClient } from './llm.js';

/** BE-108 will supply the real pack; until then no provider -> ask answers LLM_UNAVAILABLE. */
export type PackProvider = (s: Session) => PackIndex | undefined;
export type BrainOptions = { llm: LlmClient; config: BrainConfig; getPack: PackProvider };
export type AskResult = 'ok' | 'no-pack' | 'busy';

const MAX_IN_FLIGHT = 2; // per session (BE-99); extra asks are refused, never queued unbounded

type Entry = {
  answerer: ReturnType<typeof createAnswerer>;
  chain: Promise<unknown>;
  inFlight: number;
};

export function createPipeline(opts: BrainOptions, store: Pick<SessionStore, 'onEnd'>) {
  const perf = () => performance.now();
  const entries = new Map<string, Entry>();
  const detectors = new Map<string, ReturnType<typeof createDetector>>();

  // D21: session end / expiry deletes the CachedContent
  store.onEnd(async (s) => {
    const e = entries.get(s.id);
    entries.delete(s.id);
    detectors.delete(s.id);
    await e?.answerer.dispose();
  });

  function entryFor(s: Session): Entry | undefined {
    const have = entries.get(s.id);
    if (have) return have;
    const pack = opts.getPack(s);
    if (!pack) return undefined;
    const e: Entry = {
      answerer: createAnswerer({
        llm: opts.llm,
        config: opts.config,
        pack,
        log: (a) =>
          log('answerer', {
            sessionId: s.id,
            stage: 'answerer',
            model: a.model,
            firstTokenMs: a.firstTokenMs,
            ms: a.ms,
            cached: a.cached,
            inputTokens: a.inputTokens,
            cacheReadTokens: a.cacheReadTokens,
            outputTokens: a.outputTokens,
          }),
      }),
      chain: Promise.resolve(),
      inFlight: 0,
    };
    entries.set(s.id, e);
    return e;
  }

  /** Shared by ask and (later) Detector: one question -> partial cues, then the final cue. */
  function answerQuestion(
    s: Session,
    question: string,
    send: (m: ServerMessage) => void,
    receivedAt = perf(),
  ): AskResult {
    const e = entryFor(s);
    if (!e) return 'no-pack';
    if (e.inFlight >= MAX_IN_FLIGHT) return 'busy';
    e.inFlight++;
    const cueId = randomUUID();
    // answers run in order, the older one is never cancelled
    e.chain = e.chain.then(async () => {
      const startedAt = perf();
      let firstCueMs: number | undefined;
      const emit = (c: CueOut) => {
        firstCueMs ??= Math.round(perf() - receivedAt);
        send({ v: PROTOCOL_VERSION, t: 'cue', ...c });
      };
      let final: CueOut;
      try {
        final = await e.answerer.answer(cueId, question, emit);
      } finally {
        e.inFlight--;
      }
      // D11: codes and ms only, never text
      log('cue.latency', {
        sessionId: s.id,
        cueId,
        stage: 'ask',
        queueMs: Math.round(startedAt - receivedAt),
        firstCueMs,
        ms: Math.round(perf() - receivedAt),
        bullets: final.bullets.length,
        outcome: final.notFound ? 'notFound' : 'answered',
      });
    });
    return 'ok';
  }

  return {
    /** WS `ask {text}`: skips the Detector. `text` was already validated by the protocol schema (max 2000). */
    ask: (s: Session, text: string, send: (m: ServerMessage) => void) =>
      answerQuestion(s, text, send),

    /**
     * Seam: final transcript segment -> Detector -> Answerer.
     * TODO(BE-89): call this from SttProvider.onFinal. Not wired anywhere until the STT adapter exists.
     */
    async onFinalSegment(s: Session, seg: Segment, send: (m: ServerMessage) => void) {
      const receivedAt = perf();
      let d = detectors.get(s.id);
      if (!d) {
        d = createDetector({ llm: opts.llm, config: opts.config });
        detectors.set(s.id, d);
      }
      const r = await d.onFinalSegment(seg);
      if (r.kind === 'question') return answerQuestion(s, r.question, send, receivedAt);
      return undefined;
    },
  };
}
