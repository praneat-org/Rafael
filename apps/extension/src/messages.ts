import type { SessionState } from './session';

// side panel <-> offscreen document over a chrome.runtime port (SW is only the coordinator)
export const PORT_NAME = 'rafael-session';
export const ENSURE_OFFSCREEN = 'rafael:ensure-offscreen';

export type PanelToOffscreen =
  | {
      k: 'start';
      mock: boolean;
      latencyMs: number;
      /** dev only: base64 of a 16 kHz mono PCM16 .wav, held in memory only (D11) */
      wavBase64?: string;
    }
  | { k: 'end' }
  | { k: 'reset' };

export type OffscreenToPanel = { k: 'state'; state: SessionState };
