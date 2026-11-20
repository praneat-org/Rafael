import type { LogEvent, MeetingSummary } from '@rafael/protocol';
import { useCallback, useRef, useState } from 'react';
import type { AudioState } from '../../extension/src/audio/audio-state';
import type { OffscreenToPanel, PanelToOffscreen } from '../../extension/src/messages';
import { PendingRequests } from '../../extension/src/pending-requests';
import { initialState, type SessionState } from '../../extension/src/session';
import { SessionController } from '../../extension/src/session-controller';
import { openWebCapture } from './capture-web';
import { SERVER_URL } from './config';

/**
 * Same shape as the side panel's useSession, but the SessionController runs in this page
 * (the extension runs it in the offscreen document). Display state only; memory only (D11).
 */
export function useWebSession(getToken: (fresh: boolean) => Promise<string>) {
  const [state, setState] = useState<SessionState>(initialState);
  const [audio, setAudio] = useState<AudioState | null>(null);
  const pending = useRef(new PendingRequests());
  const ctl = useRef<SessionController | null>(null);
  ctl.current ??= new SessionController({
    post: (m: OffscreenToPanel) => {
      if (m.k === 'state') setState(m.state);
      else if (m.k === 'log' || m.k === 'summary') pending.current.settle(m);
      else setAudio(m); // level number only, never audio (D11)
    },
    serverUrl: SERVER_URL,
    dev: import.meta.env.DEV,
    getToken,
    openCapture: openWebCapture,
  });
  const c = ctl.current;

  const send = useCallback((cmd: PanelToOffscreen) => c.command(cmd), [c]);
  const request = useCallback(
    <T>(k: 'log' | 'summary', timeoutMs: number) =>
      pending.current.request<T>(timeoutMs, (id) => {
        c.command({ k, id });
        return true;
      }),
    [c],
  );
  /** Conversation Log (live: fetched from the server now). null after 5 s. */
  const getLog = useCallback(() => request<LogEvent[]>('log', 5000), [request]);
  /** same 150 s budget as the side panel: server worst case ~110 s */
  const getSummary = useCallback(() => request<MeetingSummary>('summary', 150_000), [request]);
  return { state, audio, send, getLog, getSummary };
}
