import type { ErrorCode, ServerMessage, Source } from '@rafael/protocol';
import type { TransportStatus } from './transport';

// D11: this state lives in memory (offscreen document) only — never persisted.
export type Phase = 'setup' | 'live' | 'end';
export type Segment = { segId: string; text: string; final: boolean; speaker?: string };
export type Cue = {
  cueId: string;
  question: string;
  bullets: string[];
  sources: Source[];
  partial: boolean;
  notFound: boolean;
  latencyMs: number;
  /** epoch ms when the panel got it (client clock) */
  at: number;
};
/** End screen: a customer question the pack could not answer (D10). Memory only (D11). */
export type Unanswered = { at: number; question: string };
export type PackState = 'loading' | 'ready' | 'error';

export type SessionState = {
  phase: Phase;
  status: TransportStatus | 'idle';
  segments: Segment[];
  cues: Cue[];
  pack: PackState | null;
  error: ErrorCode | 'CONNECTION_CLOSED' | null; // CONNECTION_CLOSED is client-only (transport closed for good)
  /** audio is not being sent (Pause) */
  paused: boolean;
  /** filled on `end`, emptied by `reset` */
  unanswered: Unanswered[];
};

export const initialState: SessionState = {
  phase: 'setup',
  status: 'idle',
  segments: [],
  cues: [],
  pack: null,
  error: null,
  paused: false,
  unanswered: [],
};

export type Action =
  | { k: 'start' }
  | { k: 'end' }
  | { k: 'reset' }
  | { k: 'pause' }
  | { k: 'resume' }
  | { k: 'status'; status: TransportStatus }
  | { k: 'server'; msg: ServerMessage; at?: number };

/** Replace the item with the same id in place (partial -> final keeps its slot), else append. */
function upsert<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const i = list.findIndex(same);
  return i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
}

export function reduce(s: SessionState, a: Action): SessionState {
  switch (a.k) {
    case 'start':
      return { ...initialState, phase: 'live', status: 'connecting' };
    case 'end':
      // D11: drop transcript / cues when the session ends; keep only the unanswered questions
      // for the End screen until the user deletes the session (`reset`)
      return {
        ...initialState,
        phase: 'end',
        status: 'closed',
        unanswered: s.cues
          .filter((c) => c.notFound && !c.partial)
          .map((c) => ({ at: c.at, question: c.question })),
      };
    case 'reset':
      return initialState;
    case 'pause':
    case 'resume':
      return s.phase === 'live' ? { ...s, paused: a.k === 'pause' } : s;
    case 'status':
      if (s.phase !== 'live') return s;
      // permanent close (4001, 4401, token failure): leave live, back to setup with a readable reason
      if (a.status === 'closed') return { ...initialState, error: 'CONNECTION_CLOSED' };
      return { ...s, status: a.status };
    case 'server': {
      if (s.phase !== 'live') return s;
      const m = a.msg;
      switch (m.t) {
        case 'transcript': {
          const seg: Segment = { segId: m.segId, text: m.text, final: m.final, speaker: m.speaker };
          return { ...s, segments: upsert(s.segments, seg, (x) => x.segId === m.segId) };
        }
        case 'cue': {
          const cue: Cue = {
            cueId: m.cueId,
            question: m.question,
            bullets: m.bullets,
            sources: m.sources,
            partial: m.partial,
            notFound: m.notFound,
            latencyMs: m.latencyMs,
            at: a.at ?? 0,
          };
          return { ...s, cues: upsert(s.cues, cue, (x) => x.cueId === m.cueId) };
        }
        case 'pack.status':
          return { ...s, pack: m.state };
        case 'error':
          // resume failed (server restarted): the session is gone, back to Setup with the reason
          if (m.code === 'SESSION_NOT_FOUND') return { ...initialState, error: m.code };
          return { ...s, error: m.code };
        default:
          return s; // session.ready: resumeToken is kept by WsTransport (FE-35), not in UI state
      }
    }
  }
}
