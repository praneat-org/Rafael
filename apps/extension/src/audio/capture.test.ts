import { expect, test, vi } from 'vitest';
import { CaptureFailed, displayMediaAudio } from './capture';

type Track = { stop: ReturnType<typeof vi.fn> };
const track = (): Track => ({ stop: vi.fn() });

/** a MediaStream stand-in: video + audio track lists, removeTrack, getTracks */
function fakeStream(video: Track[], audio: Track[]) {
  const v = [...video];
  return {
    getVideoTracks: () => v,
    getAudioTracks: () => audio,
    getTracks: () => [...v, ...audio],
    removeTrack: (t: Track) => v.splice(v.indexOf(t), 1),
  } as unknown as MediaStream;
}

test('keeps the audio, stops and drops the video', async () => {
  const video = track();
  const audio = track();
  const s = fakeStream([video], [audio]);
  const getDisplayMedia = vi.fn().mockResolvedValue(s);
  expect(await displayMediaAudio({ getDisplayMedia })).toBe(s);
  expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true });
  expect(video.stop).toHaveBeenCalled();
  expect(s.getVideoTracks()).toHaveLength(0);
  expect(audio.stop).not.toHaveBeenCalled();
});

test('no audio track (box not ticked / window picked): stops everything, tab-no-audio', async () => {
  const video = track();
  const getDisplayMedia = vi.fn().mockResolvedValue(fakeStream([video], []));
  await expect(displayMediaAudio({ getDisplayMedia })).rejects.toMatchObject({
    reason: 'tab-no-audio',
  });
  expect(video.stop).toHaveBeenCalled();
});

test('picker cancelled / blocked: tab-capture', async () => {
  const getDisplayMedia = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'));
  const err = await displayMediaAudio({ getDisplayMedia }).catch((e) => e);
  expect(err).toBeInstanceOf(CaptureFailed);
  expect(err.reason).toBe('tab-capture');
});
