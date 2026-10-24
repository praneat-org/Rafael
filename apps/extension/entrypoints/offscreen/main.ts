import type { Browser } from 'wxt/browser';
import { SERVER_URL } from '../../src/config';
import { type OffscreenToPanel, type PanelToOffscreen, PORT_NAME } from '../../src/messages';
import { parseWav, playMockAudio } from '../../src/mock-audio';
import { MockTransport } from '../../src/mock-transport';
import { type Action, initialState, reduce } from '../../src/session';
import type { Transport } from '../../src/transport';
import { toWsUrl, WsTransport } from '../../src/ws-transport';

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
  if (state.phase === 'live') return;
  // ponytail: no token source until FE-39 (chrome.identity): real mode is dev-only against DEV_FAKE_AUTH
  if (!cmd.mock && !import.meta.env.DEV) return;
  teardown();
  dispatch({ k: 'start' });
  const t: Transport = cmd.mock
    ? new MockTransport(cmd.latencyMs)
    : new WsTransport({ url: toWsUrl(SERVER_URL), getToken: async () => 'dev-fake-token' });
  transport = t;
  t.onStatus((status) => dispatch({ k: 'status', status }));
  t.onMessage((msg) => dispatch({ k: 'server', msg }));
  t.connect();
  if (cmd.mock) t.send({ v: 1, t: 'hello', accessToken: 'mock-token' }); // WsTransport sends hello itself
  t.send({ v: 1, t: 'session.start', packId: cmd.mock ? 'mock-pack' : 'dev-pack' });
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
