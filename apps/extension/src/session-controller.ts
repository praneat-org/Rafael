import { type LogEvent, MeetingSummary } from '@rafael/protocol';
import { AudioStatus } from './audio/audio-state';
import {
  CaptureFailed,
  type CaptureHandle,
  type CaptureOpts,
  type CaptureSinks,
} from './audio/capture';
import { CaptureSlot } from './audio/capture-slot';
import { rmsPcm16 } from './audio/pcm';
import type { OffscreenToPanel, PanelToOffscreen } from './messages';
import { parseWav, playMockAudio, toFrames } from './mock-audio';
import { MockTransport } from './mock-transport';
import { applyPause } from './pause';
import { type Action, initialState, reduce } from './session';
import type { Transport } from './transport';
import { toWsUrl, WsTransport } from './ws-transport';

export type ControllerDeps = {
  /** state / audio / log / summary updates for whoever shows them (extension port, web React hook) */
  post(m: OffscreenToPanel): void;
  /** '' = not usable: no token is sent */
  serverUrl: string;
  /** dev build: mock transport, wav playback, fake token */
  dev: boolean;
  /** never persisted (D11) */
  getToken(fresh: boolean): Promise<string>;
  /**
   * Open the inputs. Throw CaptureFailed(reason); `isCurrent()` turns false when this start is stale.
   * Extension: mic permission + tabCapture id. Web: getDisplayMedia + getUserMedia.
   */
  openCapture(
    opts: CaptureOpts,
    isCurrent: () => boolean,
    sinks: CaptureSinks,
  ): Promise<CaptureHandle>;
};

// server flushes STT first (gemini flush timeout 2 s) before it sends the last log copy: leave margin
const END_LOG_WAIT_MS = 6000;

type StartCmd = Extract<PanelToOffscreen, { k: 'start' }>;

/**
 * Owns the session state and the Transport. Chrome-free: the extension's offscreen document and the
 * web app both host it, so the session logic exists once. State is memory only (D11).
 */
export class SessionController {
  state = initialState;
  // Conversation Log copy the server sent with session.end (the server deletes its own). Memory only (D11)
  private finalLog: LogEvent[] | null = null;
  private endTimer: ReturnType<typeof setTimeout> | undefined;
  private transport: Transport | null = null;
  private stopAudio: (() => void) | null = null;
  private capture = new CaptureSlot();
  readonly audio: AudioStatus;

  constructor(private d: ControllerDeps) {
    this.audio = new AudioStatus((a) => d.post(a));
  }

  private dispatch(a: Action) {
    this.state = reduce(this.state, a);
    this.d.post({ k: 'state', state: this.state });
  }

  private beginCapture(opts: CaptureOpts, t: Transport | null) {
    this.audio.reset();
    // a start from an old session is stale: isCurrent() is false, nothing it does may reach the panel
    return this.capture.begin(
      (isCurrent) =>
        this.d.openCapture(opts, isCurrent, {
          sendAudio: this.capture.guard((f) => t?.sendAudio(f)), // preview (no transport): level only, frames dropped
          onLevel: this.capture.guard((level) => {
            if (isCurrent()) this.audio.patch({ level });
          }),
          onLost: (reason) => {
            if (isCurrent()) this.audio.patch({ error: reason, level: 0 });
          },
        }),
      // reason code only, never content (D11)
      (e) => this.audio.patch({ error: e instanceof CaptureFailed ? e.reason : 'tab-capture' }),
    );
  }

  private stopPreview() {
    if (this.state.phase === 'live') return;
    this.capture.stop();
    this.stopAudio?.();
    this.stopAudio = null;
    this.audio.reset();
  }

  private preview(cmd: Extract<PanelToOffscreen, { k: 'preview' }>) {
    if (this.state.phase === 'live') return;
    this.stopPreview();
    if (cmd.capture) void this.beginCapture(cmd.capture, null);
    if (this.d.dev && cmd.wavBase64) {
      const pcm = parseWav(Uint8Array.from(atob(cmd.wavBase64), (c) => c.charCodeAt(0)).buffer);
      if (!pcm) return;
      const frames = toFrames(pcm);
      let i = 0;
      const timer = setInterval(() => {
        const f = frames[i++ % frames.length];
        if (f) this.audio.patch({ level: rmsPcm16(f) });
      }, 100);
      this.stopAudio = () => clearInterval(timer);
    }
  }

  // meeting summary: the server reads the log we send and keeps nothing (D11)
  private async summaryOf(events: LogEvent[] | null): Promise<MeetingSummary | null> {
    const { serverUrl } = this.d;
    if (!events || this.state.phase !== 'end' || !serverUrl) return null;
    try {
      const body = JSON.stringify({ events });
      const call = async (fresh: boolean) =>
        fetch(`${serverUrl.replace(/\/+$/, '')}/api/summary`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await this.d.getToken(fresh)}`,
            'content-type': 'application/json',
          },
          body,
        });
      let res = await call(false);
      if (res.status === 401) res = await call(true); // expired token: a new one, once
      if (!res.ok) return null; // code only, never the body (D11)
      const r = MeetingSummary.safeParse(((await res.json()) as { summary?: unknown }).summary);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }

  private teardown() {
    clearTimeout(this.endTimer);
    this.capture.stop();
    this.audio.reset(); // incl. error: an old session's failure must not leak into the next
    this.stopAudio?.();
    this.stopAudio = null;
    const t = this.transport;
    this.transport = null; // first: our own close must not reach onStatus as a "permanent close" (would wipe the End screen)
    t?.close();
  }

  private start(cmd: StartCmd) {
    const { serverUrl, dev } = this.d;
    if (this.state.phase === 'live') return;
    const mock = dev && cmd.mock; // prod build: mock path is dead code, Vite drops it
    if (!mock && !cmd.packId && !dev) return;
    if (!mock && !serverUrl) return; // prod without an https server url: never send the token
    this.teardown();
    this.finalLog = null;
    this.dispatch({ k: 'start', attendees: cmd.attendees?.slice(0, 500) });
    const t: Transport = mock
      ? new MockTransport(cmd.latencyMs)
      : new WsTransport({ url: toWsUrl(serverUrl), getToken: this.d.getToken });
    this.transport = t;
    t.onStatus((status) => {
      if (this.transport !== t) return; // stale or closed by us
      this.dispatch({ k: 'status', status });
      if (status === 'closed') {
        // permanent close (4001, 4401, token failure...): stop capture too
        this.capture.stop();
        this.stopAudio?.();
        this.stopAudio = null;
      }
    });
    t.onMessage((msg) => {
      if (msg.t === 'log') {
        // a log.get answer carries its id, even one that lands after End was pressed;
        // only the copy sent with session.end (no id) is the final log
        if (msg.id !== undefined) return this.d.post({ k: 'log', id: msg.id, events: msg.events });
        if (this.state.phase !== 'end') return;
        this.finalLog = msg.events; // the copy sent with session.end: the session is gone after this
        const first = msg.events[0];
        const last = msg.events.at(-1);
        this.dispatch({
          k: 'end-log',
          ok: true,
          meta:
            first?.type === 'session.start' && last
              ? { folderName: first.folderName, startTs: first.ts, endTs: last.ts }
              : null,
        });
        return this.teardown();
      }
      this.dispatch({ k: 'server', msg, at: Date.now() });
      if (msg.t === 'error' && msg.code === 'SESSION_NOT_FOUND') this.teardown(); // session is gone: stop capture too
    });
    t.connect();
    if (mock) t.send({ v: 1, t: 'hello', accessToken: 'mock-token' }); // WsTransport sends hello itself
    t.send({ v: 1, t: 'session.start', packId: mock ? 'mock-pack' : (cmd.packId ?? 'dev-pack') });
    if (cmd.capture) void this.beginCapture(cmd.capture, t);
    if (dev && cmd.wavBase64) {
      const bytes = Uint8Array.from(atob(cmd.wavBase64), (c) => c.charCodeAt(0));
      const pcm = parseWav(bytes.buffer);
      if (pcm) this.stopAudio = playMockAudio(pcm, t);
      else console.warn('[rafael] mock wav rejected: need 16 kHz mono PCM16');
    }
  }

  /** One entry point for every command from the UI. */
  command(cmd: PanelToOffscreen) {
    const { state } = this;
    if (cmd.k === 'start') this.start(cmd);
    else if (cmd.k === 'preview') this.preview(cmd);
    else if (cmd.k === 'preview-stop') this.stopPreview();
    else if (cmd.k === 'rebuild') {
      if (state.refreshing) return;
      this.dispatch({ k: 'refreshing', on: true });
      void Promise.resolve(this.transport?.rebuild?.(cmd.exclude)).finally(() =>
        this.dispatch({ k: 'refreshing', on: false }),
      );
    } else if (cmd.k === 'pause' || cmd.k === 'resume') {
      if (state.phase !== 'live') return;
      applyPause(cmd.k, {
        capture: this.capture,
        audio: this.audio,
        stopMockAudio: () => {
          this.stopAudio?.();
          this.stopAudio = null;
        },
        send: (t) => this.transport?.send({ v: 1, t }),
        dispatch: (k) => this.dispatch({ k }),
      });
    } else if (cmd.k === 'ask') {
      if (state.phase === 'live')
        this.transport?.send({ v: 1, t: 'ask', text: cmd.text.slice(0, 2000) });
    } else if (cmd.k === 'log') {
      if (state.phase === 'live') this.transport?.send({ v: 1, t: 'log.get', id: cmd.id });
      else
        this.d.post({
          k: 'log',
          id: cmd.id,
          events: state.phase === 'end' ? this.finalLog : null,
        });
    } else if (cmd.k === 'summary') {
      void this.summaryOf(this.finalLog).then((summary) =>
        this.d.post({ k: 'summary', id: cmd.id, summary }),
      );
    } else if (cmd.k === 'end') {
      if (state.phase !== 'live') return;
      // end first: the transport may close right away on session.end, and a `closed` while live resets to Setup
      this.dispatch({ k: 'end' });
      this.finalLog = null;
      this.capture.stop(); // no more audio; the socket stays open until the server's last log copy arrives
      this.stopAudio?.();
      this.stopAudio = null;
      this.transport?.send({ v: 1, t: 'session.end' });
      this.endTimer = setTimeout(() => {
        this.dispatch({ k: 'end-log', ok: false }); // never came (link down): End screen says so
        this.teardown();
      }, END_LOG_WAIT_MS);
    } else {
      if (state.phase === 'end') this.teardown(); // deleted before the last log copy came: stop waiting
      this.finalLog = null;
      this.dispatch({ k: 'reset' });
    }
  }
}
