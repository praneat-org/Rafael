import { useCallback, useEffect, useRef, useState } from 'react';
import type { Browser } from 'wxt/browser';
import { type OffscreenToPanel, type PanelToOffscreen, PORT_NAME } from '../../src/messages';
import { requestOffscreen } from '../../src/offscreen-client';
import { initialState, type SessionState } from '../../src/session';

/** The only place the side panel talks to the offscreen document. Display-only state. */
export function useSession() {
  const [state, setState] = useState<SessionState>(initialState);
  const [offline, setOffline] = useState(false);
  const port = useRef<Browser.runtime.Port | null>(null);

  useEffect(() => {
    let alive = true;
    requestOffscreen((m) => browser.runtime.sendMessage(m)).then((ok) => {
      if (!alive) return;
      if (!ok) return setOffline(true);
      const p = browser.runtime.connect({ name: PORT_NAME });
      p.onMessage.addListener((m: OffscreenToPanel) => m.k === 'state' && setState(m.state));
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
  return { state, offline, send };
}
