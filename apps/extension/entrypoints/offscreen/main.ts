import type { Browser } from 'wxt/browser';
import { AudioStatus } from '../../src/audio/audio-state';
import { CaptureFailed, startCapture } from '../../src/audio/capture';
import { CaptureSlot } from '../../src/audio/capture-slot';
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

function beginCapture(opts: CaptureCmd, t: Transport) {
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
        capture.guard((f) => t.sendAudio(f)),
        capture.guard((level) => {
          if (isCurrent()) audio.patch({ level });
        }),
      );
    },
    // reason code only, never content (D11)
    (e) => audio.patch({ error: e instanceof CaptureFailed ? e.reason : 'tab-capture' }),
  );
}

function teardown() {
  capture.stop();
  audio.reset(); // incl. error: an old session's failure must not leak into the next
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
    capture.pause();
    audio.patch({ paused: true, level: 0 });
  } else if (cmd.k === 'resume') {
    capture.resume();
    audio.patch({ paused: false });
  } else dispatch({ k: 'reset' });
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onMessage.addListener(onCommand);
  port.onDisconnect.addListener(() => ports.delete(port)); // closing the panel does not stop the session
  port.postMessage({ k: 'state', state } satisfies OffscreenToPanel);
  port.postMessage(audio.state);
});
