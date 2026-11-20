import { afterEach, expect, test, vi } from 'vitest';
import { CaptureFailed } from './audio/capture';
import type { OffscreenToPanel } from './messages';
import { type ControllerDeps, SessionController } from './session-controller';

afterEach(() => vi.useRealTimers());

function make(over: Partial<ControllerDeps> = {}) {
  const posts: OffscreenToPanel[] = [];
  const stop = vi.fn();
  const ctl = new SessionController({
    post: (m) => posts.push(m),
    serverUrl: 'http://localhost:8080',
    dev: true,
    getToken: async () => 't',
    openCapture: async () => ({ pause() {}, resume() {}, stop }),
    ...over,
  });
  return { ctl, posts, stop };
}

test('mock session: start -> live, cues arrive, end -> End screen with the log, reset -> setup', async () => {
  vi.useFakeTimers();
  const { ctl } = make();
  ctl.command({ k: 'start', mock: true, latencyMs: 0, attendees: ' A ' });
  expect(ctl.state.phase).toBe('live');
  await vi.advanceTimersByTimeAsync(50);
  expect(ctl.state.status).toBe('live');
  expect(ctl.state.cues.length).toBeGreaterThan(0);
  ctl.command({ k: 'end' });
  expect(ctl.state.phase).toBe('end');
  await vi.advanceTimersByTimeAsync(50);
  expect(ctl.state.endLog).toBe('ready'); // the mock sends the last log copy with session.end
  ctl.command({ k: 'reset' });
  expect(ctl.state.phase).toBe('setup');
});

test('capture failure reaches the UI as a reason code, nothing else (D11)', async () => {
  const { ctl, posts } = make({
    openCapture: async () => {
      throw new CaptureFailed('tab-no-audio');
    },
  });
  ctl.command({ k: 'preview', capture: { tab: true, mic: false } });
  await vi.waitFor(() => expect(ctl.audio.state.error).toBe('tab-no-audio'));
  expect(posts.at(-1)).toEqual({ k: 'audio', level: 0, paused: false, error: 'tab-no-audio' });
});

test('a track that ends on its own (user stops sharing) becomes an audio error', async () => {
  let lost: ((r: 'tab-capture') => void) | undefined;
  const { ctl } = make({
    openCapture: async (_o, _c, sinks) => {
      lost = sinks.onLost;
      return { pause() {}, resume() {}, stop() {} };
    },
  });
  ctl.command({ k: 'preview', capture: { tab: true, mic: false } });
  await vi.waitFor(() => expect(lost).toBeDefined());
  lost?.('tab-capture');
  expect(ctl.audio.state.error).toBe('tab-capture');
});

test('no server url (prod page on plain http): a real start is refused, no token leaves', () => {
  const getToken = vi.fn(async () => 't');
  const { ctl } = make({ serverUrl: '', dev: false, getToken });
  ctl.command({ k: 'start', mock: false, latencyMs: 0, packId: 'folder-1' });
  expect(ctl.state.phase).toBe('setup');
  expect(getToken).not.toHaveBeenCalled();
});
