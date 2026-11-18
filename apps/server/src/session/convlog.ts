import { bangkokIso, type LogEvent } from '@rafael/protocol';
import type { Session } from './store.js';

type Stamp = 'sessionId' | 'seq' | 'ts' | 'offsetMs';
type Recordable = Exclude<LogEvent['type'], 'session.start' | 'session.end'>;
/** an event as recorded: no stamp yet (seq / ts / offset are derived when the log is read) */
export type LogBody = LogEvent extends infer E
  ? E extends LogEvent & { type: Recordable }
    ? Omit<E, Stamp>
    : never
  : never;
export type LogEntry = { at: number; body: LogBody };

/**
 * Append one event to the session's Conversation Log (memory only, emptied on end: D11).
 * `id` (segId / cueId) makes it idempotent: a replay after reconnect never adds a second copy.
 */
export function record(s: Session, body: LogBody, id?: string, at = Date.now()) {
  if (id !== undefined) {
    if (s.logIds.has(id)) return;
    s.logIds.add(id);
  }
  s.log.push({ at, body });
}

/** The whole log so far; `endedAt` adds the session.end event. */
export function snapshot(s: Session, endedAt?: number): LogEvent[] {
  const stamp = (seq: number, at: number) => ({
    sessionId: s.id,
    seq,
    ts: bangkokIso(at),
    offsetMs: Math.max(0, at - s.startedAt),
  });
  const out: LogEvent[] = [
    {
      ...stamp(0, s.startedAt),
      type: 'session.start',
      user: s.email,
      folderId: s.packId,
      folderName: s.folderName ?? '',
      pack: s.pack ?? null,
    },
    ...s.log.map((e, i) => ({ ...stamp(i + 1, e.at), ...e.body }) as LogEvent),
  ];
  if (endedAt !== undefined) out.push({ ...stamp(out.length, endedAt), type: 'session.end' });
  return out;
}
