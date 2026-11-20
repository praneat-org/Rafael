import workletUrl from '../../extension/public/pcm-worklet.js?url';
import { CaptureFailed, displayMediaAudio, startCapture } from '../../extension/src/audio/capture';
import type { ControllerDeps } from '../../extension/src/session-controller';

const stopAll = (s: MediaStream | null) => {
  for (const t of s?.getTracks() ?? []) t.stop();
};

/**
 * Web inputs: tab audio via getDisplayMedia (the user picks the Meet tab and ticks "share tab audio"),
 * mic via getUserMedia, then the same AudioWorklet -> PCM16 16 kHz path as the extension.
 */
export const openWebCapture: ControllerDeps['openCapture'] = async (opts, isCurrent, sinks) => {
  // getDisplayMedia needs the Start click's user activation: ask before anything slow (worklet load)
  const tab = opts.tab ? await displayMediaAudio(navigator.mediaDevices) : null;
  if (!isCurrent()) {
    stopAll(tab);
    throw new CaptureFailed('tab-capture');
  }
  try {
    return await startCapture(
      opts,
      {
        workletUrl,
        tabStream: async () => tab as MediaStream, // only called when opts.tab, so tab is set
        monitorTab: false, // the shared tab keeps playing for the user: routing it back would echo
      },
      sinks,
    );
  } catch (e) {
    stopAll(tab); // startCapture only owns streams it has already taken
    throw e;
  }
};
