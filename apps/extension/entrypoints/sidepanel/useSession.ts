import type { LogEvent } from '@rafael/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Browser } from 'wxt/browser';
import type { AudioState } from '../../src/audio/audio-state';
import { type OffscreenToPanel, type PanelToOffscreen, PORT_NAME } from '../../src/messages';
import { requestOffscreen } from '../../src/offscreen-client';
import { initialState, type SessionState } from '../../src/session';

/** The only place the side panel talks to the offscreen document. Display-only state. */
export function useSession() {
  const [state, setState] = useState<SessionState>(initialState);
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [offline, setOffline] = useState(false);
  const port = useRef<Browser.runtime.Port | null>(null);
  const pendingLog = useRef<{ id: string; done: (e: LogEvent[] | null) => void } | null>(null);

  useEffect(() => {
    let alive = true;
    requestOffscreen((m) => browser.runtime.sendMessage(m)).then((ok) => {
      if (!alive) return;
      if (!ok) return setOffline(true);
      const p = browser.runtime.connect({ name: PORT_NAME });
      p.onMessage.addListener((m: OffscreenToPanel) => {
        if (m.k === 'state') setState(m.state);
        // only the answer to the newest request: a late one may be an older snapshot
        else if (m.k === 'log') {
          if (m.id === pendingLog.current?.id) pendingLog.current?.done(m.events);
        } else setAudio(m); // level number only, never audio (D11)
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
  /** Conversation Log from the offscreen document (live: fetched from the server now). null after 5 s. */
  const getLog = useCallback(
    () =>
      new Promise<LogEvent[] | null>((resolve) => {
        pendingLog.current?.done(null); // an older request loses
        const id = crypto.randomUUID();
        const done = (e: LogEvent[] | null) => {
          clearTimeout(timer);
          if (pendingLog.current?.id === id) pendingLog.current = null;
          resolve(e);
        };
        const timer = setTimeout(() => done(null), 5000);
        pendingLog.current = { id, done };
        if (port.current) port.current.postMessage({ k: 'log', id } satisfies PanelToOffscreen);
        else done(null);
      }),
    [],
  );
  return { state, audio, offline, send, getLog };
}
