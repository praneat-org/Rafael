import { performance } from 'node:perf_hooks';
import { PROTOCOL_VERSION, type ServerMessage } from '@rafael/protocol';
import { log } from '../log.js';
import type { Session, SessionStore } from '../session/store.js';
import type { SttProvider } from './provider.js';
import { createRollingStt } from './rolling.js';

export type SttOptions = {
  provider: SttProvider;
  rolloverMs?: number; // default 4.5 min (Chirp limit 5 min); lower it to test rollover
  overlapMs?: number;
  /** phrase hints from the Session Pack; read when the stream opens (first audio frame) */
  getHints?: (s: Session) => readonly string[];
  /**
   * Every final segment, for the Brain (BE-99). `sttFinalMs` = end of the newest speech run that ended
   * before it (a run ends after 300 ms of silence) -> this final; if speech never paused,
   * the last voiced frame. Approximation of endpointing + provider latency; undefined without speech.
   */
  onFinal?: (
    s: Session,
    seg: { text: string; speaker?: string },
    send: (m: ServerMessage) => void,
    meta: { sttFinalMs?: number },
  ) => void;
  /** test seam: is this frame speech? default = peak amplitude above VOICED_PEAK */
  voiced?: (pcm: Int16Array) => boolean;
  now?: () => number;
};

const VOICED_PEAK = 800; // ponytail: peak threshold, not a VAD. Quiet speakers / loud rooms skew sttFinalMs only (a metric).
const peakVoiced = (pcm: Int16Array) => pcm.some((x) => x > VOICED_PEAK || x < -VOICED_PEAK);

const RUN_END_FRAMES = 3; // 3 x 100 ms of silence ends a speech run

type Entry = {
  rolling: ReturnType<typeof createRollingStt>;
  send: (m: ServerMessage) => void;
  gen: number; // makes segIds unique across streams of one session (pause / reopen)
  lastVoicedAt?: number;
  silent: number; // consecutive unvoiced frames after a voiced one
  runEnds: number[]; // ends of finished speech runs, oldest first
};

/** One rolling STT stream per session. Disposed with the session (store.onEnd), D11. */
export function createSttService(opts: SttOptions, store: Pick<SessionStore, 'onEnd' | 'get'>) {
  const entries = new Map<string, Entry>();
  let gens = 0;
  const now = opts.now ?? (() => performance.now());
  const voiced = opts.voiced ?? peakVoiced;

  /** flush the stream (last finals go out through `send`), then drop it. Idempotent. */
  async function end(s: Session) {
    const e = entries.get(s.id);
    entries.delete(s.id);
    await e?.rolling.close();
  }
  store.onEnd(end);

  function create(s: Session, send: Entry['send']): Entry {
    const e: Entry = {
      send,
      gen: ++gens,
      silent: 0,
      runEnds: [],
      rolling: undefined as unknown as Entry['rolling'],
    };
    // the socket may be replaced after resume: always send through the latest one
    const out = (m: ServerMessage) => e.send(m);
    e.rolling = createRollingStt(opts.provider, {
      hints: opts.getHints?.(s) ?? [],
      rolloverMs: opts.rolloverMs ?? 270_000,
      overlapMs: opts.overlapMs ?? 2000,
      voiced,
      onPartial: (m) =>
        out({
          v: PROTOCOL_VERSION,
          t: 'transcript',
          final: false,
          ...m,
          segId: `${e.gen}-${m.segId}`,
        }),
      onFinal: (m) => {
        out({
          v: PROTOCOL_VERSION,
          t: 'transcript',
          final: true,
          ...m,
          segId: `${e.gen}-${m.segId}`,
        });
        // one final covers every speech run that ended before it (a sentence has many pauses)
        const from = e.runEnds.at(-1) ?? e.lastVoicedAt;
        e.runEnds.length = 0;
        const sttFinalMs = from === undefined ? undefined : Math.max(0, Math.round(now() - from));
        opts.onFinal?.(s, { text: m.text, speaker: m.speaker }, out, { sttFinalMs });
      },
      onError: (gaveUp) => {
        log('stt.error', {
          sessionId: s.id,
          code: 'STT_UNAVAILABLE',
          outcome: gaveUp ? 'gave-up' : 'retry',
        });
        out({ v: PROTOCOL_VERSION, t: 'error', code: 'STT_UNAVAILABLE' });
      },
      onRollover: () => log('stt.rollover', { sessionId: s.id }),
    });
    entries.set(s.id, e);
    return e;
  }

  return {
    end,
    /**
     * `pause`: close the provider stream (it would idle and be cut by the provider). The next frame
     * after `resume` opens a new one. Finals the flush produces still go out.
     */
    pause: end,
    /** One audio frame of a live session. Frames for an ended session are dropped. */
    push(s: Session, pcm: Int16Array, send: Entry['send']) {
      let e = entries.get(s.id);
      if (!e) {
        if (store.get(s.id) !== s) return; // onEnd already ran: a new stream would never be closed
        e = create(s, send);
      }
      e.send = send;
      if (voiced(pcm)) {
        e.lastVoicedAt = now();
        e.silent = 0;
      } else if (e.lastVoicedAt !== undefined && e.silent < RUN_END_FRAMES) {
        // ponytail: fixed 300 ms hangover, not a VAD
        if (++e.silent === RUN_END_FRAMES) {
          e.runEnds.push(e.lastVoicedAt);
          if (e.runEnds.length > 50) e.runEnds.shift();
        }
      }
      e.rolling.push(pcm);
    },
  };
}
