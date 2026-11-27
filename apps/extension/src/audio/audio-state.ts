import type { OffscreenToPanel } from '../messages';

export type AudioState = Extract<OffscreenToPanel, { k: 'audio' }>;

const idle: AudioState = { k: 'audio', level: 0, paused: false, error: null };

/** Audio status shown in the panel. reset() is the one place that wipes a finished session (error included). */
export class AudioStatus {
  state: AudioState = idle;

  constructor(private emit: (s: AudioState) => void) {}

  patch(p: Partial<AudioState>) {
    this.state = { ...this.state, ...p };
    this.emit(this.state);
  }

  reset() {
    this.state = idle;
    this.emit(this.state);
  }
}
