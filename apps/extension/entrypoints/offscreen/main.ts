import type { Browser } from 'wxt/browser';
import { CaptureFailed, type CaptureHandle, startCapture } from '../../src/audio/capture';
import {
  GET_TAB_STREAM_ID,
  type OffscreenToPanel,
  OPEN_PERMISSION_PAGE,
  type PanelToOffscreen,
  PORT_NAME,
  type TabStreamIdReply,
} from '../../src/messages';
import { parseWav, playMockAudio } from '../../src/mock-audio';
import { MockTransport } from '../../src/mock-transport';
import { type Action, initialState, reduce } from '../../src/session';
import type { Transport } from '../../src/transport';

// This document outlives the side panel (and the service worker): it owns the session
// state and the Transport. State is memory only (D11).
let state = initialState;
let transport: Transport | null = null;
let stopAudio: (() => void) | null = null;
let capture: CaptureHandle | null = null;
let audio: Extract<OffscreenToPanel, { k: 'audio' }> = {
  k: 'audio',
  level: 0,
  paused: false,
  error: null,
};
const ports = new Set<Browser.runtime.Port>();

function dispatch(a: Action) {
  state = reduce(state, a);
  const msg: OffscreenToPanel = { k: 'state', state };
  for (const p of ports) p.postMessage(msg);
}

function postAudio(patch: Partial<typeof audio>) {
  audio = { ...audio, ...patch };
  for (const p of ports) p.postMessage(audio);
}

type CaptureCmd = NonNullable<Extract<PanelToOffscreen, { k: 'start' }>['capture']>;

async function beginCapture(opts: CaptureCmd, t: Transport) {
  postAudio({ level: 0, paused: false, error: null });
  try {
    if (opts.mic) {
      // offscreen cannot prompt: the first grant happens on the extension's permission page
      const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (perm.state !== 'granted') {
        browser.runtime.sendMessage(OPEN_PERMISSION_PAGE);
        throw new CaptureFailed('mic-permission');
      }
    }
    let streamId: string | null = null;
    if (opts.tab) {
      const r: TabStreamIdReply | undefined = await browser.runtime.sendMessage(GET_TAB_STREAM_ID);
      if (!r || 'error' in r) throw new CaptureFailed('tab-capture');
      streamId = r.id; // expires in seconds: used right away
    }
    const h = await startCapture(
      opts,
      streamId,
      (f) => t.sendAudio(f),
      (level) => postAudio({ level }),
    );
    if (transport !== t) return h.stop(); // session ended while we were starting
    capture = h;
  } catch (e) {
    // reason code only, never content (D11)
    postAudio({ error: e instanceof CaptureFailed ? e.reason : 'tab-capture' });
  }
}

function teardown() {
  capture?.stop();
  capture = null;
  postAudio({ level: 0, paused: false });
  stopAudio?.();
  stopAudio = null;
  transport?.close();
  transport = null;
}

function start(cmd: Extract<PanelToOffscreen, { k: 'start' }>) {
  // ponytail: only the mock transport exists until FE-35 (WsTransport)
  if (!cmd.mock || state.phase === 'live') return;
  teardown();
  dispatch({ k: 'start' });
  const t = new MockTransport(cmd.latencyMs);
  transport = t;
  t.onStatus((status) => dispatch({ k: 'status', status }));
  t.onMessage((msg) => dispatch({ k: 'server', msg }));
  t.connect();
  t.send({ v: 1, t: 'hello', accessToken: 'mock-token' }); // D19: hello is always first
  t.send({ v: 1, t: 'session.start', packId: 'mock-pack' });
  if (cmd.capture) void beginCapture(cmd.capture, t);
  if (cmd.wavBase64) {
    const bin = atob(cmd.wavBase64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const pcm = parseWav(bytes.buffer);
    if (pcm) stopAudio = playMockAudio(pcm, t);
    else console.warn('[rafael] mock wav rejected: need 16 kHz mono PCM16');
  }
}

function onCommand(cmd: PanelToOffscreen) {
  if (cmd.k === 'start') start(cmd);
  else if (cmd.k === 'end') {
    transport?.send({ v: 1, t: 'session.end' });
    teardown();
    dispatch({ k: 'end' });
  } else if (cmd.k === 'pause') {
    capture?.pause();
    postAudio({ paused: true, level: 0 });
  } else if (cmd.k === 'resume') {
    capture?.resume();
    postAudio({ paused: false });
  } else dispatch({ k: 'reset' });
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onMessage.addListener(onCommand);
  port.onDisconnect.addListener(() => ports.delete(port)); // closing the panel does not stop the session
  port.postMessage({ k: 'state', state } satisfies OffscreenToPanel);
  port.postMessage(audio);
});
