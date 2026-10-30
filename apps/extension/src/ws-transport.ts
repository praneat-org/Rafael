import type { ClientMessage, ServerMessage } from '@rafael/protocol';
import { dispatchRaw, type Transport, type TransportStatus } from './transport';

/** The slice of the browser WebSocket we use (also satisfied by the `ws` package in tests). */
export interface WsLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type WsTransportOptions = {
  url: string;
  /** chrome.identity (FE-39) plugs in here. fresh=true -> drop the cached token first. Never persist the result (D11). */
  getToken: (fresh: boolean) => Promise<string>;
  createSocket?: (url: string) => WsLike;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** audio kept while disconnected; oldest dropped beyond this */
  maxBufferMs?: number;
};

const OPEN = 1;
const FRAME_MS = 100;
const MAX_WS_BACKLOG = 256 * 1024; // bytes queued in the socket before we start dropping frames
const CLOSE_NORMAL = 1000;
const CLOSE_REPLACED = 4001; // a newer socket took the session: do not fight it
const CLOSE_UNAUTHORIZED = 4401;

/** http(s)://host[/] -> ws(s)://host/ws */
export function toWsUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws`;
}

/**
 * Real /ws client. Order on every connection (D19): hello -> session.start (+resumeToken
 * after a drop) -> session.ready -> audio. The resumeToken lives in this object only (D11).
 */
export class WsTransport implements Transport {
  private msgCbs = new Set<(m: ServerMessage) => void>();
  private statusCbs = new Set<(s: TransportStatus) => void>();
  private ws: WsLike | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private packId: string | undefined;
  private resumeToken: string | undefined;
  private sessionId: string | undefined;
  /** Drive file ids left out of the pack. Memory only (D11); the server does not keep it, so every start/refresh resends it. */
  private exclude: string[] = [];
  private helloSent = false;
  private ready = false;
  private everLive = false;
  private closed = false;
  private attempt = 0;
  private triedFreshToken = false;
  private buffer: Uint8Array[] = [];

  constructor(private o: WsTransportOptions) {}

  connect(): void {
    if (this.closed || this.ws) return;
    this.setStatus(this.everLive ? 'reconnecting' : 'connecting');
    const ws = (this.o.createSocket ?? ((u) => new WebSocket(u) as unknown as WsLike))(this.o.url);
    this.ws = ws;
    this.helloSent = false;
    ws.onopen = () => void this.handshake(ws);
    ws.onmessage = (ev) => {
      if (ws === this.ws && typeof ev.data === 'string') this.onText(ev.data);
    };
    ws.onerror = () => {}; // always followed by onclose
    ws.onclose = (ev) => {
      if (ws === this.ws) this.onClose(ev.code);
    };
  }

  private async handshake(ws: WsLike) {
    try {
      const accessToken = await this.o.getToken(this.triedFreshToken);
      if (ws !== this.ws || ws.readyState !== OPEN) return;
      ws.send(JSON.stringify({ v: 1, t: 'hello', accessToken }));
      this.helloSent = true;
      if (this.packId) this.sendStart(ws);
    } catch {
      if (ws !== this.ws) return;
      this.emit({ v: 1, t: 'error', code: 'UNAUTHORIZED' });
      this.close();
    }
  }

  private sendStart(ws: WsLike) {
    if (!this.packId) return;
    const m: ClientMessage = { v: 1, t: 'session.start', packId: this.packId };
    if (this.resumeToken) m.resumeToken = this.resumeToken;
    if (this.exclude.length) m.exclude = this.exclude;
    ws.send(JSON.stringify(m));
  }

  private onText(raw: string) {
    dispatchRaw(raw, (m) => {
      if (m.t === 'session.ready') {
        this.resumeToken = m.resumeToken;
        this.sessionId = m.sessionId;
        this.ready = true;
        this.everLive = true;
        this.attempt = 0;
        this.triedFreshToken = false;
        this.setStatus('live');
        this.flush();
      } else if (m.t === 'error' && m.code === 'SESSION_NOT_FOUND') {
        this.resumeToken = undefined; // session is gone: the panel must start over
        this.emit(m);
        return void this.close();
      }
      this.emit(m);
    });
  }

  private onClose(code: number) {
    this.ws = null;
    this.ready = false;
    if (this.closed) return;
    if (code === CLOSE_UNAUTHORIZED && !this.triedFreshToken) {
      this.triedFreshToken = true; // token may have expired: ask for a fresh one, once
      return this.connect();
    }
    // no retry: normal end, replaced by a newer socket, or auth rejected twice
    if (code === CLOSE_NORMAL || code === CLOSE_REPLACED || code === CLOSE_UNAUTHORIZED) {
      return this.close();
    }
    // 1012 restart, 4408 hello timeout, 1006 abnormal, ...: back off and resume
    const min = this.o.minBackoffMs ?? 500;
    const delay = Math.min(this.o.maxBackoffMs ?? 8000, min * 2 ** this.attempt++);
    this.setStatus('reconnecting');
    this.timer = setTimeout(() => this.connect(), delay);
  }

  send(msg: ClientMessage): void {
    if (this.closed) return;
    if (msg.t === 'hello') return; // the transport owns the handshake (token comes from getToken)
    if (msg.t === 'session.start') {
      this.packId = msg.packId;
      this.resumeToken = msg.resumeToken ?? this.resumeToken;
      if (msg.exclude) this.exclude = msg.exclude;
      if (this.ws?.readyState === OPEN && this.helloSent && !this.ready) this.sendStart(this.ws);
      return;
    }
    if (this.ws?.readyState === OPEN && this.ready) this.ws.send(JSON.stringify(msg));
  }

  /**
   * FE-48: rebuild the pack without more files. `more` (file ids) is added to what was already excluded
   * (the too-large list no longer shows earlier exclusions) and the whole set is sent, since the server keeps none.
   * 413 -> PACK_TOO_LARGE again with the new list; ready arrives as pack.status over the socket.
   */
  async rebuild(more: string[]): Promise<void> {
    if (this.closed || !this.sessionId) return;
    this.exclude = [...new Set([...this.exclude, ...more])].slice(0, 200); // PackExclude max
    try {
      const token = await this.o.getToken(false);
      const base = this.o.url.replace(/^ws/, 'http').replace(/\/ws$/, '');
      const res = await fetch(`${base}/api/pack/${encodeURIComponent(this.sessionId)}/refresh`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ exclude: this.exclude }),
      });
      if (res.status === 413) {
        const b = (await res.json()) as { files?: unknown };
        dispatchRaw(
          JSON.stringify({ v: 1, t: 'error', code: 'PACK_TOO_LARGE', files: b.files }),
          (m) => this.emit(m),
        );
      } else if (!res.ok) console.warn('[rafael] pack refresh failed:', res.status); // 409 superseded / 502: no content logged
    } catch {
      console.warn('[rafael] pack refresh failed');
    }
  }

  sendAudio(frame: Uint8Array): void {
    if (this.closed) return;
    if (this.ws?.readyState === OPEN && this.ready) {
      if (this.ws.bufferedAmount < MAX_WS_BACKLOG) this.ws.send(frame); // else drop: stay real time
      return;
    }
    this.buffer.push(frame);
    const max = Math.ceil((this.o.maxBufferMs ?? 3000) / FRAME_MS);
    if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max);
  }

  private flush() {
    const ws = this.ws;
    for (const f of this.buffer.splice(0)) ws?.send(f);
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  onStatus(cb: (s: TransportStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.buffer = [];
    this.resumeToken = undefined;
    const ws = this.ws;
    this.ws = null;
    ws?.close(CLOSE_NORMAL);
    this.setStatus('closed');
  }

  private emit(m: ServerMessage) {
    for (const cb of this.msgCbs) cb(m);
  }

  private status: TransportStatus | undefined;

  private setStatus(s: TransportStatus) {
    if (s === this.status) return;
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }
}
