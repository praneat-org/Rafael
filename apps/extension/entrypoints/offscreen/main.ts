import type { Browser } from 'wxt/browser';
import { type OffscreenToPanel, type PanelToOffscreen, PORT_NAME } from '../../src/messages';
import { parseWav, playMockAudio } from '../../src/mock-audio';
import { MockTransport } from '../../src/mock-transport';
import { type Action, initialState, reduce } from '../../src/session';
import type { Transport } from '../../src/transport';

// This document outlives the side panel (and the service worker): it owns the session
// state and the Transport. State is memory only (D11).
let state = initialState;
let transport: Transport | null = null;
let stopAudio: (() => void) | null = null;
const ports = new Set<Browser.runtime.Port>();

function dispatch(a: Action) {
  state = reduce(state, a);
  const msg: OffscreenToPanel = { k: 'state', state };
  for (const p of ports) p.postMessage(msg);
}

function teardown() {
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
  } else dispatch({ k: 'reset' });
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onMessage.addListener(onCommand);
  port.onDisconnect.addListener(() => ports.delete(port)); // closing the panel does not stop the session
  port.postMessage({ k: 'state', state } satisfies OffscreenToPanel);
});
