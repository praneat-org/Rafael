import { type ClientMessage, parseServerMessage, type ServerMessage } from '@rafael/protocol';

export type TransportStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface Transport {
  connect(): void;
  send(msg: ClientMessage): void;
  /** Encoded binary frame (encodeAudioFrame from @rafael/protocol). */
  sendAudio(frame: Uint8Array): void;
  /** FE-48: rebuild the pack without these Drive file ids (WsTransport only). */
  rebuild?(exclude: string[]): Promise<void>;
  /** Returns an unsubscribe function. */
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  onStatus(cb: (status: TransportStatus) => void): () => void;
  close(): void;
}

/**
 * Every inbound server message goes through here (zod). Parse failure -> log the
 * error code only (never the payload, D11) and drop; never throws.
 */
export function dispatchRaw(raw: string, emit: (msg: ServerMessage) => void): void {
  const r = parseServerMessage(raw);
  if (r.ok) emit(r.data);
  else console.warn('[rafael] dropped server message:', r.error.code);
}
