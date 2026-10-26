import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PROTOCOL_VERSION, type ServerMessage } from '@rafael/protocol';
import { log } from '../log.js';
import type { Session, SessionStore } from '../session/store.js';
import { type CueOut, createAnswerer, type PackIndex } from './answerer.js';
import type { BrainConfig } from './config.js';
import { createDetector, type Segment } from './detector.js';
import type { LlmClient } from './llm.js';

/** No pack yet (undefined) -> ask answers PACK_NOT_READY. */
export type PackProvider = (s: Session) => PackIndex | undefined;
export type BrainOptions = { llm: LlmClient; config: BrainConfig; getPack?: PackProvider };
export type AskResult = 'ok' | 'no-pack' | 'busy';

const MAX_IN_FLIGHT = 2; // per session (BE-99); extra asks are refused, never queued unbounded

type Entry = {
  answerer: ReturnType<typeof createAnswerer>;
  chain: Promise<unknown>;
  inFlight: number;
};

export function createPipeline(
  opts: BrainOptions & { getPack: PackProvider },
  store: Pick<SessionStore, 'onEnd' | 'get'>,
) {
  const perf = () => performance.now();
  const entries = new Map<string, Entry>();
  // one Detector per session; segments run one at a time so window and dedupe stay in order
  const detectors = new Map<
    string,
    { d: ReturnType<typeof createDetector>; chain: Promise<unknown> }
  >();

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
    // ended session: onEnd already ran, a new Answerer would never be disposed (D21)
    if (store.get(s.id) !== s) return undefined;
    const pack = opts.getPack(s);
    if (!pack) return undefined;
    const e: Entry = {
      answerer: createAnswerer({
        llm: opts.llm,
        config: opts.config,
        pack,
        warn: (w) =>
          log('budget.exceeded', { sessionId: s.id, stage: w.stage, ms: w.firstTokenMs }),
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
    ctx: {
      stage: 'ask' | 'segment';
      sttFinalMs?: number;
      detectorMs?: number;
      /** segment path: `pause` arrived, so no cue may start or be emitted */
      isPaused?: () => boolean;
    } = { stage: 'ask' },
  ): AskResult {
    const e = entryFor(s);
    if (!e) return 'no-pack';
    if (e.inFlight >= MAX_IN_FLIGHT) return 'busy';
    e.inFlight++;
    const cueId = randomUUID();
    // answers run in order, the older one is never cancelled
    e.chain = e.chain.then(async () => {
      if (ctx.isPaused?.()) {
        e.inFlight--; // queued behind another answer, paused before it started
        log('cue.dropped', { sessionId: s.id, reason: 'paused' });
        return;
      }
      const startedAt = perf();
      let firstCueMs: number | undefined;
      let dropped = false;
      const emit = (c: CueOut) => {
        if (ctx.isPaused?.()) {
          dropped = true;
          return;
        }
        firstCueMs ??= Math.round(perf() - receivedAt);
        send({ v: PROTOCOL_VERSION, t: 'cue', ...c });
      };
      let final: CueOut;
      try {
        final = await e.answerer.answer(cueId, question, emit);
      } finally {
        e.inFlight--;
      }
      if (dropped) log('cue.dropped', { sessionId: s.id, reason: 'paused' });
      if (ctx.stage === 'segment' && firstCueMs !== undefined) {
        const total = firstCueMs + (ctx.sttFinalMs ?? 0);
        if (total > opts.config.pipeline.firstCueBudgetMs)
          log('budget.exceeded', { sessionId: s.id, stage: 'total', ms: total });
      }
      // D11: codes and ms only, never text
      log('cue.latency', {
        sessionId: s.id,
        cueId,
        stage: ctx.stage,
        queueMs: Math.round(startedAt - receivedAt),
        firstCueMs,
        ms: Math.round(perf() - receivedAt),
        // detector path only; ms counts from the final segment (detector included)
        ...(ctx.stage === 'segment' && {
          sttFinalMs: ctx.sttFinalMs,
          detectorMs: ctx.detectorMs,
          serverTotalMs: Math.round(perf() - receivedAt) + (ctx.sttFinalMs ?? 0),
        }),
        bullets: final.bullets.length,
        outcome: dropped ? 'paused' : final.notFound ? 'notFound' : 'answered',
      });
    });
    return 'ok';
  }

  return {
    /** Pack built / refreshed: new Answerer (warms cache), or swap the pack of the existing one. */
    packReady(s: Session, pack: PackIndex) {
      const e = entries.get(s.id);
      if (e) void e.answerer.refreshPack(pack);
      else entryFor(s);
    },
    /** WS `ask {text}`: skips the Detector. `text` was already validated by the protocol schema (max 2000). */
    ask: (s: Session, text: string, send: (m: ServerMessage) => void) =>
      answerQuestion(s, text, send),

    /**
     * Final transcript segment -> Detector -> (question, not a duplicate) -> Answerer -> cue.
     * `sttFinalMs` = last voiced frame -> final, measured by the STT service. Never throws.
     */
    onFinalSegment(
      s: Session,
      seg: Segment,
      send: (m: ServerMessage) => void,
      sttFinalMs?: number,
      isPaused: () => boolean = () => false,
    ): Promise<unknown> {
      const receivedAt = perf();
      if (sttFinalMs !== undefined && sttFinalMs > opts.config.pipeline.sttFinalBudgetMs)
        log('budget.exceeded', { sessionId: s.id, stage: 'stt', ms: sttFinalMs });
      // no pack -> an answer is impossible, do not pay for a Detector call
      if (!entryFor(s)) return Promise.resolve('no-pack');
      let e = detectors.get(s.id);
      if (!e) {
        const d = createDetector({
          llm: opts.llm,
          config: opts.config,
          log: (a) =>
            log('detector', {
              sessionId: s.id,
              stage: 'detector',
              ms: a.ms,
              model: a.model,
              inputTokens: a.inputTokens,
              outputTokens: a.outputTokens,
              outcome: a.outcome,
              count: a.attempts,
            }),
          warn: (w) => log('budget.exceeded', { sessionId: s.id, stage: w.stage, ms: w.ms }),
        });
        e = { d, chain: Promise.resolve() };
        detectors.set(s.id, e);
      }
      const det = e;
      det.chain = det.chain
        .then(async () => {
          // queued behind slower segments: pause may have arrived, do not even pay for the Detector
          if (isPaused()) return void log('cue.dropped', { sessionId: s.id, reason: 'paused' });
          const t0 = perf();
          const r = await det.d.onFinalSegment(seg);
          if (r.kind !== 'question') return;
          if (isPaused()) return void log('cue.dropped', { sessionId: s.id, reason: 'paused' });
          const detectorMs = Math.round(perf() - t0);
          const res = answerQuestion(s, r.question, send, receivedAt, {
            stage: 'segment',
            sttFinalMs,
            detectorMs,
            isPaused,
          });
          if (res !== 'ok') log('cue.dropped', { sessionId: s.id, reason: res });
        })
        .catch(() => {});
      return det.chain;
    },
  };
}
