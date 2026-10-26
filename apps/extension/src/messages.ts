import type { CaptureError, CaptureOpts } from './audio/capture';
import type { SessionState } from './session';

// side panel <-> offscreen document over a chrome.runtime port (SW is only the coordinator)
export const PORT_NAME = 'rafael-session';
export const ENSURE_OFFSCREEN = 'rafael:ensure-offscreen';
// offscreen -> service worker (offscreen only has chrome.runtime)
export const GET_TAB_STREAM_ID = 'rafael:tab-stream-id';
// offscreen -> service worker: access token from chrome.identity (offscreen has no identity API)
export const GET_AUTH_TOKEN = 'rafael:auth-token';
export type AuthTokenReq = { k: typeof GET_AUTH_TOKEN; fresh: boolean };
export type AuthTokenReply = { token: string | null };
export const OPEN_PERMISSION_PAGE = 'rafael:open-permission';
// service worker -> panel: the Meet tab was just invoked via the context menu (activeTab granted, FE-47)
export const TAB_GRANTED = 'rafael:tab-granted';
export type TabStreamIdReply = { id: string } | { error: true };

export type PanelToOffscreen =
  | {
      k: 'start';
      mock: boolean;
      /** Drive folder id = packId (D12); the server reads the files */
      packId?: string;
      latencyMs: number;
      /** dev only: base64 of a 16 kHz mono PCM16 .wav, held in memory only (D11) */
      wavBase64?: string;
      /** real audio capture (FE-36); omit for none */
      capture?: CaptureOpts;
    }
  | { k: 'pause' }
  | { k: 'resume' }
  | { k: 'end' }
  | { k: 'pause' }
  | { k: 'resume' }
  | { k: 'ask'; text: string }
  /** Setup only: open the inputs to show a level meter before Start; nothing is sent or stored (FE-44, D11) */
  | { k: 'preview'; capture?: CaptureOpts; wavBase64?: string }
  | { k: 'preview-stop' }
  | { k: 'reset' };

export type OffscreenToPanel =
  | { k: 'state'; state: SessionState }
  /** audio level (RMS 0..1, ~10/s while capturing) + capture status; memory only (D11) */
  | { k: 'audio'; level: number; paused: boolean; error: CaptureError | null };
