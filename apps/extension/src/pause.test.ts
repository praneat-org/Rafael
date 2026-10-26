import { describe, expect, it, vi } from 'vitest';
import { applyPause } from './pause';

function deps() {
  const calls: string[] = [];
  return {
    calls,
    d: {
      capture: {
        pause: vi.fn(() => calls.push('capture.pause')),
        resume: vi.fn(() => calls.push('capture.resume')),
      },
      audio: { patch: vi.fn() },
      stopMockAudio: vi.fn(() => calls.push('mock.stop')),
      send: vi.fn((t: string) => calls.push(`send.${t}`)),
      dispatch: vi.fn((k: string) => calls.push(`dispatch.${k}`)),
    },
  };
}

describe('applyPause', () => {
  it('pause stops real capture BEFORE telling server / UI', () => {
    const { d, calls } = deps();
    applyPause('pause', d);
    expect(d.capture.pause).toHaveBeenCalledTimes(1);
    expect(d.audio.patch).toHaveBeenCalledWith({ paused: true, level: 0 });
    expect(calls).toEqual(['mock.stop', 'capture.pause', 'send.pause', 'dispatch.pause']);
  });
  it('resume resumes real capture', () => {
    const { d, calls } = deps();
    applyPause('resume', d);
    expect(d.capture.resume).toHaveBeenCalledTimes(1);
    expect(d.audio.patch).toHaveBeenCalledWith({ paused: false });
    expect(calls).toEqual(['capture.resume', 'send.resume', 'dispatch.resume']);
  });
});
