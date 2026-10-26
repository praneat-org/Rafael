/**
 * The single pause/resume path. Order matters: audio stops first (capture + mock), then the
 * panel's audio badge, then the server is told, then session state flips.
 * ponytail: mock audio is not restarted on resume (dev only).
 */
export type PauseDeps = {
  capture: { pause(): void; resume(): void };
  audio: { patch(p: { paused: boolean; level?: number }): void };
  stopMockAudio(): void;
  send(t: 'pause' | 'resume'): void;
  dispatch(k: 'pause' | 'resume'): void;
};

export function applyPause(k: 'pause' | 'resume', d: PauseDeps) {
  if (k === 'pause') {
    d.stopMockAudio();
    d.capture.pause();
    d.audio.patch({ paused: true, level: 0 });
  } else {
    d.capture.resume();
    d.audio.patch({ paused: false });
  }
  d.send(k);
  d.dispatch(k);
}
