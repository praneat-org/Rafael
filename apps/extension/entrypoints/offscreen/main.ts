import { type LogEvent, MeetingSummary } from '@rafael/protocol';
import type { Browser } from 'wxt/browser';
import { AudioStatus } from '../../src/audio/audio-state';
import { CaptureFailed, startCapture } from '../../src/audio/capture';
import { CaptureSlot } from '../../src/audio/capture-slot';
import { rmsPcm16 } from '../../src/audio/pcm';
import { SERVER_URL } from '../../src/config';
import {
  type AuthTokenReply,
  GET_AUTH_TOKEN,
  GET_TAB_STREAM_ID,
  type OffscreenToPanel,
  OPEN_PERMISSION_PAGE,
  type PanelToOffscreen,
  PORT_NAME,
  type TabStreamIdReply,
} from '../../src/messages';
import { parseWav, playMockAudio, toFrames } from '../../src/mock-audio';
import { MockTransport } from '../../src/mock-transport';
import { applyPause } from '../../src/pause';
import { type Action, initialState, reduce } from '../../src/session';
import type { Transport } from '../../src/transport';
import { toWsUrl, WsTransport } from '../../src/ws-transport';

// This document outlives the side panel (and the service worker): it owns the session
// state and the Transport. State is memory only (D11).
let state = initialState;
// Conversation Log copy the server sent with session.end (the server deletes its own). Memory only (D11)
let finalLog: LogEvent[] | null = null;
let endTimer: ReturnType<typeof setTimeout> | undefined;
// server flushes STT first (gemini flush timeout 2 s) before it sends the last log copy: leave margin
const END_LOG_WAIT_MS = 6000;
let transport: Transport | null = null;
let stopAudio: (() => void) | null = null;
const capture = new CaptureSlot();
const ports = new Set<Browser.runtime.Port>();

function dispatch(a: Action) {
  state = reduce(state, a);
  const msg: OffscreenToPanel = { k: 'state', state };
  for (const p of ports) p.postMessage(msg);
}

const audio = new AudioStatus((a) => {
  for (const p of ports) p.postMessage(a);
});

type CaptureCmd = NonNullable<Extract<PanelToOffscreen, { k: 'start' }>['capture']>;

function beginCapture(opts: CaptureCmd, t: Transport | null) {
  audio.reset();
  // a start from an old session is stale: isCurrent() is false, nothing it does may reach the panel
  return capture.begin(
    async (isCurrent) => {
      if (opts.mic) {
        // offscreen cannot prompt: the first grant happens on the extension's permission page
        const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (!isCurrent()) throw new CaptureFailed('mic-permission');
        if (perm.state !== 'granted') {
          browser.runtime.sendMessage(OPEN_PERMISSION_PAGE);
          throw new CaptureFailed('mic-permission');
        }
      }
      let streamId: string | null = null;
      if (opts.tab) {
        const r: TabStreamIdReply | undefined =
          await browser.runtime.sendMessage(GET_TAB_STREAM_ID);
        if (!isCurrent()) throw new CaptureFailed('tab-capture');
        if (!r || 'error' in r) throw new CaptureFailed('tab-capture');
        streamId = r.id; // expires in seconds: used right away
      }
      return startCapture(
        opts,
        streamId,
        capture.guard((f) => t?.sendAudio(f)), // preview (no transport): level only, frames dropped
        capture.guard((level) => {
          if (isCurrent()) audio.patch({ level });
        }),
      );
    },
    // reason code only, never content (D11)
    (e) => audio.patch({ error: e instanceof CaptureFailed ? e.reason : 'tab-capture' }),
  );
}

function stopPreview() {
  if (state.phase === 'live') return;
  capture.stop();
  stopAudio?.();
  stopAudio = null;
  audio.reset();
}

function preview(cmd: Extract<PanelToOffscreen, { k: 'preview' }>) {
  if (state.phase === 'live') return;
  stopPreview();
  if (cmd.capture) void beginCapture(cmd.capture, null);
  if (import.meta.env.DEV && cmd.wavBase64) {
    const pcm = parseWav(Uint8Array.from(atob(cmd.wavBase64), (c) => c.charCodeAt(0)).buffer);
    if (!pcm) return;
    const frames = toFrames(pcm);
    let i = 0;
    const timer = setInterval(() => {
      const f = frames[i++ % frames.length];
      if (f) audio.patch({ level: rmsPcm16(f) });
    }, 100);
    stopAudio = () => clearInterval(timer);
  }
}

function post(m: OffscreenToPanel) {
  for (const p of ports) p.postMessage(m);
}

// meeting summary: the server reads the log we send and keeps nothing (D11)
async function summaryOf(events: LogEvent[] | null): Promise<MeetingSummary | null> {
  if (!events || state.phase !== 'end' || !SERVER_URL) return null;
  try {
    const body = JSON.stringify({ events });
    const call = async (fresh: boolean) =>
      fetch(`${SERVER_URL.replace(/\/+$/, '')}/api/summary`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await getToken(fresh)}`,
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

function teardown() {
  clearTimeout(endTimer);
  capture.stop();
  audio.reset(); // incl. error: an old session's failure must not leak into the next
  stopAudio?.();
  stopAudio = null;
  const t = transport;
  transport = null; // first: our own close must not reach onStatus as a "permanent close" (would wipe the End screen)
  t?.close();
}

// real token comes from the service worker (chrome.identity); never stored (D11).
// Dev build without a configured OAuth client keeps the fake token for the local dev server.
async function getToken(fresh: boolean): Promise<string> {
  const r: AuthTokenReply | undefined = await browser.runtime.sendMessage({
    k: GET_AUTH_TOKEN,
    fresh,
  });
  if (r?.token) return r.token;
  if (import.meta.env.DEV) return 'dev-fake-token';
  throw new Error('no token');
}

function start(cmd: Extract<PanelToOffscreen, { k: 'start' }>) {
  if (state.phase === 'live') return;
  const mock = import.meta.env.DEV && cmd.mock; // prod build: mock path is dead code, Vite drops it
  if (!mock && !cmd.packId && !import.meta.env.DEV) return;
  if (!mock && !SERVER_URL) return; // prod without an https server url: never send the token
  teardown();
  finalLog = null;
  dispatch({ k: 'start', attendees: cmd.attendees?.slice(0, 500) });
  const t: Transport = mock
    ? new MockTransport(cmd.latencyMs)
    : new WsTransport({ url: toWsUrl(SERVER_URL), getToken });
  transport = t;
  t.onStatus((status) => {
    if (transport !== t) return; // stale or closed by us
    dispatch({ k: 'status', status });
    if (status === 'closed') {
      // permanent close (4001, 4401, token failure...): stop capture too
      capture.stop();
      stopAudio?.();
      stopAudio = null;
    }
  });
  t.onMessage((msg) => {
    if (msg.t === 'log') {
      // a log.get answer carries its id, even one that lands after End was pressed;
      // only the copy sent with session.end (no id) is the final log
      if (msg.id !== undefined) return post({ k: 'log', id: msg.id, events: msg.events });
      if (state.phase !== 'end') return;
      finalLog = msg.events; // the copy sent with session.end: the session is gone after this
      const first = msg.events[0];
      const last = msg.events.at(-1);
      dispatch({
        k: 'end-log',
        ok: true,
        meta:
          first?.type === 'session.start' && last
            ? { folderName: first.folderName, startTs: first.ts, endTs: last.ts }
            : null,
      });
      return teardown();
    }
    dispatch({ k: 'server', msg, at: Date.now() });
    if (msg.t === 'error' && msg.code === 'SESSION_NOT_FOUND') teardown(); // session is gone: stop capture too
  });
  t.connect();
  if (mock) t.send({ v: 1, t: 'hello', accessToken: 'mock-token' }); // WsTransport sends hello itself
  t.send({ v: 1, t: 'session.start', packId: mock ? 'mock-pack' : (cmd.packId ?? 'dev-pack') });
  if (cmd.capture) void beginCapture(cmd.capture, t);
  if (import.meta.env.DEV && cmd.wavBase64) {
    const bin = atob(cmd.wavBase64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const pcm = parseWav(bytes.buffer);
    if (pcm) stopAudio = playMockAudio(pcm, t);
    else console.warn('[rafael] mock wav rejected: need 16 kHz mono PCM16');
  }
}

function onCommand(cmd: PanelToOffscreen) {
  if (cmd.k === 'start') start(cmd);
  else if (cmd.k === 'preview') preview(cmd);
  else if (cmd.k === 'preview-stop') stopPreview();
  else if (cmd.k === 'rebuild') {
    if (state.refreshing) return;
    dispatch({ k: 'refreshing', on: true });
    void Promise.resolve(transport?.rebuild?.(cmd.exclude)).finally(() =>
      dispatch({ k: 'refreshing', on: false }),
    );
  } else if (cmd.k === 'pause' || cmd.k === 'resume') {
    if (state.phase !== 'live') return;
    applyPause(cmd.k, {
      capture,
      audio,
      stopMockAudio: () => {
        stopAudio?.();
        stopAudio = null;
      },
      send: (t) => transport?.send({ v: 1, t }),
      dispatch: (k) => dispatch({ k }),
    });
  } else if (cmd.k === 'ask') {
    if (state.phase === 'live') transport?.send({ v: 1, t: 'ask', text: cmd.text.slice(0, 2000) });
  } else if (cmd.k === 'log') {
    if (state.phase === 'live') transport?.send({ v: 1, t: 'log.get', id: cmd.id });
    else post({ k: 'log', id: cmd.id, events: state.phase === 'end' ? finalLog : null });
  } else if (cmd.k === 'summary') {
    void summaryOf(finalLog).then((summary) => post({ k: 'summary', id: cmd.id, summary }));
  } else if (cmd.k === 'end') {
    if (state.phase !== 'live') return;
    // end first: the transport may close right away on session.end, and a `closed` while live resets to Setup
    dispatch({ k: 'end' });
    finalLog = null;
    capture.stop(); // no more audio; the socket stays open until the server's last log copy arrives
    stopAudio?.();
    stopAudio = null;
    transport?.send({ v: 1, t: 'session.end' });
    endTimer = setTimeout(() => {
      dispatch({ k: 'end-log', ok: false }); // never came (link down): End screen says so
      teardown();
    }, END_LOG_WAIT_MS);
  } else {
    if (state.phase === 'end') teardown(); // deleted before the last log copy came: stop waiting
    finalLog = null;
    dispatch({ k: 'reset' });
  }
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onMessage.addListener(onCommand);
  port.onDisconnect.addListener(() => {
    ports.delete(port); // closing the panel does not stop a live session
    if (ports.size === 0) stopPreview(); // but a preview must not keep the mic open
  });
  port.postMessage({ k: 'state', state } satisfies OffscreenToPanel);
  port.postMessage(audio.state);
});
