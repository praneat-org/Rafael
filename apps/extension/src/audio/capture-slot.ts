import type { CaptureHandle } from './capture';

/**
 * Owns "the" capture of the current session. Each begin() takes a generation token: a start that
 * resolves/fails after stop() or a newer begin() is stale, its streams are stopped and its result
 * (handle, error) is dropped. pause() before the capture is up is remembered and applied on arrival.
 */
export class CaptureSlot {
  private gen = 0;
  private handle: CaptureHandle | null = null;
  private paused = false;

  async begin(
    start: (isCurrent: () => boolean) => Promise<CaptureHandle>,
    onError: (e: unknown) => void,
  ): Promise<void> {
    this.stop();
    const g = this.gen;
    try {
      const h = await start(() => g === this.gen);
      if (g !== this.gen) return h.stop();
      this.handle = h;
      if (this.paused) h.pause();
    } catch (e) {
      if (g === this.gen) onError(e);
    }
  }

  pause() {
    this.paused = true;
    this.handle?.pause();
  }

  resume() {
    this.paused = false;
    this.handle?.resume();
  }

  stop() {
    this.gen++;
    this.handle?.stop();
    this.handle = null;
    this.paused = false;
  }
}
