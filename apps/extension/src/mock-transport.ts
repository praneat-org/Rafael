import { type ClientMessage, exampleServerMessages, type ServerMessage } from '@rafael/protocol';
import { dispatchRaw, type Transport, type TransportStatus } from './transport';

type Cue = Extract<ServerMessage, { t: 'cue' }>;

/** Script played after `session.start`: transcript partial -> final -> cue partial -> final -> notFound cue. */
export function buildMockScript(): ServerMessage[] {
  const ex = exampleServerMessages;
  const ready = ex.find((m) => m.t === 'session.ready');
  const pack = ex.find((m) => m.t === 'pack.status');
  const seg = ex.find((m) => m.t === 'transcript');
  const cues = ex.filter((m): m is Cue => m.t === 'cue');
  const cue = cues.find((c) => !c.notFound);
  const notFoundCue = cues.find((c) => c.notFound);
  if (!ready || !pack || seg?.t !== 'transcript' || !cue || !notFoundCue) return [];
  return [
    ready,
    pack,
    { ...seg, text: seg.text.slice(0, 7), final: false },
    seg,
    { ...cue, partial: true, bullets: cue.bullets.map((b) => b.slice(0, 10)) },
    cue,
    notFoundCue,
  ];
}

/** Reply to `ask` in mock mode: a streaming cue (placeholder Thai text, not deal content). */
export function buildAskScript(question: string): ServerMessage[] {
  const cueId = `ask-${Math.random().toString(36).slice(2, 8)}`;
  const base = {
    v: 1 as const,
    t: 'cue' as const,
    cueId,
    question,
    sources: [{ file: 'example.pdf', fileId: 'file-1', locator: 'หน้า 3' }],
    latencyMs: 1800,
    notFound: false,
  };
  const bullets = [
    'ราคาเริ่มต้นต่อผู้ใช้ต่อเดือน ตามแพ็กเกจมาตรฐาน',
    'ติดตั้งและเริ่มใช้งานได้ภายในหนึ่งสัปดาห์',
    'รองรับการเชื่อมต่อกับระบบเดิมของลูกค้า',
  ];
  return [
    { ...base, partial: true, bullets: [bullets[0]?.slice(0, 18) ?? ''] },
    { ...base, partial: true, bullets: bullets.slice(0, 2) },
    { ...base, partial: false, bullets },
  ];
}

export class MockTransport implements Transport {
  private msgCbs = new Set<(m: ServerMessage) => void>();
  private statusCbs = new Set<(s: TransportStatus) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;
  private gotHello = false;

  /** latencyMs = simulated delay before each server message. */
  constructor(private latencyMs = 0) {}

  connect(): void {
    this.setStatus('connecting');
    this.later(() => this.setStatus('live'), this.latencyMs);
  }

  send(msg: ClientMessage): void {
    if (this.closed) return;
    // mirror the server contract (D19): hello first, otherwise UNAUTHORIZED + close
    if (!this.gotHello) {
      if (msg.t === 'hello') this.gotHello = true;
      else {
        this.emit({ v: 1, t: 'error', code: 'UNAUTHORIZED' });
        this.close();
      }
      return;
    }
    if (msg.t === 'session.start') {
      buildMockScript().forEach((m, i) => {
        this.later(() => this.emit(m), this.latencyMs * (i + 1));
      });
    } else if (msg.t === 'ask') {
      buildAskScript(msg.text).forEach((m, i) => {
        this.later(() => this.emit(m), this.latencyMs * (i + 1));
      });
    } else if (msg.t === 'session.end') {
      this.close();
    }
  }

  sendAudio(_frame: Uint8Array): void {
    // mock server ignores audio
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
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.setStatus('closed');
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // same zod path as a real socket
  private emit(m: ServerMessage) {
    dispatchRaw(JSON.stringify(m), (x) => {
      for (const cb of this.msgCbs) cb(x);
    });
  }

  private setStatus(s: TransportStatus) {
    for (const cb of this.statusCbs) cb(s);
  }
}
