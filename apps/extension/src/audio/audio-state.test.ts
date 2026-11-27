import { expect, test, vi } from 'vitest';
import { AudioStatus } from './audio-state';

test('reset() clears level, paused and error so an old session does not leak into the next', () => {
  const emit = vi.fn();
  const a = new AudioStatus(emit);
  a.patch({ level: 0.5, paused: true, error: 'tab-capture' });
  expect(a.state.error).toBe('tab-capture');
  a.reset();
  expect(a.state).toEqual({ k: 'audio', level: 0, paused: false, error: null });
  expect(emit).toHaveBeenLastCalledWith(a.state);
});
