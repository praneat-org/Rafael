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
};
export type PackState = 'loading' | 'ready' | 'error';

export type SessionState = {
  phase: Phase;
  status: TransportStatus | 'idle';
  segments: Segment[];
  cues: Cue[];
  pack: PackState | null;
  error: ErrorCode | null;
  /** audio is not being sent (Pause) */
  paused: boolean;
};

export const initialState: SessionState = {
  phase: 'setup',
  status: 'idle',
  segments: [],
  cues: [],
  pack: null,
  error: null,
  paused: false,
};

export type Action =
  | { k: 'start' }
  | { k: 'end' }
  | { k: 'reset' }
  | { k: 'pause' }
  | { k: 'resume' }
  | { k: 'status'; status: TransportStatus }
  | { k: 'server'; msg: ServerMessage };

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
      // D11: drop transcript / cues when the session ends
      return { ...initialState, phase: 'end', status: 'closed' };
    case 'reset':
      return initialState;
    case 'pause':
    case 'resume':
      return s.phase === 'live' ? { ...s, paused: a.k === 'pause' } : s;
    case 'status':
      return s.phase === 'live' ? { ...s, status: a.status } : s;
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
