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
  /** every final segment, for the Brain (BE-99) */
  onFinal?: (
    s: Session,
    seg: { text: string; speaker?: string },
    send: (m: ServerMessage) => void,
  ) => void;
};

type Entry = { rolling: ReturnType<typeof createRollingStt>; send: (m: ServerMessage) => void };

/** One rolling STT stream per session. Disposed with the session (store.onEnd), D11. */
export function createSttService(opts: SttOptions, store: Pick<SessionStore, 'onEnd' | 'get'>) {
  const entries = new Map<string, Entry>();

  store.onEnd(async (s) => {
    const e = entries.get(s.id);
    entries.delete(s.id);
    await e?.rolling.close();
  });

  function create(s: Session, send: Entry['send']): Entry {
    const e: Entry = { send, rolling: undefined as unknown as Entry['rolling'] };
    // the socket may be replaced after resume: always send through the latest one
    const out = (m: ServerMessage) => e.send(m);
    e.rolling = createRollingStt(opts.provider, {
      hints: opts.getHints?.(s) ?? [],
      rolloverMs: opts.rolloverMs ?? 270_000,
      overlapMs: opts.overlapMs ?? 2000,
      onPartial: (m) => out({ v: PROTOCOL_VERSION, t: 'transcript', final: false, ...m }),
      onFinal: (m) => {
        out({ v: PROTOCOL_VERSION, t: 'transcript', final: true, ...m });
        opts.onFinal?.(s, { text: m.text, speaker: m.speaker }, out);
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
    /** One audio frame of a live session. Frames for an ended session are dropped. */
    push(s: Session, pcm: Int16Array, send: Entry['send']) {
      let e = entries.get(s.id);
      if (!e) {
        if (store.get(s.id) !== s) return; // onEnd already ran: a new stream would never be closed
        e = create(s, send);
      }
      e.send = send;
      e.rolling.push(pcm);
    },
  };
}
