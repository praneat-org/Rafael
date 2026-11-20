import type { LogEvent, MeetingSummary } from '@rafael/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Browser } from 'wxt/browser';
import type { AudioState } from '../../src/audio/audio-state';
import { type OffscreenToPanel, type PanelToOffscreen, PORT_NAME } from '../../src/messages';
import { requestOffscreen } from '../../src/offscreen-client';
import { PendingRequests } from '../../src/pending-requests';
import { postOrFail } from '../../src/post-or-fail';
import { initialState, type SessionState } from '../../src/session';

/** The only place the side panel talks to the offscreen document. Display-only state. */
export function useSession() {
  const [state, setState] = useState<SessionState>(initialState);
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [offline, setOffline] = useState(false);
  const port = useRef<Browser.runtime.Port | null>(null);
  const pending = useRef(new PendingRequests());

  useEffect(() => {
    let alive = true;
    requestOffscreen((m) => browser.runtime.sendMessage(m)).then((ok) => {
      if (!alive) return;
      if (!ok) return setOffline(true);
      const p = browser.runtime.connect({ name: PORT_NAME });
      p.onMessage.addListener((m: OffscreenToPanel) => {
        if (m.k === 'state') setState(m.state);
        // only the answer to the newest request: a late one may be an older snapshot
        else if (m.k === 'log' || m.k === 'summary') pending.current.settle(m);
        else setAudio(m); // level number only, never audio (D11)
      });
      p.onDisconnect.addListener(() => setOffline(true));
      port.current = p;
    });
    return () => {
      alive = false;
      port.current?.disconnect(); // offscreen keeps the session running
      port.current = null;
    };
  }, []);

  const send = useCallback((cmd: PanelToOffscreen) => port.current?.postMessage(cmd), []);
  const request = useCallback(
    <T>(k: 'log' | 'summary', timeoutMs: number) =>
      pending.current.request<T>(timeoutMs, (id) => {
        let sent = true;
        postOrFail(port.current, { k, id } satisfies PanelToOffscreen, () => {
          sent = false;
        });
        return sent;
      }),
    [],
  );
  /** Conversation Log from the offscreen document (live: fetched from the server now). null after 5 s. */
  const getLog = useCallback(() => request<LogEvent[]>('log', 5000), [request]);
  /** End: meeting summary of the last log copy. 1 h meeting target is 60 s; server worst case
   * ~110 s (55 s chunk calls + 55 s merge), so give up at 150 s, not before the server does. */
  const getSummary = useCallback(() => request<MeetingSummary>('summary', 150_000), [request]);
  return { state, audio, offline, send, getLog, getSummary };
}
