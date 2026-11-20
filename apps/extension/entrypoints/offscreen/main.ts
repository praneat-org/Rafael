import type { Browser } from 'wxt/browser';
import { CaptureFailed, extensionTabStream, startCapture } from '../../src/audio/capture';
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
import { SessionController } from '../../src/session-controller';

// This document outlives the side panel (and the service worker): it hosts the SessionController,
// which owns the session state and the Transport. State is memory only (D11).
const ports = new Set<Browser.runtime.Port>();

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

const controller = new SessionController({
  post: (m: OffscreenToPanel) => {
    for (const p of ports) p.postMessage(m);
  },
  serverUrl: SERVER_URL,
  dev: import.meta.env.DEV,
  getToken,
  async openCapture(opts, isCurrent, sinks) {
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
      const r: TabStreamIdReply | undefined = await browser.runtime.sendMessage(GET_TAB_STREAM_ID);
      if (!isCurrent()) throw new CaptureFailed('tab-capture');
      if (!r || 'error' in r) throw new CaptureFailed('tab-capture');
      streamId = r.id; // expires in seconds: used right away
    }
    return startCapture(
      opts,
      {
        workletUrl: browser.runtime.getURL('/pcm-worklet.js'),
        tabStream: () => extensionTabStream(streamId),
        monitorTab: true, // capturing mutes the tab: route it back
      },
      sinks,
    );
  },
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onMessage.addListener((cmd: PanelToOffscreen) => controller.command(cmd));
  port.onDisconnect.addListener(() => {
    ports.delete(port); // closing the panel does not stop a live session
    if (ports.size === 0) controller.command({ k: 'preview-stop' }); // but a preview must not keep the mic open
  });
  port.postMessage({ k: 'state', state: controller.state } satisfies OffscreenToPanel);
  port.postMessage(controller.audio.state);
});
